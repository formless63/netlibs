/**
 * One error vocabulary for every provider client, so callers can branch on
 * `kind` without knowing the provider.
 */
export const PROVIDER_ERROR_KINDS = [
  /** The caller passed something unusable; no request was made. */
  'invalid_input',
  /** The provider understood the request and refused it. */
  'invalid_request',
  /** The credential is missing, wrong or expired. */
  'unauthorized',
  /** The credential is valid but not allowed to do this. */
  'forbidden',
  'not_found',
  /** The provider, or the local rate budget, is limiting requests. */
  'rate_limited',
  'timeout',
  /** The caller's AbortSignal fired. */
  'aborted',
  /** Network failure or a provider 5xx. */
  'unavailable',
  /** The provider answered with something that could not be understood. */
  'invalid_response'
] as const;

export type ProviderErrorKind = (typeof PROVIDER_ERROR_KINDS)[number];

export interface ProviderErrorOptions {
  provider: string;
  kind: ProviderErrorKind;
  message: string;
  /** HTTP status, when a response was received. */
  status?: number | null;
  /** Client operation label such as `zones.list`. Never a URL. */
  operation?: string | null;
  /** The provider's own error code, verbatim. */
  providerCode?: string | null;
  retryAfterMs?: number | null;
  /** Extra sanitized evidence. Must not contain credentials, headers, URLs or bodies. */
  detail?: Readonly<Record<string, unknown>>;
}

/**
 * Thrown by every client. Everything on it is safe to log: no headers, URLs,
 * query strings, bodies, credentials, or underlying `cause`.
 */
export class ProviderError extends Error {
  readonly provider: string;
  readonly kind: ProviderErrorKind;
  readonly status: number | null;
  readonly operation: string | null;
  readonly providerCode: string | null;
  readonly retryAfterMs: number | null;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(options: ProviderErrorOptions) {
    super(options.message);
    this.name = new.target.name;
    this.provider = options.provider;
    this.kind = options.kind;
    this.status = options.status ?? null;
    this.operation = options.operation ?? null;
    this.providerCode = options.providerCode ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.detail = options.detail ?? {};
  }

  /**
   * Whether the same request might succeed later. This says nothing about
   * whether repeating it is safe: a timed-out create may have happened.
   */
  get retryable(): boolean {
    return this.kind === 'rate_limited' || this.kind === 'timeout' || this.kind === 'unavailable';
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      message: this.message,
      provider: this.provider,
      kind: this.kind,
      status: this.status,
      operation: this.operation,
      providerCode: this.providerCode,
      retryAfterMs: this.retryAfterMs,
      detail: this.detail
    };
  }
}

export function kindFromStatus(status: number): ProviderErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid_request';
  if (status >= 500) return 'unavailable';
  return 'invalid_response';
}

/** Parses `Retry-After` (delta seconds or HTTP date) to milliseconds, or null. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (value === null) return null;
  const text = value.trim();
  if (/^\d{1,9}$/.test(text)) return Number(text) * 1000;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : Math.max(0, at - now);
}

/**
 * Makes provider-supplied text safe to put in an error: secrets (and their
 * URL-encoded forms) are replaced, control characters removed, length bounded.
 */
export function safeProviderText(
  text: string,
  secrets: readonly string[] = [],
  maxLength = 200
): string {
  let clean = text;
  for (const secret of secrets) {
    if (secret === '') continue;
    for (const form of new Set([
      secret,
      encodeURIComponent(secret),
      new URLSearchParams([['', secret]]).toString().slice(1)
    ])) {
      clean = clean.split(form).join('[redacted]');
    }
  }
  // oxlint-disable-next-line no-control-regex
  clean = clean.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return clean.length > maxLength ? `${clean.slice(0, maxLength)}…` : clean;
}
