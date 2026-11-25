import { XMLParser } from 'fast-xml-parser';
import JSZip from 'jszip';
import {
  parseLbx as parseUpstream,
  type BrushConfig,
  type BrushStyle,
  type LabelConfig,
  type LabelObject,
  type ObjectPosition,
  type PaperConfig,
} from 'bil-lbx';

/** Attributes `bil-lbx` does not surface, read from the same `label.xml`. */
export interface LbxPosition extends ObjectPosition {
  /**
   * GDI raster-operation mode. `NOTCOPYPEN` is how P-touch renders knockout
   * regions; without it every object paints as ink and reversed text vanishes.
   * A string, not a union: P-touch can emit any of the sixteen ROP2 names.
   */
  ropMode?: string | undefined;
}

export interface LbxPaper extends PaperConfig {
  /** Physical stock colour, e.g. `#000000` for black tape. */
  paperColor?: string | undefined;
  /** Ink colour, e.g. `#FFFFFF`. */
  paperInk?: string | undefined;
}

export interface LbxBrush extends Omit<BrushConfig, 'style'> {
  /** Real P-touch files write `PATTERN` for a plain filled box; upstream's union omits it. */
  style: BrushStyle | 'PATTERN';
}

// Distributes over the union, keeping `type` discriminating.
type Widen<T extends LabelObject> = T extends LabelObject
  ? Omit<T, 'position' | 'brush'> & { position: LbxPosition; brush?: LbxBrush | undefined }
  : never;

export type LbxObject = Widen<LabelObject>;
export type LbxTextObject = Extract<LbxObject, { type: 'text' }>;
export type LbxLabel = Omit<LabelConfig, 'objects' | 'paper'> & {
  paper: LbxPaper;
  objects: LbxObject[];
};

/** label.xml is kilobytes; this stops a hostile ZIP from inflating without bound. */
const MAX_LABEL_XML_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;

const TAG_BY_TYPE = {
  text: 'text:text',
  rect: 'draw:rect',
  line: 'draw:poly',
  image: 'image:image',
  barcode: 'barcode:barcode',
} as const satisfies Record<LabelObject['type'], string>;

type XmlNode = Record<string, unknown>;

/**
 * Parse a `.lbx` with upstream `bil-lbx`, then add `ropMode`, `paperColor` and
 * `paperInk`. A supplement rather than a patched dependency, because package
 * manager patches do not travel to a library's consumers.
 */
export async function parseLbxLabel(data: ArrayBuffer | Uint8Array): Promise<LbxLabel> {
  const zip = await JSZip.loadAsync(data);
  assertReasonableSize(zip);
  const labelXml = await zip.file('label.xml')?.async('string');
  if (labelXml === undefined) throw new Error('Not a .lbx file: label.xml is missing');
  const label = (await parseUpstream(data)) as LbxLabel;
  supplementLabel(label, labelXml);
  return label;
}

/** Mutates `label` in place. Exported for tests. */
export function supplementLabel(label: LbxLabel, labelXml: string): void {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseAttributeValue: false,
    parseTagValue: false,
  });
  const sheet = child(
    child(child(parser.parse(labelXml), 'pt:document'), 'pt:body'),
    'style:sheet',
  );
  const paper = child(sheet, 'style:paper');
  const paperColor = attr(paper, 'paperColor');
  if (paperColor) label.paper.paperColor = paperColor;
  const paperInk = attr(paper, 'paperInk');
  if (paperInk) label.paper.paperInk = paperInk;

  // bil-lbx restores document order across element kinds, and order WITHIN a
  // kind always matches the document, so the nth object of a kind is that
  // kind's nth element.
  const objects = child(sheet, 'pt:objects');
  const seen: Partial<Record<string, number>> = {};
  for (const obj of label.objects) {
    const tag = TAG_BY_TYPE[obj.type];
    const index = seen[tag] ?? 0;
    seen[tag] = index + 1;
    const ropMode = attr(child(asArray(objects?.[tag])[index], 'pt:objectStyle'), 'ropMode');
    if (ropMode) obj.position.ropMode = ropMode;
  }
}

function assertReasonableSize(zip: JSZip): void {
  let total = 0;
  for (const entry of Object.values(zip.files)) {
    // Not in JSZip's public types; absent means unknown, which is not refused.
    const size = (entry as unknown as { _data?: { uncompressedSize?: number } })._data
      ?.uncompressedSize;
    if (typeof size !== 'number') continue;
    total += size;
    if (entry.name === 'label.xml' && size > MAX_LABEL_XML_BYTES) {
      throw new Error('label.xml is implausibly large');
    }
  }
  if (total > MAX_TOTAL_BYTES) throw new Error('The label archive is implausibly large');
}

function child(node: unknown, name: string): XmlNode | undefined {
  if (typeof node !== 'object' || node === null) return undefined;
  const value = (node as XmlNode)[name];
  return typeof value === 'object' && value !== null ? (value as XmlNode) : undefined;
}

function attr(node: XmlNode | undefined, name: string): string | undefined {
  const value = node?.[`@_${name}`];
  return value === undefined || value === null ? undefined : String(value);
}

function asArray(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}
