import { describe, expect, it } from 'vitest';

import {
  bareContentType,
  contentDisposition,
  fileDelivery,
  INLINE_CONTENT_TYPES,
  uploadType,
  untrustedDocumentHeaders,
} from '../src/index.ts';

const deliver = (contentType: string | null, filename = 'f') =>
  fileDelivery({ contentType, filename });

describe('type smuggling', () => {
  // Chromium renders each of these as HTML. See browser/delivery.spec.ts.
  it.each([
    'application/pdf;x=1, text/html',
    'application/pdf, text/html',
    'text/plain;x=1,text/html;charset=utf-8',
    'image/png;x="1", text/html',
  ])('refuses a comma-joined %j', (type) => {
    expect(deliver(type)).toMatchObject({
      contentType: 'application/octet-stream',
      disposition: 'attachment',
    });
    expect(bareContentType(type)).toBeNull();
    expect(uploadType({ detected: null, declared: type, filename: 'x' })).toEqual({
      ok: true,
      contentType: 'application/octet-stream',
    });
    expect(untrustedDocumentHeaders(type)['Content-Type']).toBe('application/octet-stream');
  });

  it.each(['text', 'text/', '/plain', 'text /plain', 'text/plain/x', 'text/pl\u0000ain', '*/*\n'])(
    'refuses malformed %j',
    (type) => {
      expect(deliver(type).disposition).toBe('attachment');
    },
  );

  it('keeps only a plain charset parameter', () => {
    expect(deliver('text/plain; boundary=x; Charset="UTF-8"; y=z').contentType).toBe(
      'text/plain; charset=utf-8',
    );
    expect(deliver('text/plain; charset=utf-8"><x').contentType).toBe('text/plain');
  });
});

describe('policy', () => {
  it('sandboxes every inline type except PDF, and always sends nosniff', () => {
    for (const type of INLINE_CONTENT_TYPES) {
      const { headers, disposition } = deliver(type);
      expect(disposition).toBe('inline');
      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['Content-Security-Policy']?.startsWith('sandbox;') ?? false, type).toBe(
        type !== 'application/pdf',
      );
    }
  });

  it('can narrow the allowlist', () => {
    expect(
      fileDelivery({ contentType: 'image/svg+xml', filename: 'x', inlineTypes: ['image/png'] })
        .disposition,
    ).toBe('attachment');
  });

  it('gives untrusted documents no network and no origin', () => {
    const headers = untrustedDocumentHeaders();
    const directives = headers['Content-Security-Policy']!.split('; ');
    expect(directives).toEqual(
      expect.arrayContaining([
        'sandbox',
        "default-src 'none'",
        "script-src 'none'",
        "connect-src 'none'",
      ]),
    );
    expect(directives.filter((d) => d.includes("'self'"))).toEqual(["frame-ancestors 'self'"]);
  });
});

describe('contentDisposition', () => {
  it.each([
    'naïve résumé.pdf',
    '日本語.png',
    "it's (1)*.txt",
    '100%.txt',
    '"q"\\.txt',
    '\ud800bad.txt',
    '',
    '\r\n\u0000',
  ])('is a legal header for %j', (name) => {
    const value = contentDisposition('attachment', name);
    expect(() => new Headers({ 'content-disposition': value })).not.toThrow();
    expect(value).toMatch(/^attachment; filename="[\x20-\x7e]+"; filename\*=UTF-8''[\w.%~!-]+$/);
  });

  it('strips bidi overrides that disguise an extension', () => {
    expect(decodeURIComponent(contentDisposition('inline', 'photo‮gpj.exe').split("''")[1]!)).toBe(
      'photogpj.exe',
    );
  });
});
