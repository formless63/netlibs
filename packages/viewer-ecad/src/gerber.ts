import type { LayerIdentity } from '@tracespace/identify-layers';
import type { SizeEnvelope } from '@tracespace/plotter';

import { ViewerError } from '@formless63/viewer-core';

/** One layer's drawing, in its own file units. */
export interface GerberLayer {
  /** Inner SVG markup (no `<svg>` root), drawn in `currentColor`. */
  markup: string;
  units: 'mm' | 'in';
  /** x1, y1, x2, y2 in millimetres, y up. */
  bounds: readonly [number, number, number, number];
}

const MM_PER_IN = 25.4;

/** Lazy tracespace pipeline: parse → plot → hast → markup. */
export async function renderGerberLayer(text: string): Promise<GerberLayer> {
  const [{ parse }, { plot }, { renderFragment }, { toHtml }] = await Promise.all([
    import('@tracespace/parser'),
    import('@tracespace/plotter'),
    import('@tracespace/renderer'),
    import('hast-util-to-html'),
  ]);
  const image = plot(parse(text));
  const bounds = toMillimetres(image.size, image.units);
  if (!bounds) throw new ViewerError('parse-failed', 'The file has no drawable content');
  // The renderer returns a hast (virtual) tree typed against hast v2, where
  // `properties` is optional; the serialiser treats absent properties as none.
  // Safe sink: machine-generated SVG with escaped attributes, never file text.
  const markup = toHtml(renderFragment(image) as unknown as Parameters<typeof toHtml>[0], {
    space: 'svg',
  });
  return { markup, units: image.units === 'in' ? 'in' : 'mm', bounds };
}

/** Null when the envelope is empty or has no area. Pure, for tests. */
export function toMillimetres(
  size: SizeEnvelope,
  units: string | undefined,
): [number, number, number, number] | null {
  const [x1, y1, x2, y2] = size;
  if (x1 === undefined || y1 === undefined || x2 === undefined || y2 === undefined) return null;
  if (!(x2 - x1 > 0) || !(y2 - y1 > 0)) return null;
  const k = units === 'in' ? MM_PER_IN : 1;
  return [x1 * k, y1 * k, x2 * k, y2 * k];
}

export interface GerberViewBox {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

/** Union of layer bounds plus a margin, in mm with y down (SVG). Pure. */
export function unionViewBox(layers: readonly Pick<GerberLayer, 'bounds'>[]): GerberViewBox | null {
  if (layers.length === 0) return null;
  let [x1, y1, x2, y2] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { bounds } of layers) {
    x1 = Math.min(x1, bounds[0]);
    y1 = Math.min(y1, bounds[1]);
    x2 = Math.max(x2, bounds[2]);
    y2 = Math.max(y2, bounds[3]);
  }
  const margin = Math.max(x2 - x1, y2 - y1) * 0.03;
  return {
    minX: x1 - margin,
    minY: -y2 - margin,
    width: x2 - x1 + margin * 2,
    height: y2 - y1 + margin * 2,
  };
}

export interface GerberLayerStyle {
  label: string;
  color: string;
  opacity: number;
  /** Paint order, low first. */
  order: number;
}

const SIDE_LABEL: Record<string, string> = {
  top: 'Top',
  bottom: 'Bottom',
  inner: 'Inner',
  all: '',
};

/** Colour and stacking for an identified layer. Viewed from the top. Pure. */
export function gerberLayerStyle(identity: LayerIdentity | undefined): GerberLayerStyle {
  const side = identity?.side ?? null;
  const prefix = side ? (SIDE_LABEL[side] ?? '') : '';
  const label = (name: string) => `${prefix} ${name}`.trim();
  const bottom = side === 'bottom';
  const base = bottom ? 0 : side === 'inner' ? 10 : 20;
  switch (identity?.type) {
    case 'copper':
      return {
        label: label('copper'),
        color: bottom ? '#4d8fe0' : side === 'inner' ? '#b58be0' : '#e0574d',
        opacity: 0.85,
        order: base + 1,
      };
    case 'soldermask':
      return { label: label('solder mask'), color: '#2f9e62', opacity: 0.35, order: base + 2 };
    case 'solderpaste':
      return { label: label('solder paste'), color: '#9aa3ad', opacity: 0.7, order: base + 3 };
    case 'silkscreen':
      return {
        label: label('silkscreen'),
        color: bottom ? '#d7c86a' : '#f2f2f2',
        opacity: 0.9,
        order: base + 4,
      };
    case 'outline':
      return { label: 'Outline', color: '#f0c419', opacity: 1, order: 40 };
    case 'drill':
      return { label: 'Drill', color: '#00c2c7', opacity: 1, order: 41 };
    case 'drawing':
      return { label: 'Drawing', color: '#c0c0c0', opacity: 0.7, order: 42 };
    default:
      return { label: 'Layer', color: '#f59e0b', opacity: 0.85, order: 30 };
  }
}
