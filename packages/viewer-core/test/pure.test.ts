import { describe, expect, it } from 'vitest';

import {
  clampAspectRatio,
  clampPan,
  clampRgbLuminance,
  formatBytes,
  rgbLuminance,
  zoomAbout,
} from '../src/index.ts';

describe('zoomAbout / clampPan', () => {
  it('keeps the point under the cursor fixed', () => {
    const view = zoomAbout({ scale: 1, x: 0, y: 0 }, 2, 100, 50, 40);
    expect(view).toEqual({ scale: 2, x: -100, y: -50 });
  });
  it('recentres at fit and respects the ceiling', () => {
    expect(zoomAbout({ scale: 2, x: -90, y: 12 }, 0.1, 5, 5, 40)).toEqual({ scale: 1, x: 0, y: 0 });
    expect(zoomAbout({ scale: 39, x: 0, y: 0 }, 10, 0, 0, 40).scale).toBe(40);
  });
  it('never lets the artwork leave the viewport', () => {
    expect(clampPan({ scale: 2, x: 9999, y: -9999 }, 100, 100)).toEqual({
      scale: 2,
      x: 50,
      y: -150,
    });
  });
});

describe('clampAspectRatio', () => {
  it('clamps degenerate reports and rejects nonsense', () => {
    expect(clampAspectRatio(2.5)).toBe(2.5);
    expect(clampAspectRatio(1000)).toBe(20);
    expect(clampAspectRatio(0.0001)).toBe(0.2);
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, null])
      expect(clampAspectRatio(bad)).toBeNull();
  });
});

describe('clampRgbLuminance', () => {
  it('lands exactly on the band edge and leaves in-band colours alone', () => {
    const dark = clampRgbLuminance({ r: 0, g: 0, b: 0 }, 0.25, 0.78);
    expect(rgbLuminance(dark)).toBeCloseTo(0.25, 2);
    const light = clampRgbLuminance({ r: 255, g: 255, b: 255 }, 0.25, 0.78);
    expect(rgbLuminance(light)).toBeCloseTo(0.78, 2);
    const mid = { r: 120, g: 120, b: 120 };
    expect(clampRgbLuminance(mid, 0.25, 0.78)).toBe(mid);
  });
});

describe('formatBytes', () => {
  it('formats readable sizes', () => {
    expect(
      [0, 1023, 1024, 1536, 60 * 1024 * 1024, 150 * 1024 * 1024, 2 ** 31].map(formatBytes),
    ).toEqual(['0 B', '1023 B', '1 KB', '1.5 KB', '60 MB', '150 MB', '2 GB']);
  });
});
