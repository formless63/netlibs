import {
  assertHeaderSafe,
  createHttpClient,
  createRateBudget,
  kindFromStatus,
  ProviderError,
  safeProviderText,
  type FetchLike,
  type ProviderErrorKind,
  type ProviderErrorOptions,
  type RateBudget
} from '@formless63/provider-http';
import type { z } from 'zod';

import { domainSchema, routingRuleSchema, toDomain, type PurelymailDomain, type PurelymailRoutingRule } from './model.ts';
import { purelymailPath, type PurelymailOperation } from './operations.ts';

export * from './model.ts';
export * from './operations.ts';
export * from './records.ts';

export class PurelymailError extends ProviderError {
  constructor(options: Omit<ProviderErrorOptions, 'provider'>) {
    super({ ...options, provider: 'Purelymail' });
  }
}

export const PURELYMAIL_DEFAULT_BASE_URL = 'https://purelymail.com';
export const PURELYMAIL_TOKEN_HEADER = 'Purelymail-Api-Token';
/** `listUser` returns at most this many addresses and cannot page. */
export const PURELYMAIL_LIST_USER_LIMIT = 1000;

/**
 * Envelope codes this client classifies. Purelymail publishes no code table.
 * `invalidToken` has been observed (for a wrong and for a missing token, both
 * at HTTP 200); the absence codes are unconfirmed and only refine
 * `invalid_request` to `not_found`.
 */
export const PURELYMAIL_AUTH_ERROR_CODES: ReadonlySet<string> = new Set(['invalidToken']);
export const PURELYMAIL_NOT_FOUND_ERROR_CODES: ReadonlySet<string> = new Set(['noSuchUser', 'noSuchDomain']);

/**
 * The response envelope: `{type: "success", result}` or
 * `{type: "error", code, message}`, usually at HTTP 200. `type` is null for a
 * body that is not an envelope (an HTML page, an empty body). A body with
 * `result` and no `type`, the shape the OpenAPI document describes, is a
 * success.
 */
export interface PurelymailEnvelope {
  type: 'success' | 'error' | null;
  code: string | null;
  message: string | null;
  result: unknown;
}

export function readPurelymailEnvelope(body: unknown): PurelymailEnvelope {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { type: null, code: null, message: null, result: null };
  }
  const record = body as Record<string, unknown>;
  const hasResult = Object.hasOwn(record, 'result');
  const { type, code, message } = record;
  return {
    type: type === 'success' || type === 'error' ? type : type === undefined && hasResult ? 'success' : null,
    code: typeof code === 'string' ? code : null,
    message: typeof message === 'string' ? message : null,
    result: hasResult ? record['result'] : null
  };
}

/**
 * Classifies a failed answer: a known envelope code first, then a decisive
 * status (401, 403, 404, 429), then an envelope refusal (`invalid_request`,
 * never transient), then any other error status. A 2xx that is not an
 * envelope is `invalid_response`.
 */
export function purelymailErrorKind(httpStatus: number, envelope: PurelymailEnvelope): ProviderErrorKind {
  if (envelope.code !== null && PURELYMAIL_AUTH_ERROR_CODES.has(envelope.code)) return 'unauthorized';
  if (envelope.code !== null && PURELYMAIL_NOT_FOUND_ERROR_CODES.has(envelope.code)) return 'not_found';
  if ([401, 403, 404, 429].includes(httpStatus)) return kindFromStatus(httpStatus);
  if (envelope.type === 'error') return 'invalid_request';
  return httpStatus >= 400 ? kindFromStatus(httpStatus) : 'invalid_response';
}

