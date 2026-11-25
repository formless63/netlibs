import { describe, expect, it } from 'bun:test';

import {
  richViewerKindForContentType,
  richViewerKindForFilename,
  isSafeMediaUrl
} from '../src/viewer-kind.ts';

describe('media viewer boundary', () => {
  it('accepts root-relative, http(s) and blob URLs only', () => {
    expect(isSafeMediaUrl('/media/abc?asset=page')).toBe(true);
    expect(isSafeMediaUrl('https://cdn.example.com/a.png')).toBe(true);
    expect(isSafeMediaUrl('blob:https://example.com/1')).toBe(true);
    expect(isSafeMediaUrl('//example.com/file')).toBe(false);
    expect(isSafeMediaUrl('/\\example.com')).toBe(false);
    expect(isSafeMediaUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeMediaUrl('data:text/html,hi')).toBe(false);
    expect(isSafeMediaUrl('')).toBe(false);
  });

  it('maps only backend-inline-safe image formats', () => {
    expect(richViewerKindForContentType('image/png')).toBe('image');
    expect(richViewerKindForContentType('image/svg+xml')).toBeNull();
    expect(richViewerKindForFilename('diagram.svg')).toBeNull();
    expect(richViewerKindForFilename('manual.pdf')).toBe('pdf');
    expect(richViewerKindForFilename('enclosure.STL')).toBe('stl');
    expect(richViewerKindForContentType('model/stl; charset=binary')).toBe('stl');
    expect(richViewerKindForContentType('application/sla')).toBe('stl');
    expect(richViewerKindForContentType('application/vnd.ms-pki.stl')).toBeNull();
  });
});
