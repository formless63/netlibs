import { describe, expect, it } from 'vitest';

import { fileDelivery, INLINE_POLICY as POLICY } from '../src/index.ts';

const deliver = (input: {
  contentType: string | null | undefined;
  filename: string;
  forceDownload?: boolean;
}) =>
  fileDelivery({
    contentType: input.contentType,
    filename: input.filename,
    download: input.forceDownload,
  });
const isInlineSafeContentType = (type: string) =>
  fileDelivery({ contentType: type, filename: 'x' }).disposition === 'inline';

const decide = (contentType: string | null | undefined, forceDownload = false) =>
  deliver({ contentType, filename: 'file.bin', forceDownload });

describe('deliver', () => {
  it.each([
    'text/html',
    'text/html; charset=utf-8',
    'application/xhtml+xml',
    'application/xml',
    'text/xml',
    'application/javascript',
    'text/javascript',
    'application/x-shockwave-flash',
    'multipart/x-mixed-replace',
    ''
  ])('never serves active/unknown type %j inline', (type) => {
    const d = decide(type);
    expect(d.contentType).toBe('application/octet-stream');
    expect(d.disposition).toBe('attachment');
    expect(d.headers['Content-Disposition']).toMatch(/^attachment;/);
    expect(d.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(d.headers['Content-Security-Policy']).toBeUndefined();
  });

  it('treats a missing type as an octet-stream attachment', () => {
    expect(decide(null).disposition).toBe('attachment');
    expect(decide(undefined).contentType).toBe('application/octet-stream');
  });

  it('does not let case or parameters smuggle an active type', () => {
    expect(decide('TEXT/HTML ;charset=utf-8').contentType).toBe('application/octet-stream');
  });

  it('serves passive images inline with nosniff and the sandbox CSP', () => {
    const d = decide('image/png');
    expect(d.contentType).toBe('image/png');
    expect(d.disposition).toBe('inline');
    expect(d.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(d.headers['Content-Security-Policy']).toBe(POLICY);
  });

  it('keeps SVG inline only behind a no-script sandbox CSP', () => {
    const d = decide('image/svg+xml');
    expect(d.disposition).toBe('inline');
    const csp = d.headers['Content-Security-Policy']!;
    expect(csp.split('; ')).toEqual(
      expect.arrayContaining(['sandbox', "script-src 'none'", "default-src 'none'"])
    );
  });

  it('serves PDF inline without the sandbox CSP (Chromium PDF viewer refuses sandboxed docs)', () => {
    const d = decide('application/pdf');
    expect(d.disposition).toBe('inline');
    expect(d.headers['Content-Security-Policy']).toBeUndefined();
    expect(d.headers['X-Content-Type-Options']).toBe('nosniff');
  });

  it('keeps charset parameters on an allowlisted text type', () => {
    expect(decide('text/plain; charset=utf-8').contentType).toBe('text/plain; charset=utf-8');
  });

  it('forced download flips an inline-safe type to attachment but keeps its type', () => {
    const d = decide('image/jpeg', true);
    expect(d.contentType).toBe('image/jpeg');
    expect(d.disposition).toBe('attachment');
    expect(d.headers['Content-Security-Policy']).toBeUndefined();
  });

  it('serves non-renderable binary (models, office, zip) as an octet-stream attachment', () => {
    for (const type of ['model/gltf-binary', 'application/zip', 'application/msword']) {
      expect(decide(type)).toMatchObject({
        contentType: 'application/octet-stream',
        disposition: 'attachment'
      });
    }
  });

  it('produces header values the Headers API accepts for hostile filenames', () => {
    const d = deliver({
      contentType: 'image/png',
      filename: 'a\r\nSet-Cookie: x=1"\\.png'
    });
    const headers = new Headers(d.headers);
    const value = headers.get('content-disposition')!;
    expect(value).not.toMatch(/[\r\n]/);
    expect(value.startsWith('inline; filename="')).toBe(true);
    expect(headers.has('set-cookie')).toBe(false);
  });

  it('strips control characters from an allowlisted stored type', () => {
    expect(() => new Headers(decide('text/plain\r\nX-Evil: 1').headers)).not.toThrow();
  });
});

describe('isInlineSafeContentType', () => {
  it('matches the allowlist case-insensitively', () => {
    expect(isInlineSafeContentType('IMAGE/WEBP')).toBe(true);
    expect(isInlineSafeContentType('text/html')).toBe(false);
  });
});
