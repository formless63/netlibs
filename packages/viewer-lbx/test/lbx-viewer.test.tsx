// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { buildLbx, type LabelConfig } from 'bil-lbx';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  LBX_BLEND_MODE,
  LBX_FALLBACK_FONT_METRICS,
  LBX_FILE_STOCK_ID,
  LBX_OP_COVERAGE,
  LBX_TAPE_STOCKS,
  resolveLbxAreaFillOp,
  resolveLbxBaseColors,
  resolveLbxFontMetrics,
  resolveLbxFontStack,
  resolveLbxGeometry,
  resolveLbxMarkSurfaceAt,
  resolveLbxPaintOps,
  resolveLbxRopOp,
  resolveLbxSurfaceAt,
  resolveLbxTapeStock,
  resolveLbxTextBaselines,
  type LbxColors,
  type LbxFonts,
  type LbxLabel,
  type LbxObject,
  type LbxTextObject,
} from '../src/index.ts';
import LbxViewer, { type LbxViewerProps } from '../src/lbx-viewer.tsx';
import { parseLbxLabel } from '../src/parse.ts';

/**
 * The primary fixtures, `fixtures/label-{x10b,delta}.lbx`, keep the geometry,
 * raster modes and object order of labels saved by P-touch Editor 5.4; only their
 * wording and font names were replaced. They exercise what actually fails: an ink
 * field (Box26, COPYPEN), badges that erase it (Box27/28, NOTCOPYPEN), and thin
 * rules wider than the badges (Box29-32). Do not replace them with simpler ones:
 * an abridged label once hid the bug it was meant to catch.
 *
 * Font metrics are given as plain numbers, which also exercises the `fonts` API.
 */
const PIXEL = "'Silkscreen', 'DejaVu Sans Mono', monospace";
const LABEL_FONTS: LbxFonts = {
  'narrow display': {
    stack: `'Narrow Display', 'Arial Narrow', ${PIXEL}`,
    metrics: {
      unitsPerEm: 2048,
      ascender: 2389,
      descender: 341,
      lineGap: 0,
      capHeight: 2047,
      inkTop: 2389,
      inkBottom: 341,
    },
  },
  'inverse pixel': {
    stack: `'Inverse Pixel', ${PIXEL}`,
    metrics: {
      unitsPerEm: 1024,
      ascender: 896,
      descender: 0,
      lineGap: 0,
      capHeight: 896,
      inkTop: 896,
      inkBottom: 0,
    },
  },
  'block display': {
    stack: `'Block Display', ${PIXEL}`,
    metrics: {
      unitsPerEm: 1024,
      ascender: 1024,
      descender: -128,
      lineGap: 0,
      capHeight: 896,
      inkTop: 896,
      inkBottom: 0,
    },
  },
};
const LAST_GLYPH_INK_EM: Record<string, number> = { H: 0.875, D: 0.875 };
const WHITE_ON_BLACK: LbxColors = { tape: '#000000', ink: '#ffffff' };

const baseColors = (label: LabelConfig | LbxLabel) =>
  resolveLbxBaseColors(label as LbxLabel, WHITE_ON_BLACK);
const fontStack = (name: string | undefined) => resolveLbxFontStack(name, LABEL_FONTS);
const fontMetrics = (name: string | undefined) => resolveLbxFontMetrics(name, LABEL_FONTS);
const baselinesOf = (obj: LbxTextObject) =>
  resolveLbxTextBaselines(obj, fontMetrics(obj.font.name));

function TestViewer({
  src,
  title,
  ...rest
}: { src: string; title: string } & Omit<LbxViewerProps, 'source'>) {
  return (
    <LbxViewer
      {...rest}
      fallbackColors={WHITE_ON_BLACK}
      fonts={LABEL_FONTS}
      name={title}
      source={src}
    />
  );
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const FIXTURE_CONFIG: LabelConfig = {
  paper: { width: 33.6, height: 150, autoLength: false, format: 259 },
  objects: [
    {
      type: 'text',
      position: { x: 10, y: 5, width: 80, height: 24 },
      font: { name: 'Helsinki', size: 10, weight: 700 },
      horizontalAlignment: 'CENTER',
      verticalAlignment: 'CENTER',
      data: 'TWO LINES\nOF LABEL',
    },
    {
      type: 'rect',
      position: { x: 100, y: 5, width: 30, height: 20 },
      pen: { style: 'SOLID', widthX: 1 },
    },
    {
      type: 'barcode',
      position: { x: 134, y: 5, width: 12, height: 20 },
      protocol: 'QRCODE',
      data: 'https://example.com',
    },
  ],
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(element: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    root = createRoot(container!);
    root.render(element);
  });
  return container;
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out; container HTML: ${container?.innerHTML}`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function stubFetchLbx(config: LabelConfig): Promise<void> {
  const bytes = await buildLbx(config);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer })),
  );
}

const fixturePath = (name: string): string => join(process.cwd(), 'fixtures', name);

const DELTA_FIXTURE_PATH = fixturePath('label-delta.lbx');
const X10B_FIXTURE_PATH = fixturePath('label-x10b.lbx');

function stubFetchRealFixture(path: string = DELTA_FIXTURE_PATH): void {
  const bytes = readFileSync(path);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const buffer = copy.buffer;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer })),
  );
}

function closestG(el: Element): Element | null {
  return el.closest('g');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zipStored(entries: { name: string; content: string }[]): ArrayBuffer {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const data = encoder.encode(entry.content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length + data.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, 0, true); // method: stored
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(10, 0, true); // method: stored
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, c) => sum + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of [...locals, ...centrals, eocd]) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out.buffer;
}

const NS =
  'xmlns:pt="http://schemas.brother.info/ptouch/2007/lbx/main" ' +
  'xmlns:style="http://schemas.brother.info/ptouch/2007/lbx/style" ' +
  'xmlns:text="http://schemas.brother.info/ptouch/2007/lbx/text" ' +
  'xmlns:draw="http://schemas.brother.info/ptouch/2007/lbx/draw"';

function rectXml(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  rop: string;
  filled: boolean;
  pen?: boolean;
  shape?: string;
  roundness?: number;
}): string {
  const shape = opts.shape ?? 'RECTANGLE';
  const roundness = opts.roundness ?? 3;
  return `<draw:rect><pt:objectStyle x="${opts.x}pt" y="${opts.y}pt" width="${opts.w}pt" height="${opts.h}pt" backColor="#FFFFFF" ropMode="${opts.rop}" angle="0" anchor="TOPLEFT" flip="NONE">
      <pt:pen style="${opts.pen ? 'SOLID' : 'NULL'}" widthX="0.5pt" widthY="0.5pt" color="#000000" printColorNumber="1"/>
      <pt:brush style="${opts.filled ? 'PATTERN' : 'NULL'}" color="#000000" printColorNumber="1" id="${opts.filled ? 1 : 0}"/>
    </pt:objectStyle><draw:rectStyle shape="${shape}" roundnessX="${roundness}pt" roundnessY="${roundness}pt"/></draw:rect>`;
}

function textXml(opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  rop: string;
  font: string;
  data: string;
}): string {
  return `<text:text><pt:objectStyle x="${opts.x}pt" y="${opts.y}pt" width="${opts.w}pt" height="${opts.h}pt" backColor="#FFFFFF" ropMode="${opts.rop}" angle="0" anchor="TOPLEFT" flip="NONE">
      <pt:pen style="NULL" widthX="0.5pt" widthY="0.5pt" color="#000000" printColorNumber="1"/>
      <pt:brush style="NULL" color="#000000" printColorNumber="1" id="0"/>
    </pt:objectStyle><text:ptFontInfo>
      <text:logFont name="${opts.font}" width="0" italic="false" weight="700" charSet="0" pitchAndFamily="2"/>
      <text:fontExt effect="NOEFFECT" underline="0" strikeout="0" size="6pt" orgSize="28.8pt" textColor="#000000" textPrintColorNumber="1"/>
    </text:ptFontInfo><text:textAlign horizontalAlignment="CENTER" verticalAlignment="CENTER" inLineAlignment="BASELINE"/><pt:data>${opts.data}</pt:data></text:text>`;
}

const KNOCKOUT_LABEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<pt:document ${NS} version="1.7" generator="fixture">
  <pt:body currentSheet="Sheet 1" direction="LTR">
    <style:sheet name="Sheet 1">
      <style:paper media="0" width="33.6pt" height="89.2pt" marginLeft="2.8pt" marginTop="5.6pt" marginRight="2.8pt" marginBottom="5.6pt" orientation="landscape" autoLength="false" paperColor="#000000" paperInk="#FFFFFF" format="259"/>
      <pt:objects>
        ${rectXml({ x: 2, y: 2, w: 85, h: 29, rop: 'COPYPEN', filled: false, pen: true })}
        ${rectXml({ x: 6, y: 5, w: 40, h: 23, rop: 'COPYPEN', filled: true })}
        ${textXml({ x: 8, y: 6, w: 36, h: 8, rop: 'COPYPEN', font: 'Narrow Display', data: 'X10B' })}
        ${rectXml({ x: 10, y: 16, w: 30, h: 10, rop: 'NOTCOPYPEN', filled: true })}
        ${textXml({ x: 12, y: 18, w: 26, h: 6, rop: 'COPYPEN', font: 'Inverse Pixel', data: 'INPUT' })}
        ${rectXml({ x: 50, y: 4, w: 1.5, h: 25, rop: 'NOTCOPYPEN', filled: true })}
        ${textXml({ x: 55, y: 10, w: 28, h: 8, rop: 'COPYPEN', font: 'Block Display', data: 'MODEL ONLY' })}
      </pt:objects>
    </style:sheet>
  </pt:body>
</pt:document>`;

function stubFetchKnockoutLabel(): void {
  const buffer = zipStored([{ name: 'label.xml', content: KNOCKOUT_LABEL_XML }]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer })),
  );
}

