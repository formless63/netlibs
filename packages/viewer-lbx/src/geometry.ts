import type { LbxLabel } from './parse.ts';

/**
 * `bil-lbx` serializes auto-length sheets with a ~1m placeholder height
 * (2834.4pt); P-touch Editor writes similar sentinels. Any stored length
 * beyond this is treated as "not the real label length" and the object
 * extents win instead.
 */
const AUTO_LENGTH_SENTINEL_PT = 2000;

/**
 * Bleed (in pt) added around the label on every side of the SVG viewBox, so a
 * mark that overhangs the tape edge is still visible and the strip doesn't sit
 * flush against the embed's border. Being INSIDE the viewBox, it scales
 * with the label instead of eating a fixed margin at every preview size.
 */
export const LBX_VIEW_BLEED_PT = 4;

export interface LbxGeometry {
  /** Label length in pt (SVG x axis). */
  lengthPt: number;
  /** Tape width in pt (SVG y axis). */
  tapeWidthPt: number;
}

/** derive the drawable label geometry from a parsed config. */
export function resolveLbxGeometry(label: LbxLabel): LbxGeometry {
  const tapeWidthPt = label.paper.width > 0 ? label.paper.width : 33.6;

  let contentEndPt = 0;
  for (const obj of label.objects) {
    contentEndPt = Math.max(contentEndPt, obj.position.x + obj.position.width);
    if (obj.type === 'line') {
      for (const p of obj.points) contentEndPt = Math.max(contentEndPt, p.x);
    }
  }

  const storedLength = label.paper.height ?? 0;
  const storedUsable =
    storedLength > 0 && (!label.paper.autoLength || storedLength < AUTO_LENGTH_SENTINEL_PT);
  const marginPad = (label.paper.marginLeft ?? 2.8) * 2;
  const lengthPt = storedUsable
    ? Math.max(storedLength, contentEndPt)
    : contentEndPt > 0
      ? contentEndPt + marginPad
      : 100;

  return { lengthPt, tapeWidthPt };
}
