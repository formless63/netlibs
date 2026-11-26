import { kindFromStatus, ProviderError, type ProviderErrorKind, type ProviderErrorOptions } from '@formless63/provider-http';

export class CloudflareError extends ProviderError {
  /** Every code in the envelope, chained ones included. */
  readonly codes: readonly number[];

  constructor(options: Omit<ProviderErrorOptions, 'provider'> & { codes?: readonly number[] }) {
    super({ ...options, provider: 'Cloudflare' });
    this.codes = options.codes ?? [];
  }
}

export interface CloudflareEnvelopeError {
  code: number;
  message: string;
  chain: Array<{ code: number; message: string }>;
}

/** The v4 response envelope. `success` is null for a body that is not one. */
export interface CloudflareEnvelope {
  success: boolean | null;
  errors: CloudflareEnvelopeError[];
  result: unknown;
  totalPages: number | null;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readErrors(value: unknown): CloudflareEnvelopeError[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];
    return [
      {
        code: typeof record['code'] === 'number' ? record['code'] : 0,
        message: typeof record['message'] === 'string' ? record['message'] : '',
        chain: readErrors(record['error_chain']).map(({ code, message }) => ({ code, message }))
      }
    ];
  });
}

export function readEnvelope(body: unknown): CloudflareEnvelope {
  const record = asRecord(body);
  if (!record) return { success: null, errors: [], result: null, totalPages: null };
  const pages = asRecord(record['result_info'])?.['total_pages'];
  return {
    success: typeof record['success'] === 'boolean' ? record['success'] : null,
    errors: readErrors(record['errors']),
    result: record['result'] ?? null,
    totalPages: typeof pages === 'number' && Number.isFinite(pages) ? pages : null
  };
}

export function envelopeCodes(envelope: CloudflareEnvelope): number[] {
  return envelope.errors.flatMap((error) => [error.code, ...error.chain.map((chained) => chained.code)]);
}

/**
 * Codes that mean the credential is unusable whatever the status: a malformed
 * Authorization header answers 400 with 6003/6111, and a missing one 9106/9107.
 */
export const CLOUDFLARE_AUTH_CODES: ReadonlySet<number> = new Set([10_000, 10_001, 6003, 6111, 9106, 9107]);
/** "No route for the URI". */
export const CLOUDFLARE_NO_ROUTE_CODE = 7003;
/**
 * A create refused because something holds the name. Observed, not documented:
 * 81053 (an A, AAAA or CNAME exists there), 81054 (a CNAME exists there),
 * 81057 (the record exists), 81058 (an identical record exists). 81053 and
 * 81054 also cover a different record, so a code only prompts a read-back.
 */
export const CLOUDFLARE_RECORD_EXISTS_CODES: ReadonlySet<number> = new Set([81_053, 81_054, 81_057, 81_058]);

export function cloudflareErrorKind(status: number, codes: readonly number[]): ProviderErrorKind {
  if (status === 403) return 'forbidden';
  if (codes.some((code) => CLOUDFLARE_AUTH_CODES.has(code))) return 'unauthorized';
  if (status >= 200 && status < 300) return 'invalid_request';
  if (codes.includes(CLOUDFLARE_NO_ROUTE_CODE)) return 'not_found';
  return kindFromStatus(status);
}
