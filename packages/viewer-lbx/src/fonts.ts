import { findLbxFont, type LbxFonts } from './font-metrics.ts';

/** For Brother's own Helsinki, and narrow display faces without a file. */
export const LBX_CONDENSED_STACK =
  "'Arial Narrow', 'Liberation Sans Narrow', 'Roboto Condensed', 'Helvetica Neue', Helvetica, Arial, sans-serif";

/**
 * For bitmap-styled display faces: pixel fonts a machine might have, then
 * monospace, whose uniform advance reads far closer than Helvetica does.
 */
export const LBX_PIXEL_STACK =
  "'Silkscreen', 'Press Start 2P', 'Perfect DOS VGA 437', 'DejaVu Sans Mono', 'Liberation Mono', 'Courier New', monospace";

/** Substitutes for P-touch Editor's built-in faces. */
const BUILT_IN: Readonly<Record<string, string>> = {
  helsinki: LBX_CONDENSED_STACK,
  brussels: LBX_CONDENSED_STACK,
  'letter gothic': "'Letter Gothic Std', 'Courier New', monospace",
};

/**
 * Brother font name to CSS stack: host fonts, then built-in substitutes, then a
 * keyword sniff so an unknown pixel face still gets a blocky stack. Names come
 * from the file, so they are never placed in the stack themselves.
 */
export function resolveLbxFontStack(name: string | undefined, fonts: LbxFonts = {}): string {
  const font = findLbxFont(fonts, name);
  if (font) return font.stack;
  const key = (name ?? '').trim().toLowerCase();
  if (Object.hasOwn(BUILT_IN, key)) return BUILT_IN[key] ?? LBX_CONDENSED_STACK;
  if (/pixel|bitmap|8[\s-]?bit|arcade|retro|press start|dos/.test(key)) return LBX_PIXEL_STACK;
  return LBX_CONDENSED_STACK;
}
