import type { LbxLabel } from './parse.ts';

export interface LbxColors {
  /** Physical stock (background) colour. */
  tape: string;
  /** Physical ink (foreground) colour. */
  ink: string;
}

/** Black on white: Brother's own default and the commonest cassette. */
export const DEFAULT_LBX_COLORS: LbxColors = { tape: '#ffffff', ink: '#000000' };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/;

/**
 * The tape/ink colours a label should render with, from `style:paper`.
 *
 * `bil-lbx`'s serialiser writes `#FFFFFF`/`#000000` on every file, so exactly
 * that pair is indistinguishable from "never set" and also takes `fallback`.
 * Hosts that always print on one stock should pass it as the fallback.
 */
export function resolveLbxBaseColors(
  label: LbxLabel,
  fallback: LbxColors = DEFAULT_LBX_COLORS,
): LbxColors {
  const tape = label.paper.paperColor?.trim().toLowerCase();
  const ink = label.paper.paperInk?.trim().toLowerCase();
  if (!tape || !ink || !HEX.test(tape) || !HEX.test(ink)) return fallback;
  if (tape === '#ffffff' && ink === '#000000') return fallback;
  return { tape, ink };
}
