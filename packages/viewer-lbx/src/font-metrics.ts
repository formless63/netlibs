/**
 * Font metrics for the label's vertical text layout.
 *
 * Every line is positioned by an explicit SVG baseline, which needs the face's
 * ascent and descent synchronously at render time. Hosts supply the metrics of
 * the faces they load (`LbxFont.metrics`); everything else uses Arial's.
 *
 * ### The layout rule these feed, and the evidence for it
 *
 * Measured off a P-touch render of a label (895x327, about
 * 10.38 px/pt):
 *
 *   | run                 | box (pt)      | measured ink band | rule predicts |
 *   |---------------------|---------------|-------------------|---------------|
 *   | X10B (display 9pt)  | y 5.2 h 10.9  | 5.39 -> 14.44     | 5.40 -> 14.40 |
 *   | INPUT + MODEL ONLY  | y 16.7 h 13.1 | 18.00 -> 28.50    | 18.00 -> 28.50|
 *   | NORTH (spine, 270)  | x 5 w 6.1     | 5.61 -> 10.43 (x) | 5.69 -> 10.41 |
 *   | GROUND (spine)      | x 10.5 w 5    | 11.10 -> 14.86 (x)| 11.08 -> 14.93|
 *
 * The rule that reproduces all four: centre the LINE BOX (`ascent + descent +
 * lineGap`) in the object's box, then put each baseline `ascent` below the
 * block top. Rejected on evidence: centring the cap-height box (0.75pt low on
 * X10B, because that face floats its capitals above the baseline), and taking
 * the magnitude of a positive `hhea.descender` (0.8pt high).
 */

/** Raw design-unit metrics for one .ttf, exactly as its tables state them. */
export interface LbxFontMetrics {
  /** `head.unitsPerEm`. */
  unitsPerEm: number;
  /** `hhea.ascender` — design units above the baseline. */
  ascender: number;
  /**
   * `hhea.descender`. Spec says NEGATIVE (below the baseline); some
   * faces ship a positive value, which `resolveLbxFontMetrics` clamps away.
   */
  descender: number;
  /** `hhea.lineGap` — extra leading between lines. */
  lineGap: number;
  /**
   * `OS/2.sCapHeight` (version ≥ 2). **Not used for layout** — see the module
   * comment; it can disagree with the real `glyf` extent.
   */
  capHeight: number | null;
  /** Highest `glyf` yMax over A–Z / 0–9 — the top of the printed ink. */
  inkTop: number;
  /** Lowest `glyf` yMin over A–Z / 0–9 — the bottom of the printed ink. */
  inkBottom: number;
}

/** A face the host has loaded (via `@font-face` or `FontFace`). */
export interface LbxFont {
  /** CSS `font-family` value to render it with. */
  stack: string;
  /** Design metrics of the real file. Omit to use Arial's. */
  metrics?: LbxFontMetrics | undefined;
}

/** Keyed by the Brother `logFont` name, matched case-insensitively. */
export type LbxFonts = Readonly<Record<string, LbxFont>>;

export function findLbxFont(fonts: LbxFonts, name: string | undefined): LbxFont | undefined {
  const key = (name ?? '').trim().toLowerCase();
  if (!key) return undefined;
  for (const [candidate, font] of Object.entries(fonts)) {
    if (candidate.trim().toLowerCase() === key) return font;
  }
  return undefined;
}

/**
 * For a face the host did not describe. Those runs render in an Arial-like stack, and
 * Arial and Liberation Sans share these metrics by construction.
 */
export const LBX_FALLBACK_FONT_METRICS: LbxFontMetrics = {
  unitsPerEm: 2048,
  ascender: 1854,
  descender: -434,
  lineGap: 67,
  capHeight: 1467,
  inkTop: 1467,
  inkBottom: 0,
};

/** Metrics normalised to em fractions, ready to multiply by a point size. */
export interface LbxResolvedFontMetrics {
  /** Distance from the baseline UP to the line-box top, in em. */
  ascent: number;
  /** Distance from the baseline DOWN to the line-box bottom, in em. Never negative. */
  descent: number;
  /** Extra leading below each line, in em. */
  lineGap: number;
  /** Top of the printed ink above the baseline, in em (diagnostics/tests). */
  inkTop: number;
  /** Bottom of the printed ink relative to the baseline, in em; positive = floats above it. */
  inkBottom: number;
  /** Whether the host supplied these or the fallback was used. */
  source: 'host' | 'fallback';
}

/** Resolve a Brother `logFont` name to em-normalised metrics. */
export function resolveLbxFontMetrics(
  name: string | undefined,
  fonts: LbxFonts = {},
): LbxResolvedFontMetrics {
  const raw = findLbxFont(fonts, name)?.metrics;
  const metrics = raw ?? LBX_FALLBACK_FONT_METRICS;
  const em = metrics.unitsPerEm > 0 ? metrics.unitsPerEm : 1000;
  return {
    ascent: metrics.ascender / em,
    // A positive `hhea.descender` claims the descender is above the baseline,
    // which is the same as having none, so clamp rather than take the magnitude.
    descent: Math.max(0, -metrics.descender) / em,
    lineGap: Math.max(0, metrics.lineGap) / em,
    inkTop: metrics.inkTop / em,
    inkBottom: metrics.inkBottom / em,
    source: raw ? 'host' : 'fallback',
  };
}