async function parseStubbedObjects(): Promise<LbxObject[]> {
  const res = (await (
    globalThis.fetch as unknown as () => Promise<{
      arrayBuffer: () => Promise<ArrayBuffer>;
    }>
  )()) as { arrayBuffer: () => Promise<ArrayBuffer> };
  const parsed = await parseLbxLabel(await res.arrayBuffer());
  return parsed.objects;
}

function partOf(group: Element, part: string): Element | null {
  return group.querySelector(`[data-lbx-part="${part}"]`);
}

function objectIndexOfText(objects: readonly LbxObject[], content: string): number {
  const index = objects.findIndex((o) => o.type === 'text' && o.data.split(/\r?\n/)[0] === content);
  if (index < 0) throw new Error(`no text object with data starting "${content}"`);
  return index;
}

function textToneAtCentre(objects: readonly LbxObject[], content: string): string {
  const index = objectIndexOfText(objects, content);
  const p = objects[index].position;
  return resolveLbxMarkSurfaceAt(objects, index, p.x + p.width / 2, p.y + p.height / 2);
}

function markToneHistogram(
  objects: readonly LbxObject[],
  content: string,
): { ink: number; tape: number } {
  const index = objectIndexOfText(objects, content);
  const p = objects[index].position;
  const counts = { ink: 0, tape: 0 };
  const step = 0.25;
  for (let x = p.x + step; x < p.x + p.width; x += step) {
    for (let y = p.y + step; y < p.y + p.height; y += step) {
      counts[resolveLbxMarkSurfaceAt(objects, index, x, y)]++;
    }
  }
  return counts;
}

function markToneAt(objects: readonly LbxObject[], content: string, x: number, y: number): string {
  return resolveLbxMarkSurfaceAt(objects, objectIndexOfText(objects, content), x, y);
}

function structuralShapeOf(objects: readonly LbxObject[]): unknown[][] {
  return objects.map((o) => [
    o.type,
    o.position.x,
    o.position.y,
    o.position.width,
    o.position.height,
    o.position.ropMode ?? null,
    o.position.angle ?? 0,
    o.type === 'text' ? o.font.name : null,
  ]);
}

function dataOf(objects: readonly LbxObject[]): string[] {
  return objects.filter((o) => o.type === 'text').map((o) => o.data);
}

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('resolveLbxGeometry', () => {
  it('uses the stored label length when it is real (not the auto-length sentinel)', () => {
    const geometry = resolveLbxGeometry(FIXTURE_CONFIG);
    expect(geometry.lengthPt).toBe(150);
    expect(geometry.tapeWidthPt).toBe(33.6);
  });

  it('falls back to object extents when auto-length stores the ~1m sentinel', () => {
    const geometry = resolveLbxGeometry({
      paper: { width: 33.6, height: 2834.4, autoLength: true },
      objects: [
        {
          type: 'text',
          position: { x: 10, y: 5, width: 90, height: 24 },
          font: { name: 'Helsinki', size: 10 },
          data: 'X',
        },
      ],
    });
    expect(geometry.lengthPt).toBeLessThan(200);
    expect(geometry.lengthPt).toBeGreaterThanOrEqual(100);
  });
});

describe('resolveLbxBaseColors', () => {
  it('reads paperColor/paperInk directly when the file supplies them', () => {
    expect(
      baseColors({
        paper: { width: 33.6, paperColor: '#000000', paperInk: '#FFFFFF' },
        objects: [],
      }),
    ).toEqual({ tape: '#000000', ink: '#ffffff' });
  });

  it('falls back to the white-on-black default when the file omits stock metadata', () => {
    expect(baseColors(FIXTURE_CONFIG)).toEqual({ tape: '#000000', ink: '#ffffff' });
  });

  it('does not hardcode black/white — an unusual stock color still passes through', () => {
    expect(
      baseColors({
        paper: { width: 33.6, paperColor: '#0000ff', paperInk: '#ffff00' },
        objects: [],
      }),
    ).toEqual({ tape: '#0000ff', ink: '#ffff00' });
  });
});

