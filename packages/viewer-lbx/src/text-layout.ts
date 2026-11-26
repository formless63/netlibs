import { resolveLbxFontMetrics, type LbxResolvedFontMetrics } from './font-metrics.ts';
import type { LbxTextObject } from './parse.ts';

export function textLines(obj: LbxTextObject): string[] {
  return obj.data.split(/\r?\n/);
}

/** Everything `renderTextObject` needs to place one text run, all in pt. */
export interface LbxTextLayout {
  /**
   * The "as if horizontal" box the alignment math runs in. For a
   * perpendicular run this is the stored footprint with width/height swapped
   * back, kept centred on the same point.
   */
  layoutX: number;
  layoutY: number;
  layoutWidth: number;
  layoutHeight: number;
  /** Centre of the stored footprint — also the rotation centre. */
  cx: number;
  cy: number;
  /** Rotation normalised into [0, 360); `perpendicular` means 90 or 270. */
  angle: number;
  perpendicular: boolean;
  /** Font size actually used (the file's, or 12pt when it declares none). */
  size: number;
  /** Baseline → line-box top, in pt. */
  ascent: number;
  /** Baseline → line-box bottom, in pt. */
  descent: number;
  /** Baseline-to-baseline advance, including the file's own `lineSpace`. */
  lineAdvance: number;
  blockTop: number;
  blockHeight: number;
  /** One baseline per line of `data`, top to bottom. */
  baselines: number[];
  /**
   * Where the printed ink of the whole block actually lands — the glyph
   * extent, not the line box. Not used to place anything; it is what a
   * verification test compares against a measured reference render.
   */
  inkTop: number;
  inkBottom: number;
  /** Resolved horizontal anchor. */
  textX: number;
  anchor: 'start' | 'middle' | 'end';
  /** True when the file asks for `horizontalAlignment="JUSTIFY"`. */
  justified: boolean;
  /**
   * Advance the line must be stretched to, in pt — `layoutWidth` for a
   * justified run, `null` otherwise (render at the face's natural advance).
   * See `resolveLbxTextBaselines`'s JUSTIFY note.
   */
  textLength: number | null;
}

/**
 * Lay out one text object. Pure, so baselines can be checked against measurements
 * without rasterising; SVG's `dominant-baseline` is inconsistent across browsers.
 *
 * The line box is the face's own ascent, descent and line gap. Lines stack, the
 * block is aligned in the object's box, and each baseline sits `ascent` below the
 * block top. A block taller than its box overflows symmetrically when centred, so
 * the offsets are not clamped.
 *
 * JUSTIFY stretches each line across the frame, glyphs included (`textLength` with
 * `spacingAndGlyphs`). Against a measured P-touch render, the far end of two runs
 * landed within 0.22pt; the face's natural advance fell about 2pt short and the
 * file's `logFont width` about 1pt.
 */
export function resolveLbxTextBaselines(
  obj: LbxTextObject,
  metrics: LbxResolvedFontMetrics = resolveLbxFontMetrics(obj.font.name),
): LbxTextLayout {
  const { x, y, width, height, angle = 0 } = obj.position;
  const size = obj.font.size > 0 ? obj.font.size : 12;
  const lines = textLines(obj);

  const ascent = metrics.ascent * size;
  const descent = metrics.descent * size;
  // `lineSpace` is Brother's own extra leading, in pt, on top of the face's.
  const lineAdvance =
    (metrics.ascent + metrics.descent + metrics.lineGap) * size + (obj.lineSpace ?? 0);
  const blockHeight = lines.length * lineAdvance;

  // The stored objectStyle x/y/width/height are the FINAL on-canvas
  // footprint — for a perpendicular rotation (90/270, vertical text) that
  // footprint is already narrow×tall, not the "as if horizontal" box the
  // alignment math below expects. Lay the lines out in a virtual box with
  // width/height swapped back (centered on the same point); the caller
  // rotates the whole group into the real footprint.
  const cx = x + width / 2;
  const cy = y + height / 2;
  const normalizedAngle = ((angle % 360) + 360) % 360;
  const perpendicular = normalizedAngle === 90 || normalizedAngle === 270;
  const layoutWidth = perpendicular ? height : width;
  const layoutHeight = perpendicular ? width : height;
  const layoutX = cx - layoutWidth / 2;
  const layoutY = cy - layoutHeight / 2;

  const vAlign = obj.verticalAlignment ?? 'TOP';
  const blockTop =
    vAlign === 'CENTER'
      ? layoutY + (layoutHeight - blockHeight) / 2
      : vAlign === 'BOTTOM'
        ? layoutY + layoutHeight - blockHeight
        : layoutY;

  const baselines = lines.map((_, i) => blockTop + ascent + i * lineAdvance);

  const hAlign = obj.horizontalAlignment ?? 'LEFT';
  const anchor = hAlign === 'CENTER' ? 'middle' : hAlign === 'RIGHT' ? 'end' : 'start';
  const textX =
    hAlign === 'CENTER'
      ? layoutX + layoutWidth / 2
      : hAlign === 'RIGHT'
        ? layoutX + layoutWidth
        : layoutX;
  // JUSTIFY keeps the `start` anchor above and additionally stretches the
  // line across the frame. Guarded on a positive width so a degenerate/
  // zero-width object can never emit an invalid `textLength`.
  const justified = hAlign === 'JUSTIFY';
  const textLength = justified && layoutWidth > 0 ? layoutWidth : null;

  return {
    layoutX,
    layoutY,
    layoutWidth,
    layoutHeight,
    cx,
    cy,
    angle: normalizedAngle,
    perpendicular,
    size,
    ascent,
    descent,
    lineAdvance,
    blockTop,
    blockHeight,
    baselines,
    // Glyph extent, measured off the first and last baseline. `inkBottom` is
    // an em offset ABOVE the baseline for a face like Narrow Display whose
    // capitals float, hence the subtraction on both ends.
    inkTop: (baselines[0] ?? 0) - metrics.inkTop * size,
    inkBottom: (baselines.at(-1) ?? 0) - metrics.inkBottom * size,
    textX,
    anchor,
    justified,
    textLength,
  };
}
