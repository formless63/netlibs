import { ViewerError, isAbortError } from './errors.ts';
import type { ViewerAdapter, ViewerFileInfo, ViewerInput } from './types.ts';

/**
 * One input plus its adapter, with uniform readers. Pure and React-free.
 * Every read performs its own request; viewers read each source once.
 */
export class ResolvedSource {
  readonly input: ViewerInput;
  readonly file: ViewerFileInfo;
  readonly #adapter: ViewerAdapter;

  constructor(input: ViewerInput, file: ViewerFileInfo, adapter: ViewerAdapter = {}) {
    this.input = input;
    this.#adapter = adapter;
    this.file = {
      name: file.name ?? inferName(input),
      contentType: file.contentType ?? (isBlob(input) && input.type ? input.type : undefined),
      sizeBytes: file.sizeBytes ?? inferSize(input),
    };
  }

  /** The URL string for URL inputs, else null. */
  get href(): string | null {
    if (typeof this.input === 'string') return this.input;
    if (this.input instanceof URL) return this.input.href;
    return null;
  }

  /** Whether an engine may be handed `href` directly instead of fetched bytes. */
  get canUseUrlDirectly(): boolean {
    return this.href !== null && !this.#adapter.fetch;
  }

  /** The final URL after `resolveUrl`. Only for URL inputs. */
  async resolvedUrl(): Promise<string> {
    const href = this.href;
    if (href === null) throw new ViewerError('fetch-failed', 'This input has no URL');
    return this.#adapter.resolveUrl ? await this.#adapter.resolveUrl(href) : href;
  }

  async blob(signal?: AbortSignal): Promise<Blob> {
    const { input } = this;
    const type = this.file.contentType ?? '';
    if (isBlob(input)) {
      this.#assertSize(input.size);
      return !input.type && type ? input.slice(0, input.size, type) : input;
    }
    return new Blob([await this.arrayBuffer(signal)], type ? { type } : {});
  }

  /**
   * A buffer the caller OWNS. In-memory inputs are copied, because engines such
   * as pdf.js transfer (detach) the buffer they are given.
   */
  async arrayBuffer(signal?: AbortSignal): Promise<ArrayBuffer> {
    const { input } = this;
    if (isBlob(input)) {
      this.#assertSize(input.size);
      return input.arrayBuffer();
    }
    if (ArrayBuffer.isView(input)) {
      this.#assertSize(input.byteLength);
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength).slice().buffer;
    }
    if (isArrayBuffer(input)) {
      this.#assertSize(input.byteLength);
      return input.slice(0);
    }
    return this.#download(signal);
  }

  async text(signal?: AbortSignal): Promise<string> {
    return new TextDecoder().decode(await this.arrayBuffer(signal));
  }

  /** First bytes of an in-memory input, for format sniffing. Null for URLs. */
  async head(length = 1024): Promise<Uint8Array | null> {
    const { input } = this;
    if (isBlob(input)) return new Uint8Array(await input.slice(0, length).arrayBuffer());
    if (ArrayBuffer.isView(input)) {
      return new Uint8Array(input.buffer, input.byteOffset, Math.min(length, input.byteLength));
    }
    if (isArrayBuffer(input)) return new Uint8Array(input, 0, Math.min(length, input.byteLength));
    return null;
  }

  #assertSize(bytes: number): void {
    const max = this.#adapter.maxBytes;
    if (max !== undefined && bytes > max) {
      throw new ViewerError('too-large', `File is ${bytes} bytes; the limit is ${max}`);
    }
  }

  async #download(signal?: AbortSignal): Promise<ArrayBuffer> {
    const doFetch = this.#adapter.fetch ?? ((url: string, init: RequestInit) => fetch(url, init));
    let response: Response;
    try {
      const url = await this.resolvedUrl();
      response = await doFetch(url, {
        credentials: 'same-origin',
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (isAbortError(error) || error instanceof ViewerError) throw error;
      throw new ViewerError('fetch-failed', 'The file could not be requested', { cause: error });
    }
    if (!response.ok) {
      throw new ViewerError('http-status', `The file request failed (${response.status})`, {
        status: response.status,
      });
    }
    const max = this.#adapter.maxBytes;
    if (max === undefined) return response.arrayBuffer();

    const declared = Number(response.headers.get('content-length') ?? Number.NaN);
    if (Number.isFinite(declared)) this.#assertSize(declared);
    return readCapped(response, max);
  }
}

/** Content-Length can be absent or wrong, so the ceiling is enforced on the stream. */
async function readCapped(response: Response, max: number): Promise<ArrayBuffer> {
  const reader = response.body?.getReader();
  if (!reader) {
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > max) {
      throw new ViewerError('too-large', `File exceeds the ${max} byte limit`);
    }
    return buffer;
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      void reader.cancel().catch(() => {});
      throw new ViewerError('too-large', `File exceeds the ${max} byte limit`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out.buffer;
}

/**
 * Href safe to put on an anchor, or null. Blocks `javascript:`, `data:` and
 * every other scheme that could run script or smuggle a document.
 */
export function safeHref(href: string | null | undefined): string | null {
  if (!href) return null;
  // Browsers strip control characters and whitespace before reading the scheme.
  // oxlint-disable-next-line no-control-regex
  const compact = href.replace(/[\u0000- \u007f]/g, '');
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(compact)?.[1]?.toLowerCase();
  if (scheme === undefined) return href;
  return scheme === 'http' || scheme === 'https' || scheme === 'blob' ? href : null;
}

// Duck-typed rather than `instanceof`: Blobs and buffers may come from another
// realm (iframes, jsdom), where `instanceof` is false for a genuine value.
export function isBlob(value: unknown): value is Blob {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Blob).arrayBuffer === 'function' &&
    typeof (value as Blob).slice === 'function' &&
    typeof (value as Blob).size === 'number'
  );
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  return Object.prototype.toString.call(value) === '[object ArrayBuffer]';
}

function inferName(input: ViewerInput): string | undefined {
  if (isBlob(input)) return 'name' in input ? String((input as File).name) : undefined;
  if (typeof input === 'string' || input instanceof URL) {
    const path = String(input).split(/[?#]/, 1)[0] ?? '';
    const last = path.slice(path.lastIndexOf('/') + 1);
    if (!last.includes('.') || /^(blob|data):/i.test(path)) return undefined;
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  }
  return undefined;
}

function inferSize(input: ViewerInput): number | null {
  if (isBlob(input)) return input.size;
  if (ArrayBuffer.isView(input) || isArrayBuffer(input)) return input.byteLength;
  return null;
}