describe('Brother TZe tape-stock presets', () => {
  it('resolves a known preset and falls back to the FILE stock for anything else', () => {
    expect(resolveLbxTapeStock('black-on-yellow')).toMatchObject({
      ink: '#000000',
      tape: '#f2c800',
    });
    for (const value of [LBX_FILE_STOCK_ID, 'no-such-stock', '', null, undefined, 7, {}]) {
      expect(resolveLbxTapeStock(value), `value: ${String(value)}`).toBeNull();
    }
  });

  it('offers only well-formed, unique, real tape/ink PAIRS', () => {
    expect(LBX_TAPE_STOCKS.length).toBeGreaterThan(8);
    const ids = LBX_TAPE_STOCKS.map((stock) => stock.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(LBX_FILE_STOCK_ID);
    const pairs = LBX_TAPE_STOCKS.map((stock) => `${stock.ink}|${stock.tape}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    for (const stock of LBX_TAPE_STOCKS) {
      expect(stock.ink, `${stock.id} ink`).toMatch(/^#[0-9a-f]{6}$/);
      expect(stock.tape, `${stock.id} tape`).toMatch(/^#[0-9a-f]{6}$/);
      expect(stock.ink, `${stock.id} contrast`).not.toBe(stock.tape);
      expect(stock.label.length, `${stock.id} label`).toBeGreaterThan(0);
      expect(stock.tze, `${stock.id} part number`).toMatch(/^TZe-/);
    }
  });

  it('keeps the reference white-on-black available as an explicit preset too', () => {
    const stock = resolveLbxTapeStock('white-on-black');
    expect(stock).toMatchObject({ ink: '#ffffff', tape: '#000000' });
    expect(LBX_TAPE_STOCKS[0].id).toBe('white-on-black');
  });
});

describe('LbxViewer (real bil-lbx parse pipeline)', () => {
  it('renders the label to SVG: white-on-black by default, text + rect + barcode placeholder', async () => {
    await stubFetchLbx(FIXTURE_CONFIG);
    const el = await mount(<TestViewer src='/api/x/content' title='label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const svg = el.querySelector('svg')!;
    expect(svg.getAttribute('viewBox')).toBeTruthy();

    expect(el.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#000000');
    expect(el.querySelector('[data-lbx-ink]')!.getAttribute('fill')).toBe('#ffffff');
    expect(el.querySelector('[data-lbx-ink]')!.getAttribute('mask')).toMatch(/^url\(#lbx-ink-/);

    expect(el.textContent).toContain('TWO LINES');
    expect(el.textContent).toContain('OF LABEL');
    const textEl = el.querySelector('[data-lbx-object="text"] text')!;
    expect(textEl.getAttribute('fill')).toBe('#ffffff');
    expect(textEl.getAttribute('font-weight')).toBe('bold');

    expect(el.querySelector('[data-lbx-object="rect"]')).not.toBeNull();
    expect(el.querySelector('[data-lbx-object="placeholder-barcode"]')).not.toBeNull();
    expect(el.textContent).toContain('Barcode · QRCODE');
  });

  describe('tape-stock selector', () => {
    async function mountRealLabel() {
      stubFetchRealFixture(X10B_FIXTURE_PATH);
      const el = await mount(<TestViewer src='/api/x/content' title='x10b.lbx' />);
      await waitFor(() => el.querySelector('svg') !== null);
      return el;
    }

    async function chooseStock(el: HTMLElement, value: string) {
      const select = el.querySelector('select')!;
      await act(async () => {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }

    it('opens on the FILE’s own stock, with every real cassette offered', async () => {
      const el = await mountRealLabel();
      const select = el.querySelector('select')!;

      expect(select.value).toBe(LBX_FILE_STOCK_ID);
      expect(el.querySelector('svg')!.getAttribute('data-lbx-stock')).toBe(LBX_FILE_STOCK_ID);
      expect(el.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#000000');
      expect(el.querySelector('[data-lbx-ink]')!.getAttribute('fill')).toBe('#ffffff');

      const values = [...select.querySelectorAll('option')].map((option) => option.value);
      expect(values[0]).toBe(LBX_FILE_STOCK_ID);
      for (const stock of LBX_TAPE_STOCKS) expect(values).toContain(stock.id);
    });

    it('recolours the WHOLE composite for a preset without moving a single mark', async () => {
      const el = await mountRealLabel();
      const coverageBefore = el.querySelector('[data-lbx-coverage]')!.innerHTML;
      const viewBoxBefore = el.querySelector('svg')!.getAttribute('viewBox');

      await chooseStock(el, 'black-on-yellow');

      expect(el.querySelector('svg')!.getAttribute('data-lbx-stock')).toBe('black-on-yellow');
      expect(el.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#f2c800');
      expect(el.querySelector('[data-lbx-ink]')!.getAttribute('fill')).toBe('#000000');
      expect(el.querySelector('[data-lbx-coverage]')!.innerHTML).toBe(coverageBefore);
      expect(el.querySelector('svg')!.getAttribute('viewBox')).toBe(viewBoxBefore);
    });

    it('offers exactly the curated real-product list — no synthesised inverse pairs', async () => {
      const el = await mountRealLabel();
      const select = el.querySelector('select')!;

      const values = [...select.querySelectorAll('option')].map((option) => option.value);
      expect(values).toEqual([LBX_FILE_STOCK_ID, ...LBX_TAPE_STOCKS.map((stock) => stock.id)]);

      expect(el.querySelector('[aria-pressed]')).toBeNull();
      expect(select.getAttribute('aria-label')).toContain('File stock (White on Black)');
      expect(select.getAttribute('aria-label')).toContain('preview only');
    });

    it('returns to the file’s declared stock on demand, and forgets the choice on remount', async () => {
      const el = await mountRealLabel();
      await chooseStock(el, 'black-on-white');
      expect(el.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#ffffff');

      await chooseStock(el, LBX_FILE_STOCK_ID);
      expect(el.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#000000');
      expect(el.querySelector('[data-lbx-ink]')!.getAttribute('fill')).toBe('#ffffff');

      const remounted = await mountRealLabel();
      expect(remounted.querySelector('select')!.value).toBe(LBX_FILE_STOCK_ID);
      expect(remounted.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#000000');
    });
  });

  it('treats a non-lbx zip (or garbage bytes) as an error, not a crash', async () => {
    const garbage = new TextEncoder().encode('not a zip at all').buffer;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => garbage })),
    );
    const el = await mount(<TestViewer src='/api/x/content' title='label.lbx' />);
    await waitFor(() => el.querySelector('[data-fv-error="parse-failed"]') !== null);
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/api/x/content');
  });
});
const BOX26_FIELD = 0;
const BOX27_UPPER_BADGE = 1;
const BOX28_LOWER_BADGE = 2;
const BOX29_RULE = 3;
const BOX32_RULE = 6;

const BADGE_CX = 49.9;
const DELTA_CLEAR_Y = 12.2;
const DELTA_CROSSING_Y = 10;
const INPUT_CLEAR_Y = 21.5;
const INPUT_CROSSING_Y = 23.5;

describe('LbxViewer against the COMPLETE real label', () => {
  it('accounts for every object in the real file: 7 rects + 4 texts, in document paint order', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const drawables = Array.from(el.querySelectorAll('[data-lbx-object]'));
    expect(drawables.map((d) => d.getAttribute('data-lbx-object'))).toEqual([
      'rect',
      'rect',
      'rect',
      'rect',
      'rect',
      'rect',
      'rect',
      'text',
      'text',
      'text',
      'text',
    ]);
    expect(el.querySelectorAll('[data-lbx-object^="placeholder-"]').length).toBe(0);

    const objects = await parseStubbedObjects();
    expect(objects.length).toBe(11);
    expect(objects.filter((o) => o.type === 'rect').length).toBe(7);
    expect(objects.filter((o) => o.type === 'text').length).toBe(4);
  });

  it('carries SIX NOTCOPYPEN objects — the badges and the four rules all invert', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const rects = Array.from(el.querySelectorAll('[data-lbx-object="rect"]'));
    expect(rects.map((r) => r.getAttribute('data-lbx-rop'))).toEqual([
      'COPYPEN', // Box26 — the ink field
      'NOTCOPYPEN', // Box27 — upper badge
      'NOTCOPYPEN', // Box28 — lower badge
      'NOTCOPYPEN', // Box29-32 — the four rules
      'NOTCOPYPEN',
      'NOTCOPYPEN',
      'NOTCOPYPEN',
    ]);
    expect(rects.map((r) => partOf(r, 'fill')!.getAttribute('data-lbx-blend'))).toEqual([
      'set',
      'clear',
      'clear',
      'clear',
      'clear',
      'clear',
      'clear',
    ]);
    for (const r of rects) {
      expect((partOf(r, 'fill') as HTMLElement).style.mixBlendMode).toBe('normal');
    }
    for (const r of rects) expect(partOf(r, 'outline')).toBeNull();
  });

  it('renders white-on-black driven by the file own paperColor/paperInk, not a hardcoded guess', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    expect(el.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#000000');
    expect(el.querySelector('[data-lbx-ink]')!.getAttribute('fill')).toBe('#ffffff');
  });

  it('sets Box26 back to bare tape inside BOTH badges, leaving an ink frame around and between them', async () => {
    stubFetchRealFixture();
    const objects = await parseStubbedObjects();

    expect(resolveLbxSurfaceAt(objects, BADGE_CX, DELTA_CLEAR_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, INPUT_CLEAR_Y)).toBe('tape');

    expect(resolveLbxSurfaceAt(objects, BADGE_CX, 3.4)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, 16.8)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, 30.3)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, 19, 12.2)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, 81, 12.2)).toBe('ink');

    expect(resolveLbxSurfaceAt(objects, 12, 12.2)).toBe('tape');
  });

  it('DECISIVE: DELTA prints INK on its tape badge, CONTINUOUSLY — the rules do not slice it', async () => {
    stubFetchRealFixture();
    const objects = await parseStubbedObjects();

    expect(markToneAt(objects, 'DELTA', BADGE_CX, DELTA_CLEAR_Y)).toBe('ink');

    const histogram = markToneHistogram(objects, 'DELTA');
    expect(histogram.tape).toBe(0);
    expect(histogram.ink).toBeGreaterThan(0);
    expect(markToneAt(objects, 'DELTA', BADGE_CX, DELTA_CROSSING_Y)).toBe('ink');
    expect(textToneAtCentre(objects, 'DELTA')).toBe('ink');
  });

  it('DECISIVE: INPUT / MODEL ONLY prints INK on its tape badge, in two lines', async () => {
    stubFetchRealFixture();
    const objects = await parseStubbedObjects();

    expect(markToneAt(objects, 'INPUT', BADGE_CX, INPUT_CLEAR_Y)).toBe('ink');
    const histogram = markToneHistogram(objects, 'INPUT');
    expect(histogram.tape).toBe(0);
    expect(markToneAt(objects, 'INPUT', BADGE_CX, INPUT_CROSSING_Y)).toBe('ink');

    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);
    const lowerGroup = Array.from(el.querySelectorAll('[data-lbx-object="text"]')).find((g) =>
      (g.textContent ?? '').includes('INPUT'),
    )!;
    expect(Array.from(lowerGroup.querySelectorAll('text')).map((t) => t.textContent)).toEqual([
      'INPUT',
      'MODEL ONLY',
    ]);
  });

  it('prints the NORTH / GROUND spine in INK on bare tape, rotated 270°', async () => {
    stubFetchRealFixture();
    const objects = await parseStubbedObjects();

    const north = markToneHistogram(objects, 'NORTH');
    expect(north.tape).toBe(0);
    expect(north.ink).toBeGreaterThan(0);

    const ground = markToneHistogram(objects, 'GROUND');
    expect(ground.tape).toBe(0);
    expect(ground.ink).toBeGreaterThan(0);

    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);
    const groupFor = (content: string): Element =>
      closestG(
        Array.from(el.querySelectorAll('[data-lbx-object="text"] text')).find(
          (t) => t.textContent === content,
        )!,
      )!;
    expect(groupFor('NORTH').getAttribute('transform')).toMatch(/^rotate\(270 /);
    expect(groupFor('GROUND').getAttribute('transform')).toMatch(/^rotate\(270 /);
    expect(groupFor('DELTA').getAttribute('transform')).toBeNull();
  });

  it('REGRESSION: the four rules stay 2.1pt and CLEAR to tape — never full-width white slabs', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const rects = Array.from(el.querySelectorAll('[data-lbx-object="rect"]'));
    const fieldFill = partOf(rects[BOX26_FIELD], 'fill')!;
    for (const index of [BOX29_RULE, 4, 5, BOX32_RULE]) {
      const ruleFill = partOf(rects[index], 'fill')!;
      expect(ruleFill.getAttribute('height')).toBe('2.1');
      expect(ruleFill.getAttribute('width')).toBe('71.8');
      expect(Number(ruleFill.getAttribute('height'))).toBeLessThan(
        Number(fieldFill.getAttribute('height')) / 10,
      );
      expect(Number(ruleFill.getAttribute('width'))).toBeGreaterThan(
        Number(partOf(rects[BOX27_UPPER_BADGE], 'fill')!.getAttribute('width')),
      );
      expect(ruleFill.getAttribute('data-lbx-blend')).toBe('clear');
      expect((ruleFill as HTMLElement).style.mixBlendMode).toBe('normal');
      expect(ruleFill.getAttribute('fill')).toBe(LBX_OP_COVERAGE.clear);
    }

    const objects = await parseStubbedObjects();
    expect(resolveLbxSurfaceAt(objects, 14.5, DELTA_CROSSING_Y)).toBe('tape'); // overhang, bare tape
    expect(resolveLbxSurfaceAt(objects, 19, DELTA_CROSSING_Y)).toBe('tape'); // notch through the frame
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, DELTA_CROSSING_Y)).toBe('tape'); // already the badge
    expect(resolveLbxSurfaceAt(objects, 81, DELTA_CROSSING_Y)).toBe('tape'); // notch again
    expect(resolveLbxSurfaceAt(objects, 85, DELTA_CROSSING_Y)).toBe('tape'); // overhang again
    expect(resolveLbxSurfaceAt(objects, 14.5, INPUT_CROSSING_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 19, INPUT_CROSSING_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, INPUT_CROSSING_Y)).toBe('tape');
  });

  it('renders every shape="RECTANGLE" rect SQUARE, roundness values notwithstanding', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);
    const objects = await parseStubbedObjects();

    const rects = Array.from(el.querySelectorAll('[data-lbx-object="rect"]'));
    for (const [i, rectEl] of rects.entries()) {
      const source = objects[i] as { shape?: string; roundnessX?: number };
      expect(source.shape).toBe('RECTANGLE');
      expect(source.roundnessX).toBeGreaterThan(0);
      expect(partOf(rectEl, 'fill')!.getAttribute('rx')).toBeNull();
      expect(partOf(rectEl, 'fill')!.getAttribute('ry')).toBeNull();
    }
    const shortSideRatio = (i: number) => {
      const p = objects[i].position;
      return (objects[i] as { roundnessX?: number }).roundnessX! / Math.min(p.width, p.height);
    };
    expect(shortSideRatio(BOX26_FIELD)).toBeCloseTo(0.25, 2);
    expect(shortSideRatio(BOX27_UPPER_BADGE)).toBeCloseTo(0.24, 2);
    expect(shortSideRatio(BOX28_LOWER_BADGE)).toBe(shortSideRatio(BOX27_UPPER_BADGE));
  });

  it('paints every mark with its OWN raster op — no forced knockout', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const texts = Array.from(el.querySelectorAll('[data-lbx-object="text"] text'));
    expect(texts.map((t) => t.textContent)).toEqual([
      'DELTA',
      'NORTH',
      'GROUND',
      'INPUT',
      'MODEL ONLY',
    ]);

    for (const textEl of texts) {
      expect(textEl.getAttribute('fill')).toBe(LBX_OP_COVERAGE.set);
      const group = textEl.closest('[data-lbx-object="text"]')! as HTMLElement;
      expect(group.getAttribute('data-lbx-blend')).toBe('set');
      expect(group.style.mixBlendMode).toBe('normal');
    }

    const objects = await parseStubbedObjects();
    for (const [index, obj] of objects.entries()) {
      if (obj.type !== 'text') continue;
      const p = obj.position;
      for (let x = p.x + 0.5; x < p.x + p.width; x += 1.5) {
        for (let y = p.y + 0.5; y < p.y + p.height; y += 1.5) {
          expect(resolveLbxMarkSurfaceAt(objects, index, x, y)).toBe('ink');
        }
      }
    }

    expect(resolveLbxSurfaceAt(objects, BADGE_CX, DELTA_CLEAR_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, INPUT_CLEAR_Y)).toBe('tape');
  });

  it('decides no per-object colour anywhere in the mask — the hit test is gone, not merely improved', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const coverage = el.querySelector('[data-lbx-coverage]')!;
    const painted = Array.from(coverage.querySelectorAll('rect, text, polyline')).slice(1);
    expect(painted.length).toBeGreaterThan(0);
    for (const node of painted) {
      const op = node.closest('[data-lbx-blend]')!.getAttribute('data-lbx-blend')!;
      const expected = LBX_OP_COVERAGE[op as keyof typeof LBX_OP_COVERAGE];
      expect(expected).toBeDefined();
      const fill = node.getAttribute('fill');
      const stroke = node.getAttribute('stroke');
      expect(fill === null || fill === expected || fill === 'none').toBe(true);
      expect(stroke === null || stroke === expected).toBe(true);
    }
    expect(el.querySelector('[data-lbx-tape]')!.getAttribute('fill')).toBe('#000000');
    expect(el.querySelector('[data-lbx-ink]')!.getAttribute('fill')).toBe('#ffffff');
  });

  it('RETIRED DIVERGENCE: overlapping marks now union like a printer, and nothing stacks anyway', async () => {
    stubFetchRealFixture();
    const objects = await parseStubbedObjects();

    const ops = resolveLbxPaintOps(objects);
    const markOpsOfTexts = objects.flatMap((o, i) => (o.type === 'text' ? [ops[i].mark] : []));
    expect(markOpsOfTexts).toEqual(['set', 'set', 'set', 'set']);
    expect(ops.every((o) => o.mark !== 'flip')).toBe(true);

    const texts = objects.filter((o) => o.type === 'text');
    const overlaps: string[] = [];
    for (let i = 0; i < texts.length; i++) {
      for (let j = i + 1; j < texts.length; j++) {
        const a = texts[i].position;
        const b = texts[j].position;
        const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        if (dx > 0 && dy > 0) overlaps.push(`${i}/${j}:${dx.toFixed(1)}x${dy.toFixed(1)}`);
      }
    }
    expect(overlaps.length).toBe(1);
    const strip = Number(overlaps[0].split(':')[1].split('x')[0]);
    expect(strip).toBeLessThan(1);
  });

  it('maps each Brother font name through LBX_FONT_SUBSTITUTIONS (all three brand faces bundled)', async () => {
    stubFetchRealFixture();
    const el = await mount(<TestViewer src='/api/x/content' title='delta-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const familyOf = (content: string): string =>
      Array.from(el.querySelectorAll('[data-lbx-object="text"] text'))
        .find((t) => t.textContent === content)!
        .getAttribute('font-family')!;

    expect(familyOf('NORTH')).toContain("'Block Display'"); // logFont "Block Display"
    expect(familyOf('GROUND')).toContain("'Block Display'");
    expect(familyOf('DELTA')).toContain("'Narrow Display'"); // logFont "Narrow Display"
    expect(familyOf('INPUT')).toContain("'Inverse Pixel'"); // logFont "Inverse Pixel"
    expect(familyOf('MODEL ONLY')).toContain("'Inverse Pixel'");
    expect(familyOf('DELTA')).toBe(LABEL_FONTS['narrow display']!.stack);
    expect(familyOf('INPUT')).toBe(LABEL_FONTS['inverse pixel']!.stack);
    expect(familyOf('DELTA')).not.toContain("'Block Display'");
    expect(familyOf('DELTA')).not.toContain("'Inverse Pixel'");
    expect(familyOf('INPUT')).not.toContain("'Narrow Display'");
  });
});

describe('LbxViewer against the real X10B label', () => {
  it('is the same 11-object structure as the DELTA label, differing only in the model name', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const first = await parseStubbedObjects();
    stubFetchRealFixture(DELTA_FIXTURE_PATH);
    const second = await parseStubbedObjects();

    expect(structuralShapeOf(first)).toEqual(structuralShapeOf(second));

    expect(dataOf(first)).toEqual(['X10B', 'NORTH', 'GROUND', 'INPUT\nMODEL ONLY']);
    expect(dataOf(second)).toEqual(['DELTA', 'NORTH', 'GROUND', 'INPUT\nMODEL ONLY']);
  });

  it('TONE MAP: white field around the badges, both badges black, spine on bare tape', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();

    expect(resolveLbxSurfaceAt(objects, BADGE_CX, 3.4)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, 16.8)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, 30.3)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, 19, 12.2)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, 81, 12.2)).toBe('ink');

    expect(resolveLbxSurfaceAt(objects, BADGE_CX, DELTA_CLEAR_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, INPUT_CLEAR_Y)).toBe('tape');

    expect(resolveLbxSurfaceAt(objects, 12, 12.2)).toBe('tape');
  });

  it('DECISIVE TONE MAP: inside Box27 the rule bands are TAPE, and X10B crosses them unbroken', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();

    expect(resolveLbxSurfaceAt(objects, 50, 10)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 50, 14)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 50, 12.2)).toBe('tape');

    expect(markToneAt(objects, 'X10B', 50, 10)).toBe('ink');
    expect(markToneAt(objects, 'X10B', 50, 12.2)).toBe('ink');
    expect(markToneAt(objects, 'X10B', 50, 14)).toBe('ink');
    const first = markToneHistogram(objects, 'X10B');
    expect(first.tape).toBe(0);
    expect(first.ink).toBeGreaterThan(0);

    expect(resolveLbxSurfaceAt(objects, 50, 19)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 50, INPUT_CROSSING_Y)).toBe('tape');
    expect(markToneAt(objects, 'INPUT', BADGE_CX, INPUT_CLEAR_Y)).toBe('ink');
    expect(markToneAt(objects, 'INPUT', BADGE_CX, INPUT_CROSSING_Y)).toBe('ink');
    expect(markToneHistogram(objects, 'INPUT').tape).toBe(0);

    const north = markToneHistogram(objects, 'NORTH');
    expect(north.tape).toBe(0);
    expect(north.ink).toBeGreaterThan(0);
  });

  it('DECISIVE TONE MAP: the white margin is notched black by each rule — the "3 tiny white bars"', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();

    const marginToneAt = (y: number) => resolveLbxSurfaceAt(objects, 19.5, y);
    for (const y of [3.4, 12.2, 16.8, 21.3, 27]) expect(marginToneAt(y)).toBe('ink');
    for (const y of [10, 14.3, 19, 23.5]) expect(marginToneAt(y)).toBe('tape');

    expect(resolveLbxSurfaceAt(objects, 15, 10)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 85, 10)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 12, 12.2)).toBe('tape');

    const bands: number[] = [];
    let run = 0;
    for (let y = 2; y <= 32; y += 0.05) {
      if (resolveLbxSurfaceAt(objects, 50, y) === 'ink') run += 0.05;
      else if (run > 0) {
        bands.push(run);
        run = 0;
      }
    }
    if (run > 0) bands.push(run);
    expect(bands.length).toBe(3);
    for (const thickness of bands) {
      expect(thickness).toBeGreaterThan(0.9);
      expect(thickness).toBeLessThan(1.5);
    }
  });

  it('TONE MAP: the rules read as thin lines that CLEAR to tape, never white slabs', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const el = await mount(<TestViewer src='/api/x/content' title='x10b-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const rects = Array.from(el.querySelectorAll('[data-lbx-object="rect"]'));
    for (const index of [BOX29_RULE, 4, 5, BOX32_RULE]) {
      const fill = partOf(rects[index], 'fill')!;
      expect(fill.getAttribute('height')).toBe('2.1');
      expect(fill.getAttribute('width')).toBe('71.8');
      expect(fill.getAttribute('data-lbx-blend')).toBe('clear');
    }

    const objects = await parseStubbedObjects();
    expect(resolveLbxSurfaceAt(objects, 14.5, DELTA_CROSSING_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 19, DELTA_CROSSING_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, BADGE_CX, DELTA_CROSSING_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 81, DELTA_CROSSING_Y)).toBe('tape');
    expect(resolveLbxSurfaceAt(objects, 85, DELTA_CROSSING_Y)).toBe('tape');
  });

  it('SHARP SQUARES: the X10B label draws no corner rounding at all', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const el = await mount(<TestViewer src='/api/x/content' title='x10b-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const rects = Array.from(el.querySelectorAll('[data-lbx-object="rect"]'));
    expect(rects.length).toBe(7);
    for (const rectEl of rects) {
      for (const part of ['fill', 'outline']) {
        const node = partOf(rectEl, part);
        if (!node) continue;
        expect(node.getAttribute('rx')).toBeNull();
        expect(node.getAttribute('ry')).toBeNull();
      }
    }
  });

  it('references all three REAL brand families for their respective runs', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const el = await mount(<TestViewer src='/api/x/content' title='x10b-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const familyOf = (content: string): string =>
      Array.from(el.querySelectorAll('[data-lbx-object="text"] text'))
        .find((t) => t.textContent === content)!
        .getAttribute('font-family')!;

    expect(familyOf('X10B')).toMatch(/^'Narrow Display',/);
    expect(familyOf('INPUT')).toMatch(/^'Inverse Pixel',/);
    expect(familyOf('MODEL ONLY')).toMatch(/^'Inverse Pixel',/);
    expect(familyOf('NORTH')).toMatch(/^'Block Display',/);
    expect(familyOf('GROUND')).toMatch(/^'Block Display',/);
  });
});

const rect = (x: number, y: number, w: number, h: number, ropMode?: string) => ({
  type: 'rect' as const,
  position: { x, y, width: w, height: h, ...(ropMode ? { ropMode } : {}) },
  brush: { style: 'PATTERN' as const },
});

const text = (x: number, y: number, w: number, h: number, ropMode?: string) => ({
  type: 'text' as const,
  position: { x, y, width: w, height: h, ...(ropMode ? { ropMode } : {}) },
  font: { name: 'Helsinki', size: 6 },
  data: 'X',
});

describe('resolveLbxRopOp — literal Win32 raster ops', () => {
  it('reads each R2_* op the way SetROP2 defines it, not the way it reads in English', () => {
    expect(resolveLbxRopOp('COPYPEN')).toBe('set');
    expect(resolveLbxRopOp('NOTCOPYPEN')).toBe('clear');
    expect(resolveLbxRopOp('NOT')).toBe('flip');
    expect(resolveLbxRopOp('NOTCOPYPEN')).not.toBe(resolveLbxRopOp('NOT'));
    expect(resolveLbxRopOp(' notcopypen ')).toBe('clear');
    expect(resolveLbxRopOp('MERGEPEN')).toBe('set');
    expect(resolveLbxRopOp(undefined)).toBe('set');
  });

  it('binds each op to the coverage value and blend mode that realise it in the mask', () => {
    expect(LBX_BLEND_MODE.set).toBe('normal');
    expect(LBX_BLEND_MODE.clear).toBe('normal');
    expect(LBX_OP_COVERAGE.set).toBe('#ffffff');
    expect(LBX_OP_COVERAGE.clear).toBe('#000000');
    expect(LBX_BLEND_MODE.flip).toBe('difference'); // XOR on a 0/1 raster
    expect(LBX_OP_COVERAGE.flip).toBe('#ffffff');
  });
});

describe('resolveLbxPaintOps — raster-op classification', () => {
  it('maps a COPYPEN area fill to `set` (dst := ink) and NOTCOPYPEN to `clear` (dst := tape)', () => {
    const ops = resolveLbxPaintOps([
      rect(0, 0, 50, 20, 'COPYPEN'),
      rect(5, 5, 10, 5, 'NOTCOPYPEN'),
    ]);
    expect(ops[0].fill).toBe('set');
    expect(ops[1].fill).toBe('clear');
  });

  it('routes that decision through the single resolveLbxAreaFillOp seam', () => {
    expect(resolveLbxAreaFillOp(rect(0, 0, 50, 20, 'COPYPEN'))).toBe('set');
    expect(resolveLbxAreaFillOp(rect(0, 0, 50, 20, 'NOTCOPYPEN'))).toBe('clear');
    expect(resolveLbxAreaFillOp(rect(0, 0, 50, 20))).toBe('set');
    expect(resolveLbxAreaFillOp(rect(0, 0, 50, 20, 'MERGEPEN'))).toBe('set');
    expect(resolveLbxAreaFillOp(text(0, 0, 50, 20, 'COPYPEN'))).toBeNull();
    const objects = [
      rect(0, 0, 50, 20, 'COPYPEN'),
      rect(5, 5, 10, 5, 'NOTCOPYPEN'),
      text(0, 0, 5, 5),
    ];
    expect(resolveLbxPaintOps(objects).map((o) => o.fill)).toEqual(
      objects.map((o) => resolveLbxAreaFillOp(o)),
    );
  });

  it('gives every mark its OWN ropMode — the forced-knockout special case is gone', () => {
    const ops = resolveLbxPaintOps([
      text(5, 5, 20, 8, 'COPYPEN'),
      text(30, 5, 20, 8, 'NOTCOPYPEN'),
    ]);
    expect(ops.map((o) => o.mark)).toEqual(['set', 'clear']);
    expect(ops.map((o) => o.fill)).toEqual([null, null]);
  });

  it('an unfilled (outline-only) rect fills no area', () => {
    const frame = {
      type: 'rect' as const,
      position: { x: 0, y: 0, width: 80, height: 30 },
      pen: { style: 'SOLID' as const, widthX: 1 },
    };
    expect(resolveLbxPaintOps([frame])[0]).toEqual({ fill: null, mark: 'set' });
  });

  it('treats an unknown/absent ropMode as a normal COPYPEN paint', () => {
    expect(resolveLbxPaintOps([rect(0, 0, 10, 10, 'MERGEPEN')])[0].fill).toBe('set');
    expect(resolveLbxPaintOps([rect(0, 0, 10, 10)])[0].fill).toBe('set');
  });
});

describe('resolveLbxSurfaceAt — per-point compositing', () => {
  it('paints a COPYPEN filled box as ink, and COPYPEN text on it prints ink too (invisibly)', () => {
    const objects = [rect(0, 0, 50, 20, 'COPYPEN'), text(5, 5, 20, 8)];
    expect(resolveLbxSurfaceAt(objects, 25, 10)).toBe('ink');
    expect(resolveLbxMarkSurfaceAt(objects, 1, 15, 9)).toBe('ink');
  });

  it('leaves text on bare tape printing in ink', () => {
    const objects = [rect(0, 0, 20, 20), text(60, 5, 20, 8)];
    expect(resolveLbxMarkSurfaceAt(objects, 1, 70, 9)).toBe('ink');
  });

  it('NOTCOPYPEN over bare tape prints NOTHING — dst := NOT pen, and the pen is ink', () => {
    expect(resolveLbxSurfaceAt([rect(50, 4, 1.5, 25, 'NOTCOPYPEN')], 50.7, 16)).toBe('tape');
  });

  it('NOTCOPYPEN over an ink-filled box clears it back to bare tape', () => {
    const objects = [
      rect(0, 0, 50, 30, 'COPYPEN'),
      rect(5, 5, 20, 10, 'NOTCOPYPEN'),
      text(8, 7, 14, 6),
    ];
    expect(resolveLbxSurfaceAt(objects, 15, 10)).toBe('tape');
    expect(resolveLbxMarkSurfaceAt(objects, 2, 15, 10)).toBe('ink');
  });

  it('a genuine R2_NOT paint still inverts what is under it', () => {
    const objects = [rect(0, 0, 50, 30, 'COPYPEN'), rect(5, 5, 20, 10, 'NOT')];
    expect(resolveLbxSurfaceAt(objects, 15, 10)).toBe('tape'); // ink → tape
    expect(resolveLbxSurfaceAt([rect(5, 5, 20, 10, 'NOT')], 15, 10)).toBe('ink'); // tape → ink
  });

  it('an unfilled (outline-only) rect does NOT change the surface beneath it', () => {
    const frame = {
      type: 'rect' as const,
      position: { x: 0, y: 0, width: 80, height: 30 },
      pen: { style: 'SOLID' as const, widthX: 1 },
    };
    const objects = [frame, text(10, 10, 20, 8)];
    expect(resolveLbxSurfaceAt(objects, 40, 15)).toBe('tape');
    expect(resolveLbxMarkSurfaceAt(objects, 1, 20, 14)).toBe('ink');
  });

  it('resolves DIFFERENT tones at different points of ONE object — what a centre sample cannot do', () => {
    const objects = [
      rect(0, 0, 80, 30, 'COPYPEN'), // white box
      rect(5, 5, 70, 20, 'NOTCOPYPEN'), // black badge inside it
      rect(0, 8, 80, 2, 'NOTCOPYPEN'), // 2pt rule crossing the badge
    ];
    expect(resolveLbxSurfaceAt(objects, 40, 9)).toBe('tape'); // rule over the badge: no change
    expect(resolveLbxSurfaceAt(objects, 40, 15)).toBe('tape'); // badge below it
    expect(resolveLbxSurfaceAt(objects, 40, 27)).toBe('ink'); // box below the badge
    expect(resolveLbxSurfaceAt(objects, 78, 9)).toBe('tape'); // same rule notching the box margin
    expect(resolveLbxSurfaceAt(objects, 78, 15)).toBe('ink'); // margin, clear of the rule
  });
});

describe('LbxViewer embed chrome', () => {
  it('reports the label’s own aspect ratio, measured on the bled viewBox', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const reported: (number | null)[] = [];
    const el = await mount(
      <TestViewer
        onIntrinsicAspectRatio={(ratio) => reported.push(ratio)}
        src='/api/x/content'
        title='x10b.lbx'
      />,
    );
    await waitFor(() => el.querySelector('svg') !== null);
    await waitFor(() => reported.length > 0);

    const [x, y, width, height] = el
      .querySelector('svg')!
      .getAttribute('viewBox')!
      .split(' ')
      .map(Number);
    expect(x).toBeLessThan(0); // bleed, inside the viewBox
    expect(y).toBeLessThan(0);
    expect(reported.at(-1)).toBeCloseTo(width / height, 5);
    expect(reported.at(-1)!).toBeGreaterThan(2);
  });
});

describe('LbxViewer against a hand-authored knockout label', () => {
  it('renders the full inversion chain end-to-end through the real parse pipeline', async () => {
    stubFetchKnockoutLabel();
    const el = await mount(<TestViewer src='/api/x/content' title='x10b.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const rects = Array.from(el.querySelectorAll('[data-lbx-object="rect"]'));
    expect(rects.length).toBe(4);

    expect(partOf(rects[0], 'fill')).toBeNull();
    expect(partOf(rects[0], 'outline')!.getAttribute('data-lbx-blend')).toBe('set');

    expect(rects[1].getAttribute('data-lbx-rop')).toBe('COPYPEN');
    expect(partOf(rects[1], 'fill')!.getAttribute('data-lbx-blend')).toBe('set');

    expect(rects[2].getAttribute('data-lbx-rop')).toBe('NOTCOPYPEN');
    expect(partOf(rects[2], 'fill')!.getAttribute('data-lbx-blend')).toBe('clear');

    expect(rects[3].getAttribute('data-lbx-rop')).toBe('NOTCOPYPEN');
    expect(partOf(rects[3], 'fill')!.getAttribute('data-lbx-blend')).toBe('clear');
  });

  it('resolves every text run to the tone its own raster op asks for', async () => {
    stubFetchKnockoutLabel();
    const objects = await parseStubbedObjects();

    expect(textToneAtCentre(objects, 'X10B')).toBe('ink');
    expect(textToneAtCentre(objects, 'INPUT')).toBe('ink'); // inside the cleared badge
    expect(textToneAtCentre(objects, 'MODEL ONLY')).toBe('ink'); // bare tape
    expect(resolveLbxSurfaceAt(objects, 25, 21, objectIndexOfText(objects, 'INPUT'))).toBe('tape');
  });
});

const CROSSED_RULES_LABEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<pt:document ${NS} version="1.7" generator="fixture">
  <pt:body currentSheet="Sheet 1" direction="LTR">
    <style:sheet name="Sheet 1">
      <style:paper media="0" width="33.6pt" height="89.2pt" marginLeft="2.8pt" marginTop="5.6pt" marginRight="2.8pt" marginBottom="5.6pt" orientation="landscape" autoLength="false" paperColor="#000000" paperInk="#FFFFFF" format="259"/>
      <pt:objects>
        ${rectXml({ x: 13.9, y: 2.8, w: 71.8, h: 28.1, rop: 'COPYPEN', filled: true })}
        ${rectXml({ x: 16.5, y: 4.2, w: 66.6, h: 12.5, rop: 'NOTCOPYPEN', filled: true })}
        ${rectXml({ x: 13.9, y: 9, w: 71.8, h: 2.1, rop: 'NOTCOPYPEN', filled: true })}
        ${textXml({ x: 22.9, y: 5.2, w: 54, h: 10.9, rop: 'COPYPEN', font: 'Narrow Display', data: 'X10B' })}
        ${rectXml({ x: 16.5, y: 18.5, w: 66.6, h: 10.5, rop: 'NOTCOPYPEN', filled: true })}
        ${rectXml({ x: 13.9, y: 22.5, w: 71.8, h: 2.1, rop: 'NOTCOPYPEN', filled: true })}
        ${textXml({ x: 22.7, y: 18.9, w: 54.2, h: 9.6, rop: 'COPYPEN', font: 'Inverse Pixel', data: 'INPUT' })}
      </pt:objects>
    </style:sheet>
  </pt:body>
</pt:document>`;

const BOX = 0;
const X10B_RULE = 2;
const X10B_TEXT = 3;
const INPUT_RULE = 5;
const INPUT_TEXT = 6;

function stubFetchCrossedRulesLabel(): void {
  const buffer = zipStored([{ name: 'label.xml', content: CROSSED_RULES_LABEL_XML }]);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => buffer })),
  );
}

describe('LbxViewer against thin rules crossing text', () => {
  it('REGRESSION: a text run crossed by a thin rule prints white, unbroken, on the badge beneath it', async () => {
    stubFetchCrossedRulesLabel();
    const objects = await parseStubbedObjects();

    for (const [textIdx, ruleIdx] of [
      [X10B_TEXT, X10B_RULE],
      [INPUT_TEXT, INPUT_RULE],
    ]) {
      const t = objects[textIdx].position;
      const r = objects[ruleIdx].position;
      const cy = t.y + t.height / 2;
      expect(cy).toBeGreaterThanOrEqual(r.y);
      expect(cy).toBeLessThanOrEqual(r.y + r.height);
      expect(r.height).toBeLessThan(t.height / 3); // a rule, not a badge
    }

    expect(resolveLbxSurfaceAt(objects, 45, 13.5, X10B_TEXT)).toBe('tape'); // badge
    expect(resolveLbxMarkSurfaceAt(objects, X10B_TEXT, 45, 13.5)).toBe('ink');
    expect(resolveLbxSurfaceAt(objects, 45, 26, INPUT_TEXT)).toBe('tape');
    expect(resolveLbxMarkSurfaceAt(objects, INPUT_TEXT, 45, 26)).toBe('ink');

    expect(resolveLbxSurfaceAt(objects, 45, 10, X10B_TEXT)).toBe('tape');
    expect(resolveLbxMarkSurfaceAt(objects, X10B_TEXT, 45, 10)).toBe('ink');
  });

  it('renders the rules as thin composited rules, not flat full-height slabs', async () => {
    stubFetchCrossedRulesLabel();
    const el = await mount(<TestViewer src='/api/x/content' title='x10b.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const rects = Array.from(el.querySelectorAll('[data-lbx-object="rect"]'));
    const ruleFill = rects[X10B_RULE].querySelector('[data-lbx-part="fill"]')!;
    expect(ruleFill.getAttribute('height')).toBe('2.1');
    expect(Number(ruleFill.getAttribute('height'))).toBeLessThan(
      Number(rects[BOX].querySelector('[data-lbx-part="fill"]')!.getAttribute('height')) / 10,
    );
    expect(ruleFill.getAttribute('data-lbx-blend')).toBe('clear');
    expect((ruleFill as HTMLElement).style.mixBlendMode).toBe('normal');

    const objects = await parseStubbedObjects();
    expect(resolveLbxSurfaceAt(objects, 45, 10)).toBe('tape'); // rule over the badge
    expect(resolveLbxSurfaceAt(objects, 84, 10)).toBe('tape'); // same rule, past the badge
    expect(resolveLbxSurfaceAt(objects, 84, 13)).toBe('ink'); // the box, clear of the rule
  });

});

const ROUNDNESS_LABEL_XML = `<?xml version="1.0" encoding="UTF-8"?>
<pt:document ${NS} version="1.7" generator="fixture">
  <pt:body currentSheet="Sheet 1" direction="LTR">
    <style:sheet name="Sheet 1">
      <style:paper media="0" width="33.6pt" height="89.2pt" marginLeft="2.8pt" marginTop="5.6pt" marginRight="2.8pt" marginBottom="5.6pt" orientation="landscape" autoLength="false" paperColor="#000000" paperInk="#FFFFFF" format="259"/>
      <pt:objects>
        ${rectXml({ x: 4, y: 4, w: 30, h: 24, rop: 'COPYPEN', filled: true, shape: 'RECTANGLE', roundness: 6 })}
        ${rectXml({ x: 40, y: 4, w: 30, h: 24, rop: 'COPYPEN', filled: true, shape: 'ROUNDRECTANGLE', roundness: 6 })}
        ${rectXml({ x: 76, y: 4, w: 10, h: 24, rop: 'COPYPEN', filled: true, shape: 'ROUNDRECTANGLE', roundness: 0 })}
      </pt:objects>
    </style:sheet>
  </pt:body>
</pt:document>`;

describe('rect corner radii', () => {
  it('squares a RECTANGLE, halves a ROUNDRECTANGLE, and invents nothing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        arrayBuffer: async () => zipStored([{ name: 'label.xml', content: ROUNDNESS_LABEL_XML }]),
      })),
    );
    const el = await mount(<TestViewer src='/api/x/content' title='roundness.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    const fills = Array.from(el.querySelectorAll('[data-lbx-object="rect"]')).map((r) =>
      partOf(r, 'fill')!,
    );
    expect(fills.length).toBe(3);

    expect(fills[0].getAttribute('rx')).toBeNull();
    expect(fills[0].getAttribute('ry')).toBeNull();

    expect(fills[1].getAttribute('rx')).toBe('3');
    expect(fills[1].getAttribute('ry')).toBe('3');
    expect(fills[1].getAttribute('rx')).not.toBe('6'); // the raw diameter, which shipped

    expect(fills[2].getAttribute('rx')).toBeNull();
    expect(fills[2].getAttribute('ry')).toBeNull();
  });
});

