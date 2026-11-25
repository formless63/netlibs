/**
 * Theme-derived colour resolution for viewers that need concrete sRGB channels
 * (a WebGL surface colour cannot be `var(--primary)`).
 *
 * `resolveThemeColor` reads a CSS variable off the mount element's computed
 * style and round-trips it through a 1x1 canvas, the only parse-any-CSS-colour
 * primitive the platform offers (oklch included). `clampRgbLuminance` keeps the
 * result usable as a lit surface: a near-black or near-white theme primary
 * would otherwise kill all shading depth on a matte model.
 */

export interface ThemeRgb {
  r: number;
  g: number;
  b: number;
}

/**
 * Parse any browser-understood CSS color string to sRGB channels via a 1x1
 * canvas. Returns null for unparseable input (detected by priming the
 * context with two different fallback fills — an invalid assignment leaves
 * the prior fill in place, so the two passes disagree) and in canvas-less
 * environments (jsdom without node-canvas), where callers keep their
 * engine-default colors.
 */
export function cssColorToRgb(cssColor: string): ThemeRgb | null {
  const value = cssColor.trim();
  if (!value || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return null;

    const sample = (prime: string): readonly [number, number, number, number] => {
      context.fillStyle = prime;
      context.fillStyle = value;
      context.clearRect(0, 0, 1, 1);
      context.fillRect(0, 0, 1, 1);
      const { data } = context.getImageData(0, 0, 1, 1);
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
    };

    const first = sample('#000000');
    const second = sample('#ffffff');
    if (first.some((channel, index) => channel !== second[index])) return null; // invalid color string
    if (first[3] === 0) return null; // fully transparent — nothing usable
    return { r: first[0], g: first[1], b: first[2] };
  } catch {
    return null;
  }
}

/** WCAG-style relative-luminance approximation on gamma-encoded channels (0..1). Good enough for a "too dark / too light" band check. */
export function rgbLuminance(rgb: ThemeRgb): number {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/**
 * Mix `rgb` toward white (when darker than `min`) or black (when lighter
 * than `max`) by exactly the factor that lands its luminance on the nearest
 * band edge. Hue is preserved (linear mix per channel); input inside the
 * band returns unchanged.
 */
export function clampRgbLuminance(rgb: ThemeRgb, min: number, max: number): ThemeRgb {
  const luminance = rgbLuminance(rgb);
  if (luminance < min) {
    const t = (min - luminance) / (1 - luminance || 1);
    return {
      r: Math.round(rgb.r + (255 - rgb.r) * t),
      g: Math.round(rgb.g + (255 - rgb.g) * t),
      b: Math.round(rgb.b + (255 - rgb.b) * t),
    };
  }
  if (luminance > max) {
    const t = (luminance - max) / (luminance || 1);
    return {
      r: Math.round(rgb.r * (1 - t)),
      g: Math.round(rgb.g * (1 - t)),
      b: Math.round(rgb.b * (1 - t)),
    };
  }
  return rgb;
}

/**
 * Resolve one theme CSS variable (e.g. `--primary`) from `element`'s
 * computed styles to sRGB channels, luminance-clamped into `[min, max]`.
 * Null when the variable is unset/unparseable — callers fall back to the
 * consuming engine's own default rather than inventing a color here.
 */
export function resolveThemeColor(
  element: Element,
  variableName: string,
  options?: { minLuminance?: number; maxLuminance?: number },
): ThemeRgb | null {
  if (typeof window === 'undefined') return null;
  const raw = window.getComputedStyle(element).getPropertyValue(variableName);
  const rgb = cssColorToRgb(raw);
  if (!rgb) return null;
  return clampRgbLuminance(rgb, options?.minLuminance ?? 0, options?.maxLuminance ?? 1);
}

/**
 * Invoke `onChange` when theme state on `<html>` mutates (`class` for `.dark`
 * toggles, `data-theme` for named themes, `style` for inline variables) or the
 * OS colour scheme flips. Returns a cleanup.
 */
export function observeThemeChange(onChange: () => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  media?.addEventListener?.('change', onChange);
  let observer: MutationObserver | null = null;
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(onChange);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme', 'style'],
    });
  }
  return () => {
    observer?.disconnect();
    media?.removeEventListener?.('change', onChange);
  };
}
