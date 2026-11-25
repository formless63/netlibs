/**
 * Response headers for serving stored uploads from an application's own origin.
 *
 * The stored content type is untrusted: it is often whatever the uploader
 * claimed, and formats without a signature cannot be checked. Served inline, a
 * file claiming `text/html` runs script with the viewer's session. So:
 *
 *  - Only allowlisted passive types are inline, with their own type.
 *  - Inline responses carry an opaque-origin, no-script `sandbox` policy. PDF is
 *    the exception: Chromium will not open its viewer in a sandboxed document.
 *  - Everything else is an `application/octet-stream` attachment.
 *  - `nosniff` always.
 *
 * Pure: no framework, no I/O.
 */

/**
 * Types safe to render. SVG can carry script but is here because pages embed it
 * with `<img>`, where script never runs; the sandbox policy covers opening it
 * directly.
 */
export const INLINE_CONTENT_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/x-icon',
  'image/vnd.microsoft.icon',
  'image/apng',
  'image/svg+xml',
  'application/pdf',
  'text/plain',
  'text/csv',
  'text/markdown',
  'text/x-markdown',
  'application/json',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
];

/** Opaque origin, no script, nothing loaded except same-origin media. */
export const INLINE_POLICY: string = policy("img-src 'self' data:", "media-src 'self'");

/** For untrusted HTML documents, such as captured pages: nothing loaded at all. */
export const DOCUMENT_POLICY: string = policy(
  'img-src data:',
  'font-src data:',
  'media-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
);

function policy(...sources: string[]): string {
  return [
    'sandbox',
    "default-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
    ...sources,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'self'",
  ].join('; ');
}

// RFC 9110 token. A value that is not exactly token/token is not a type.
const TOKEN = "[!#$%&'*+.^_`|~0-9a-z-]+";
const TYPE = new RegExp(`^${TOKEN}/${TOKEN}$`);
const CHARSET = new RegExp(`^charset="?(${TOKEN})"?$`);

/**
 * The bare lower-case type, or null when it is missing or malformed.
 *
 * Commas matter. Browsers take the LAST valid type in a comma-joined value, so
 * `application/pdf;x=1, text/html` is HTML to Chromium, `nosniff` or not, while
 * code that splits on `;` sees a PDF. Any comma makes the value invalid here.
 */
export function bareContentType(contentType: string | null | undefined): string | null {
  if (typeof contentType !== 'string' || contentType.includes(',')) return null;
  const bare = contentType.split(';', 1)[0]!.trim().toLowerCase();
  return TYPE.test(bare) ? bare : null;
}

export interface FileDeliveryInput {
  /** What the store recorded. Untrusted. */
  contentType: string | null | undefined;
  filename: string;
  /** Force a download. Can only make the response safer. */
  download?: boolean | undefined;
  /** Replace the allowlist. Never add a type that can run script. */
  inlineTypes?: readonly string[] | undefined;
}

export interface FileDelivery {
  contentType: string;
  disposition: 'inline' | 'attachment';
  /** Every security-relevant header. Add caching, length and range headers. */
  headers: Record<string, string>;
}

export function fileDelivery(input: FileDeliveryInput): FileDelivery {
  const bare = bareContentType(input.contentType);
  const safe = bare !== null && (input.inlineTypes ?? INLINE_CONTENT_TYPES).includes(bare);
  const contentType = safe ? withCharset(bare, input.contentType!) : 'application/octet-stream';
  const disposition = safe && input.download !== true ? 'inline' : 'attachment';
  const headers: Record<string, string> = {
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(disposition, input.filename),
    'X-Content-Type-Options': 'nosniff',
  };
  if (disposition === 'inline' && bare !== 'application/pdf') {
    headers['Content-Security-Policy'] = INLINE_POLICY;
  }
  return { contentType, disposition, headers };
}

/**
 * Headers for an untrusted HTML document the reader should see rendered. The
 * policy is on the response, not only on an iframe, because the URL can be
 * opened on its own. Isolation, not sanitising. Do not add `'self'` sources:
 * they would let the document make the reader's authenticated requests.
 */
export function untrustedDocumentHeaders(
  contentType = 'text/html; charset=utf-8',
): Record<string, string> {
  const bare = bareContentType(contentType);
  return {
    'Content-Type': bare === null ? 'application/octet-stream' : withCharset(bare, contentType),
    'Content-Security-Policy': DOCUMENT_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  };
}

/** The type rebuilt from validated parts; only a plain charset survives. */
function withCharset(bare: string, original: string): string {
  for (const part of original.split(';').slice(1)) {
    const charset = CHARSET.exec(part.trim().toLowerCase())?.[1];
    if (charset) return `${bare}; charset=${charset}`;
  }
  return bare;
}

/**
 * A `Content-Disposition` that is always a legal header, whatever the filename:
 * an ASCII `filename` plus an RFC 8187 `filename*`.
 */
export function contentDisposition(disposition: 'inline' | 'attachment', filename: string): string {
  const cleaned =
    filename
      // Controls, and bidi overrides that disguise an extension ("exe.gpj").
      // oxlint-disable-next-line no-control-regex
      .replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
      .trim()
      .toWellFormed() || 'download';
  const ascii = cleaned.replace(/[^\x20-\x7e]|["\\%]/g, '_');
  const encoded = encodeURIComponent(cleaned).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