describe('LBX font substitution', () => {
  it('points "Block Display" at the bundled @font-face family, with fallbacks behind it', () => {
    expect(fontStack('Block Display')).toMatch(/^'Block Display',/);
    expect(fontStack('block display')).toBe(LABEL_FONTS['block display']!.stack);
  });

  it('points the other two brand faces at their bundled families, fallbacks behind', () => {
    expect(fontStack('Inverse Pixel')).toMatch(/^'Inverse Pixel',/);
    expect(fontStack('Narrow Display')).toMatch(/^'Narrow Display',/);
    expect(fontStack('Inverse Pixel')).toContain('monospace');
    expect(fontStack('Narrow Display')).toContain('Arial Narrow');
    expect(fontStack('Inverse Pixel')).not.toContain("'Block Display'");
  });

  it('sniffs unknown pixel-ish faces onto the blocky stack and everything else onto condensed', () => {
    expect(fontStack('Some 8-bit Face')).toContain('monospace');
    expect(fontStack('Helsinki')).toContain('Arial Narrow');
    expect(fontStack(undefined)).toContain('Arial Narrow');
  });
});

const REFERENCE_TOLERANCE_PT = 0.25;

const MEASURED = {
  x10b: { top: 5.502, bottom: 14.556 },
  lower: { top: 18.117, bottom: 28.614 },
  north: { left: 5.614, right: 10.429 },
  ground: { left: 11.103, right: 14.859 },
} as const;