export interface PurelymailOptions {
  apiToken: string;
  /** Default `https://purelymail.com`. Another origin (a proxy) may carry a path. */
  baseUrl?: string;
  fetch?: FetchLike;
  /** Default 20 000. */
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Default 6 burst, 1 per second; Purelymail publishes no limit. */
  rateBudget?: RateBudget;
  allowLoopbackHttp?: boolean;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface CreateUserInput {
  /** The local part only: `postmaster`, not `postmaster@example.com`. */
  userName: string;
  domainName: string;
  /** Write-only: sent in the body, removed from any error text, never returned. */
  password: string;
  /** Omitted unless given, so Purelymail's defaults apply. */
  enablePasswordReset?: boolean;
  enableSearchIndexing?: boolean;
  sendWelcomeEmail?: boolean;
}

export interface CreateRoutingRuleInput {
  domainName: string;
  /** Local part to match; empty with `catchall` for everything else. */
  matchUser: string;
  targetAddresses: readonly string[];
  /** Default false. */
  prefix?: boolean;
  /** Default false. */
  catchall?: boolean;
}

export interface PurelymailProbe {
  authenticated: boolean;
}

export interface PurelymailClient {
  /** Calls `checkAccountCredit`. Rejects unless the failure is a refused token. */
  probe(options?: RequestOptions): Promise<PurelymailProbe>;
  /** The account's ownership code, published as a TXT record on every domain. */
  getOwnershipCode(options?: RequestOptions): Promise<string>;
  /** Fails until the ownership TXT record resolves publicly. */
  addDomain(domainName: string, options?: RequestOptions): Promise<void>;
  listDomains(options?: RequestOptions & { includeShared?: boolean }): Promise<PurelymailDomain[]>;
  /** By name, ignoring case and a trailing dot; a subdomain does not match. */
  findDomain(name: string, options?: RequestOptions): Promise<PurelymailDomain | null>;
  /** Asks Purelymail to check the domain's DNS again. Changes no other setting. */
  recheckDomainDns(domainName: string, options?: RequestOptions): Promise<void>;
  /** Billable and not idempotent: read `listUsers` back before repeating a failed call. */
  createUser(input: CreateUserInput, options?: RequestOptions): Promise<void>;
  /** Takes the full address. Deletes the mailbox and its mail. */
  deleteUser(address: string, options?: RequestOptions): Promise<void>;
  /** Every address on the account. Rejects when the answer reaches the 1000-user ceiling. */
  listUsers(options?: RequestOptions): Promise<string[]>;
  listRoutingRules(options?: RequestOptions): Promise<PurelymailRoutingRule[]>;
  /** Not idempotent. */
  createRoutingRule(input: CreateRoutingRuleInput, options?: RequestOptions): Promise<void>;
  deleteRoutingRule(routingRuleId: number, options?: RequestOptions): Promise<void>;
  /** The provider's own decimal string, never a number. */
  checkAccountCredit(options?: RequestOptions): Promise<string>;
}

/** `local@domain`, the form every user operation except `createUser` takes. */
export function purelymailAddress(localPart: string, domainName: string): string {
  return `${localPart}@${domainName}`;
}

const sameDomain = (a: string, b: string): boolean =>
  a.trim().toLowerCase().replace(/\.$/, '') === b.trim().toLowerCase().replace(/\.$/, '');

export function createPurelymailClient(options: PurelymailOptions): PurelymailClient {
  let token: string;
  let http: ReturnType<typeof createHttpClient>;
  try {
    token = assertHeaderSafe('Purelymail', 'API token', options.apiToken);
    http = createHttpClient({
      provider: 'Purelymail',
      baseUrl: options.baseUrl ?? PURELYMAIL_DEFAULT_BASE_URL,
      allowLoopbackHttp: options.allowLoopbackHttp ?? false,
      headers: { accept: 'application/json', [PURELYMAIL_TOKEN_HEADER]: token },
      secrets: [token],
      rateBudget:
        options.rateBudget ?? createRateBudget({ provider: 'Purelymail', capacity: 6, refillPerSecond: 1 }),
      createError: (input) => new PurelymailError(input),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes })
    });
  } catch (error) {
    if (error instanceof ProviderError && !(error instanceof PurelymailError)) {
      throw new PurelymailError({ kind: error.kind, message: error.message });
    }
    throw error;
  }

  /** The one call every operation makes. Returns the envelope's `result`. */
  async function call(
    operation: PurelymailOperation,
    json: Record<string, unknown>,
    { signal }: RequestOptions = {},
    secrets: readonly string[] = []
  ): Promise<unknown> {
    const result = await http.request({
      operation,
      method: 'POST',
      path: purelymailPath(operation),
      // Argument-less operations take `{}`, not an empty body.
      json,
      ...(signal ? { signal } : {})
    });
    let body: unknown = null;
    try {
      body = JSON.parse(result.text);
    } catch {
      // Not JSON: reported below as not being an envelope.
    }
    const envelope = readPurelymailEnvelope(body);
    const ok = result.status >= 200 && result.status < 300;
    // HTTP 200 proves nothing here: a refused token arrives as a 200 error envelope.
    if (ok && envelope.type === 'success') return envelope.result;
    const text = envelope.message === null ? '' : safeProviderText(envelope.message, [token, ...secrets]);
    throw new PurelymailError({
      kind: purelymailErrorKind(result.status, envelope),
      message:
        envelope.type === null
          ? `Purelymail answered ${operation} (HTTP ${result.status}) with something that is not an API response`
          : `Purelymail refused ${operation} (HTTP ${result.status}${envelope.code ? `, ${envelope.code}` : ''})${text ? `: ${text}` : ''}`,
      status: result.status,
      operation,
      providerCode: envelope.code === null ? null : safeProviderText(envelope.code, [token, ...secrets], 64),
      retryAfterMs: result.retryAfterMs,
      detail: envelope.type === null ? { notEnvelope: true } : {}
    });
  }

  const unreadable = (operation: PurelymailOperation, field: string): PurelymailError =>
    new PurelymailError({
      kind: 'invalid_response',
      message: `Purelymail answered ${operation} without a usable "${field}"`,
      operation,
      detail: { field }
    });

  const field = (result: unknown, key: string): unknown =>
    typeof result === 'object' && result !== null && !Array.isArray(result)
      ? (result as Record<string, unknown>)[key]
      : undefined;

  function string(result: unknown, key: string, operation: PurelymailOperation): string {
    const value = field(result, key);
    if (typeof value !== 'string' || value === '') throw unreadable(operation, key);
    return value;
  }

  function rows<S extends z.ZodType>(result: unknown, key: string, schema: S, operation: PurelymailOperation): z.infer<S>[] {
    const list = field(result, key);
    if (!Array.isArray(list)) throw unreadable(operation, key);
    // One unreadable row fails the list: these are read-backs, and a gap would read as absence.
    return list.map((row) => {
      const parsed = schema.safeParse(row);
      if (!parsed.success) throw unreadable(operation, String(parsed.error.issues[0]?.path[0] ?? key));
      return parsed.data as z.infer<S>;
    });
  }

  const listDomains: PurelymailClient['listDomains'] = async ({ includeShared = false, ...request } = {}) =>
    rows(await call('domain.list', { includeShared }, request), 'domains', domainSchema, 'domain.list').map(toDomain);

  const checkAccountCredit: PurelymailClient['checkAccountCredit'] = async (request) =>
    string(await call('account.credit', {}, request), 'credit', 'account.credit');

  return {
    async probe(request) {
      try {
        await checkAccountCredit(request);
        return { authenticated: true };
      } catch (error) {
        if (error instanceof PurelymailError && (error.kind === 'unauthorized' || error.kind === 'forbidden')) {
          return { authenticated: false };
        }
        throw error;
      }
    },

    getOwnershipCode: async (request) =>
      string(await call('domain.ownershipCode', {}, request), 'code', 'domain.ownershipCode'),

    async addDomain(domainName, request) {
      await call('domain.add', { domainName }, request);
    },

    listDomains,

    // Purelymail has no single-domain read; absence is read from the list.
    findDomain: async (name, request) => (await listDomains(request)).find((domain) => sameDomain(domain.name, name)) ?? null,

    async recheckDomainDns(domainName, request) {
      // Only these two fields: the same call can change account-reset settings.
      await call('domain.updateSettings', { name: domainName, recheckDns: true }, request);
    },

    async createUser(input, request) {
      await call(
        'user.create',
        {
          userName: input.userName,
          domainName: input.domainName,
          password: input.password,
          ...(input.enablePasswordReset === undefined ? {} : { enablePasswordReset: input.enablePasswordReset }),
          ...(input.enableSearchIndexing === undefined ? {} : { enableSearchIndexing: input.enableSearchIndexing }),
          ...(input.sendWelcomeEmail === undefined ? {} : { sendWelcomeEmail: input.sendWelcomeEmail })
        },
        request,
        [input.password]
      );
    },

    async deleteUser(address, request) {
      await call('user.delete', { userName: address }, request);
    },

    async listUsers(request) {
      const list = field(await call('user.list', {}, request), 'users');
      if (!Array.isArray(list)) throw unreadable('user.list', 'users');
      if (list.length >= PURELYMAIL_LIST_USER_LIMIT) {
        throw new PurelymailError({
          kind: 'invalid_response',
          message: `Purelymail listed ${list.length} users, its ceiling, so the list may be incomplete`,
          operation: 'user.list',
          detail: { count: list.length }
        });
      }
      return list.filter((entry): entry is string => typeof entry === 'string');
    },

    listRoutingRules: async (request) =>
      rows(await call('routing.list', {}, request), 'rules', routingRuleSchema, 'routing.list'),

    async createRoutingRule(input, request) {
      await call(
        'routing.create',
        {
          domainName: input.domainName,
          // Required by the API even when false.
          prefix: input.prefix ?? false,
          matchUser: input.matchUser,
          targetAddresses: [...input.targetAddresses],
          catchall: input.catchall ?? false
        },
        request
      );
    },

    async deleteRoutingRule(routingRuleId, request) {
      if (!Number.isSafeInteger(routingRuleId)) {
        throw new PurelymailError({ kind: 'invalid_input', message: 'a routing rule id must be an integer' });
      }
      await call('routing.delete', { routingRuleId }, request);
    },

    checkAccountCredit
  };
}
