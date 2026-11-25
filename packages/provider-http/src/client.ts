import { parseRetryAfter, ProviderError, safeProviderText, type ProviderErrorOptions } from './errors.ts';
import type { RateBudget } from './rate-budget.ts';
import { normalizeBaseUrl, type BaseUrlOptions } from './url.ts';

/** The part of `fetch` this package uses. `globalThis.fetch` satisfies it. */
export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export interface FetchInit {
  method: string;
  headers: Record<string, string>;
  signal: AbortSignal;
  redirect: 'error' | 'manual';
  body?: string;
}

export interface FetchResponse {
  readonly status: number;
  readonly headers?: { get(name: string): string | null };
  readonly body?: ReadableStream<Uint8Array> | null;
  text(): Promise<string>;
}

export type QueryValue = string | number | boolean | null | undefined;

export interface HttpRequest {
  /** Label for errors, e.g. `zones.list`. */
  operation: string;
  method?: string;
  /** Appended to the base URL. Build segments with `encodeURIComponent`. */
  path?: string;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  /** Sent as JSON. */
  json?: unknown;
  signal?: AbortSignal;
}

export interface HttpResult {
  status: number;
  text: string;
  retryAfterMs: number | null;
  header(name: string): string | null;
  /** Parses the body, throwing `invalid_response` when it is not JSON. */
  json(): unknown;
}

export interface HttpClientOptions extends Omit<BaseUrlOptions, 'provider'> {
  provider: string;
  baseUrl: string;
  /** Sent on every request. Values are never placed in errors. */
  headers?: Record<string, string>;
  /** Credential values to strip from any provider text that reaches an error. */
  secrets?: readonly string[];
  fetch?: FetchLike;
  timeoutMs?: number;
  maxResponseBytes?: number;
  rateBudget?: RateBudget;
  /** Lets a package throw its own subclass. */
  createError?: (options: ProviderErrorOptions) => ProviderError;
}

export interface HttpClient {
  readonly provider: string;
  readonly baseUrl: string;
  /** Performs one request. Resolves for any HTTP status; throws only without a usable response. */
  request(request: HttpRequest): Promise<HttpResult>;
  /** Builds an error with provider text already made safe. */
  error(options: Omit<ProviderErrorOptions, 'provider'>): ProviderError;
  /** Strips credentials and control characters from provider text. */
  safeText(text: string, maxLength?: number): string;
}

export const DEFAULT_TIMEOUT_MS = 20_000;
export const DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;

/** Rejects values that would break out of a header. */
export function assertHeaderSafe(provider: string, label: string, value: unknown): string {
  // oxlint-disable-next-line no-control-regex
  if (typeof value !== 'string' || value.trim() === '' || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new ProviderError({
      provider,
      kind: 'invalid_input',
      message: `the ${provider} ${label} is missing or malformed`
    });
  }
  return value.trim();
}

class TooLarge extends Error {}

/** Reads at most `limit` bytes, so a hostile or broken server cannot exhaust memory. */
export async function readBounded(response: FetchResponse, limit: number): Promise<string> {
  const declared = Number(response.headers?.get('content-length') ?? Number.NaN);
  if (declared > limit) {
    await response.body?.cancel().catch(() => undefined);
    throw new TooLarge();
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > limit) throw new TooLarge();
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw new TooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
}

/** A network error code such as ECONNREFUSED. Anything else could echo a URL. */
function networkCode(error: unknown): string | null {
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const code = (candidate as { code?: unknown } | null)?.code;
    if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,40}$/.test(code)) return code;
  }
  return null;
}

function buildQuery(query: Record<string, QueryValue> | undefined): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * A small request function with the safety rules every provider client needs:
 * redirects are refused (so credentials cannot be replayed to another origin),
 * responses are size-bounded, requests time out, and nothing from the request
 * or the transport error can reach a thrown message.
 */
export function createHttpClient(options: HttpClientOptions): HttpClient {
  const { provider } = options;
  const baseUrl = normalizeBaseUrl(options.baseUrl, { ...options, provider });
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const limit = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const secrets = options.secrets ?? [];
  const makeError = options.createError ?? ((input: ProviderErrorOptions) => new ProviderError(input));
  const error: HttpClient['error'] = (input) => makeError({ ...input, provider });
  const safeText: HttpClient['safeText'] = (text, maxLength) =>
    safeProviderText(text, secrets, maxLength);

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw error({ kind: 'invalid_input', message: `the ${provider} timeout must be positive` });
  }

  return {
    provider,
    baseUrl,
    error,
    safeText,
    async request(input) {
      const { operation } = input;
      try {
        await options.rateBudget?.acquire(1, input.signal ? { signal: input.signal } : {});
      } catch (cause) {
        if (cause instanceof ProviderError) {
          throw error({
            kind: cause.kind,
            message: cause.message,
            operation,
            retryAfterMs: cause.retryAfterMs,
            detail: cause.detail
          });
        }
        throw cause;
      }
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = input.signal ? AbortSignal.any([timeout, input.signal]) : timeout;
      const failure = (cause: unknown): ProviderError => {
        if (cause instanceof TooLarge) {
          return error({
            kind: 'invalid_response',
            message: `the ${provider} answer is too large (over ${limit} bytes)`,
            operation
          });
        }
        if (input.signal?.aborted) {
          return error({ kind: 'aborted', message: `the ${provider} request was aborted`, operation });
        }
        if (timeout.aborted || (cause as Error | null)?.name === 'TimeoutError') {
          return error({
            kind: 'timeout',
            message: `${provider} did not answer within ${timeoutMs} ms`,
            operation
          });
        }
        const code = networkCode(cause);
        return error({
          kind: 'unavailable',
          message: `${provider} could not be reached${code ? ` (${code})` : ''}`,
          operation,
          detail: code ? { networkCode: code } : {}
        });
      };

      try {
        signal.throwIfAborted();
        const response = await doFetch(`${baseUrl}${input.path ?? ''}${buildQuery(input.query)}`, {
          method: input.method ?? 'GET',
          headers: {
            ...(input.json === undefined ? {} : { 'content-type': 'application/json' }),
            ...options.headers,
            ...input.headers
          },
          signal,
          redirect: 'error',
          ...(input.json === undefined ? {} : { body: JSON.stringify(input.json) })
        });
        const text = await readBounded(response, limit);
        const header = (name: string): string | null => response.headers?.get(name) ?? null;
        return {
          status: response.status,
          text,
          retryAfterMs: parseRetryAfter(header('retry-after')),
          header,
          json() {
            try {
              return JSON.parse(text) as unknown;
            } catch {
              throw error({
                kind: 'invalid_response',
                message: `the ${provider} answer is not JSON`,
                status: response.status,
                operation
              });
            }
          }
        };
      } catch (cause) {
        throw failure(cause);
      }
    }
  };
}