const MEASURED_RUN = {
  north: { start: 30.9, end: 2.897 },
  ground: { start: 30.803, end: 2.994 },
} as const;

const RUN_TOLERANCE_PT = 0.3;

function pageYOfLayoutX(layout: { cx: number; cy: number }, x: number): number {
  return layout.cy - (x - layout.cx);
}

const BOX27 = { top: 4, height: 12.3 };
const BOX28 = { top: 17.3, height: 12.3 };

function textObjectNamed(objects: readonly LbxObject[], firstLine: string): LbxTextObject {
  const obj = objects[objectIndexOfText(objects, firstLine)];
  if (obj.type !== 'text') throw new Error(`${firstLine} is not a text object`);
  return obj;
}

function pageXOfLayoutY(layout: { cx: number; cy: number }, y: number): number {
  return layout.cx + (y - layout.cy);
}

describe('LBX font metrics table', () => {
  it('normalises Narrow Display POSITIVE hhea descender to zero descent', () => {
    expect(LABEL_FONTS['narrow display']!.metrics!.descender).toBeGreaterThan(0);
    const narrow = fontMetrics('Narrow Display');
    expect(narrow.descent).toBe(0);
    expect(narrow.ascent).toBeCloseTo(2389 / 2048, 6);
    expect(narrow.source).toBe('host');
    expect(narrow.inkBottom).toBeCloseTo(341 / 2048, 6);
    expect(narrow.inkTop).toBeCloseTo(2389 / 2048, 6);

    expect(fontMetrics('Block Display').descent).toBeCloseTo(128 / 1024, 6);
  });

  it('routes unbundled and unknown faces to the documented fallback, flagged as such', () => {
    for (const name of ['Helsinki', 'Letter Gothic', 'No Such Face', undefined]) {
      const metrics = fontMetrics(name);
      expect(metrics.source).toBe('fallback');
      expect(metrics.ascent).toBeCloseTo(LBX_FALLBACK_FONT_METRICS.ascender / 2048, 6);
    }
    expect(fontMetrics('  NARROW DISPLAY ').source).toBe('host');
  });
});

