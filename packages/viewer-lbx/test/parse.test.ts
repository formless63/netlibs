// @vitest-environment jsdom
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { fixture } from '../../../scripts/test-utils.tsx';
import { DEFAULT_LBX_COLORS, resolveLbxBaseColors, resolveLbxFontStack } from '../src/index.ts';
import { parseLbxLabel } from '../src/parse.ts';

describe('parseLbxLabel', () => {
  it('adds what upstream bil-lbx drops, aligned to the right objects', async () => {
    const label = await parseLbxLabel(fixture('label-x10b.lbx').buffer);
    expect(label.paper).toMatchObject({ paperColor: '#000000', paperInk: '#FFFFFF' });
    expect(label.objects.map((o) => `${o.type}:${o.position.ropMode}`)).toEqual([
      'rect:COPYPEN',
      ...Array.from({ length: 6 }, () => 'rect:NOTCOPYPEN'),
      ...Array.from({ length: 4 }, () => 'text:COPYPEN'),
    ]);
  });

  it('refuses archives that are not labels, and implausibly large ones', async () => {
    await expect(parseLbxLabel(zipSync({ 'word/document.xml': strToU8('<x/>') }))).rejects.toThrow(
      'label.xml',
    );
    const bomb = zipSync({ 'label.xml': new Uint8Array(9 * 1024 * 1024) });
    expect(bomb.length).toBeLessThan(64 * 1024);
    await expect(parseLbxLabel(bomb)).rejects.toThrow('implausibly large');
  });
});

describe('untrusted values', () => {
  it('only accepts hex stock colours from the file', async () => {
    const label = await parseLbxLabel(fixture('simple.lbx').buffer);
    expect(resolveLbxBaseColors(label)).toBe(DEFAULT_LBX_COLORS);
    label.paper.paperColor = 'url(https://evil.test/x)';
    label.paper.paperInk = '#fff';
    expect(resolveLbxBaseColors(label)).toBe(DEFAULT_LBX_COLORS);
  });

  it('never places a file’s font name into CSS', () => {
    expect(resolveLbxFontStack("x'; background: url(//evil)")).not.toContain('evil');
    expect(resolveLbxFontStack('constructor')).toContain('Arial Narrow');
  });
});