describe('resolveLbxTextBaselines vs the reference render', () => {
  it('places the X10B run where Brother prints it — measured, not eyeballed', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();
    const layout = baselinesOf(textObjectNamed(objects, 'X10B'));

    expect(layout.baselines).toHaveLength(1);
    expect(layout.perpendicular).toBe(false);

    expect(Math.abs(layout.inkTop - MEASURED.x10b.top)).toBeLessThan(REFERENCE_TOLERANCE_PT);
    expect(Math.abs(layout.inkBottom - MEASURED.x10b.bottom)).toBeLessThan(REFERENCE_TOLERANCE_PT);

    const centreFraction = (layout.inkTop + layout.inkBottom) / 2 - BOX27.top;
    const measuredFraction = (MEASURED.x10b.top + MEASURED.x10b.bottom) / 2 - BOX27.top;
    expect(Math.abs(centreFraction - measuredFraction) / BOX27.height).toBeLessThan(0.02);
    expect(layout.inkTop).toBeGreaterThan(BOX27.top);
    expect(layout.inkBottom).toBeLessThan(BOX27.top + BOX27.height);
  });

  it('REGRESSION: the retired guessed constants miss that band by ~3pt', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();
    const obj = textObjectNamed(objects, 'X10B');
    const layout = baselinesOf(obj);

    const size = obj.font.size;
    const legacyLineHeight = size * 1.15 + (obj.lineSpace ?? 0);
    const legacyBlockTop =
      obj.position.y + Math.max(0, (obj.position.height - legacyLineHeight) / 2);
    const legacyBaseline = legacyBlockTop + size * 0.82;
    expect(legacyBaseline).toBeCloseTo(12.855, 3);

    const narrow = fontMetrics('Narrow Display');
    const legacyInkTop = legacyBaseline - narrow.inkTop * size;
    expect(legacyInkTop).toBeLessThan(2.8);
    expect(Math.abs(legacyInkTop - MEASURED.x10b.top)).toBeGreaterThan(3);

    expect(layout.baselines[0] - legacyBaseline).toBeGreaterThan(2.5);
  });

  it('centres the two-line INPUT / MODEL ONLY block as a block, on its real line advance', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();
    const obj = textObjectNamed(objects, 'INPUT');
    const layout = baselinesOf(obj);

    expect(layout.baselines).toHaveLength(2);
    expect(obj.lineSpace ?? 0).toBe(0);
    expect(layout.lineAdvance).toBeCloseTo(5.25, 6);
    expect(layout.baselines[1] - layout.baselines[0]).toBeCloseTo(5.25, 6);

    expect(Math.abs(layout.inkTop - MEASURED.lower.top)).toBeLessThan(REFERENCE_TOLERANCE_PT);
    expect(Math.abs(layout.inkBottom - MEASURED.lower.bottom)).toBeLessThan(REFERENCE_TOLERANCE_PT);

    const inkCentre = (layout.inkTop + layout.inkBottom) / 2;
    const measuredCentre = (MEASURED.lower.top + MEASURED.lower.bottom) / 2;
    expect(Math.abs(inkCentre - measuredCentre) / BOX28.height).toBeLessThan(0.02);
    expect(Math.abs(inkCentre - (BOX28.top + BOX28.height / 2)) / BOX28.height).toBeLessThan(0.02);
  });

  it('moves the rotated NORTH / GROUND spine runs ONTO the measured band, not off it', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();

    const north = baselinesOf(textObjectNamed(objects, 'NORTH'));
    expect(north.perpendicular).toBe(true);
    expect(north.angle).toBe(270);
    expect(Math.abs(pageXOfLayoutY(north, north.inkTop) - MEASURED.north.left)).toBeLessThan(
      REFERENCE_TOLERANCE_PT,
    );
    expect(Math.abs(pageXOfLayoutY(north, north.inkBottom) - MEASURED.north.right)).toBeLessThan(
      REFERENCE_TOLERANCE_PT,
    );

    const ground = baselinesOf(textObjectNamed(objects, 'GROUND'));
    expect(ground.perpendicular).toBe(true);
    expect(Math.abs(pageXOfLayoutY(ground, ground.inkTop) - MEASURED.ground.left)).toBeLessThan(
      REFERENCE_TOLERANCE_PT,
    );
    expect(Math.abs(pageXOfLayoutY(ground, ground.inkBottom) - MEASURED.ground.right)).toBeLessThan(
      REFERENCE_TOLERANCE_PT,
    );

    expect(pageXOfLayoutY(north, north.inkBottom)).toBeLessThan(
      pageXOfLayoutY(ground, ground.inkTop),
    );
  });

  describe('the spine runs justify across their frame', () => {
    function predictedRunEnd(
      layout: ReturnType<typeof resolveLbxTextBaselines>,
      word: string,
      pitch: number,
    ): number {
      const lastInkEm = LAST_GLYPH_INK_EM[word.slice(-1)]!;
      return pageYOfLayoutX(layout, layout.textX) - (word.length - 1 + lastInkEm) * pitch;
    }

    it('marks both spine runs justified and stretches them to the FRAME, not the face', async () => {
      stubFetchRealFixture(X10B_FIXTURE_PATH);
      const objects = await parseStubbedObjects();

      for (const [word, expectedFrame] of [
        ['NORTH', 28.7],
        ['GROUND', 28.5],
      ] as const) {
        const obj = textObjectNamed(objects, word);
        expect(obj.horizontalAlignment, `${word} alignment`).toBe('JUSTIFY');
        const layout = baselinesOf(obj);
        expect(layout.perpendicular, `${word} perpendicular`).toBe(true);
        expect(layout.justified, `${word} justified`).toBe(true);
        expect(layout.textLength).toBeCloseTo(expectedFrame, 6);
        expect(layout.textLength).toBeCloseTo(layout.layoutWidth, 6);
        expect(layout.textLength).not.toBeCloseTo(layout.size * word.length, 2);
      }
    });

    it('lands the stretched runs on the measured advance band', async () => {
      stubFetchRealFixture(X10B_FIXTURE_PATH);
      const objects = await parseStubbedObjects();

      for (const [word, measured] of [
        ['NORTH', MEASURED_RUN.north],
        ['GROUND', MEASURED_RUN.ground],
      ] as const) {
        const layout = baselinesOf(textObjectNamed(objects, word));
        const pitch = layout.textLength! / word.length;

        expect(
          Math.abs(pageYOfLayoutX(layout, layout.textX) - measured.start),
          `${word} run start`,
        ).toBeLessThan(RUN_TOLERANCE_PT);

        expect(
          Math.abs(predictedRunEnd(layout, word, pitch) - measured.end),
          `${word} run end`,
        ).toBeLessThan(RUN_TOLERANCE_PT);
      }
    });

    it('REGRESSION: the face’s natural advance leaves both runs ~2pt short at the far end', async () => {
      stubFetchRealFixture(X10B_FIXTURE_PATH);
      const objects = await parseStubbedObjects();

      for (const [word, measured] of [
        ['NORTH', MEASURED_RUN.north],
        ['GROUND', MEASURED_RUN.ground],
      ] as const) {
        const layout = baselinesOf(textObjectNamed(objects, word));
        const legacyEnd = predictedRunEnd(layout, word, layout.size);
        expect(legacyEnd - measured.end, `${word} legacy shortfall`).toBeGreaterThan(1.5);
        expect(legacyEnd).toBeGreaterThan(
          predictedRunEnd(layout, word, layout.textLength! / word.length),
        );
      }
    });

    it('leaves the CENTER-aligned horizontal runs alone — nothing to justify there', async () => {
      stubFetchRealFixture(X10B_FIXTURE_PATH);
      const objects = await parseStubbedObjects();
      for (const first of ['X10B', 'INPUT']) {
        const layout = baselinesOf(textObjectNamed(objects, first));
        expect(layout.justified, `${first} justified`).toBe(false);
        expect(layout.textLength, `${first} textLength`).toBeNull();
        expect(layout.anchor).toBe('middle');
      }
    });

    it('renders the stretch as textLength + spacingAndGlyphs on the run itself', async () => {
      stubFetchRealFixture(X10B_FIXTURE_PATH);
      const el = await mount(<TestViewer src='/api/x/content' title='x10b.lbx' />);
      await waitFor(() => el.querySelector('svg') !== null);

      const runFor = (word: string): SVGTextElement => {
        const match = [...el.querySelectorAll('[data-lbx-object="text"] text')].find(
          (node) => node.textContent === word,
        );
        if (!match) throw new Error(`no rendered run for ${word}`);
        return match as unknown as SVGTextElement;
      };

      for (const [word, frame] of [
        ['NORTH', 28.7],
        ['GROUND', 28.5],
      ] as const) {
        const run = runFor(word);
        expect(Number(run.getAttribute('textLength')), `${word} textLength`).toBeCloseTo(frame, 6);
        expect(run.getAttribute('lengthAdjust'), `${word} lengthAdjust`).toBe('spacingAndGlyphs');
      }

      for (const word of ['X10B', 'INPUT']) {
        const run = runFor(word);
        expect(run.getAttribute('textLength'), `${word} textLength`).toBeNull();
        expect(run.getAttribute('lengthAdjust'), `${word} lengthAdjust`).toBeNull();
      }
    });
  });

  it('DELTA lands on the same band — the two labels differ only in the word', async () => {
    stubFetchRealFixture(DELTA_FIXTURE_PATH);
    const objects = await parseStubbedObjects();
    const layout = baselinesOf(textObjectNamed(objects, 'DELTA'));
    expect(Math.abs(layout.inkTop - MEASURED.x10b.top)).toBeLessThan(REFERENCE_TOLERANCE_PT);
    expect(Math.abs(layout.inkBottom - MEASURED.x10b.bottom)).toBeLessThan(REFERENCE_TOLERANCE_PT);
  });

  it('honours TOP / BOTTOM alignment and overflows CENTER symmetrically (no clamp)', () => {
    const base: LbxTextObject = {
      type: 'text',
      position: { x: 0, y: 10, width: 50, height: 20 },
      font: { name: 'Narrow Display', size: 9 },
      data: 'X',
    };
    const ascent = (2389 / 2048) * 9;

    expect(baselinesOf({ ...base, verticalAlignment: 'TOP' }).baselines[0]).toBeCloseTo(
      10 + ascent,
      6,
    );
    expect(baselinesOf({ ...base, verticalAlignment: 'BOTTOM' }).baselines[0]).toBeCloseTo(30, 6);
    expect(baselinesOf(base).baselines[0]).toBeCloseTo(10 + ascent, 6);

    const tight: LbxTextObject = {
      ...base,
      position: { x: 0, y: 10, width: 50, height: 4 },
      verticalAlignment: 'CENTER',
    };
    const layout = baselinesOf(tight);
    expect(layout.blockTop).toBeLessThan(10);
    expect(layout.blockTop).toBeCloseTo(10 + (4 - ascent) / 2, 6);
  });

  it('writes the computed baselines onto the rendered SVG text nodes', async () => {
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const objects = await parseStubbedObjects();
    stubFetchRealFixture(X10B_FIXTURE_PATH);
    const el = await mount(<TestViewer src='/api/x/content' title='x10b-label.lbx' />);
    await waitFor(() => el.querySelector('svg') !== null);

    for (const first of ['X10B', 'INPUT', 'NORTH', 'GROUND']) {
      const layout = baselinesOf(textObjectNamed(objects, first));
      const group = closestG(
        Array.from(el.querySelectorAll('[data-lbx-object="text"] text')).find(
          (t) => t.textContent === first,
        )!,
      )!;
      const ys = Array.from(group.querySelectorAll('text')).map((t) => Number(t.getAttribute('y')));
      expect(ys).toHaveLength(layout.baselines.length);
      ys.forEach((y, i) => expect(y).toBeCloseTo(layout.baselines[i], 6));
    }
  });
});
