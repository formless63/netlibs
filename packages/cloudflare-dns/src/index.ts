import {
  DnsApplyError,
  normalizeContent,
  toFqdn,
  toRelativeName,
  type DnsCapabilities,
  type DnsOperation,
  type DnsOperationResult,
  type DnsProvider,
  type DnsRecord,
  type DnsZone,
  type ObservedRecord,
  type RequestOptions,
  type ZoneRef
} from '@formless63/dns-plan';
import {
  assertHeaderSafe,
  createHttpClient,
  createRateBudget,
  ProviderError,
  type FetchLike,
  type QueryValue,
  type RateBudget
} from '@formless63/provider-http';
import { z } from 'zod';

import {
  asRecord,
  CLOUDFLARE_RECORD_EXISTS_CODES,
  CloudflareError,
  cloudflareErrorKind,
  envelopeCodes,
  readEnvelope,
  type CloudflareEnvelope
} from './errors.ts';

export * from './errors.ts';

export const CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
export const CLOUDFLARE_MIN_TTL_SECONDS = 60;
export const CLOUDFLARE_MAX_TTL_SECONDS = 86_400;
export const CLOUDFLARE_PROXIABLE_TYPES = ['A', 'AAAA', 'CNAME'] as const;
/** 1200 requests per five minutes per user, shared with the dashboard. */
export const CLOUDFLARE_LIMIT_PER_SECOND = 4;

const AUTOMATIC_TTL = 1;
const ZONES_PER_PAGE = 50;
const RECORDS_PER_PAGE = 100;
const DEFAULT_MAX_PAGES = 200;
/** Pages read back for one refused create. One name needs one page. */
const READ_BACK_MAX_PAGES = 5;
/** Records named in a conflict error. */
const MAX_REPORTED_CONFLICTS = 5;
/** Types whose priority makes two values different records. */
const PRIORITY_TYPES = new Set(['MX', 'SRV']);

export interface CloudflareZone extends DnsZone {
  accountId: string | null;
  paused: boolean;
}

export interface CloudflareDnsOptions {
  /** An API token (never the global API key). Reads need Zone:Read and DNS:Read; writes need DNS:Edit. */
  apiToken: string;
  /** Limits zone listing to one account. */
  accountId?: string;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Share one budget across clients of the same Cloudflare user. Default 8 burst, 1 per second. */
  rateBudget?: RateBudget;
  /** Pages read before a listing fails as too long. Default 200. */
  maxPages?: number;
  allowLoopbackHttp?: boolean;
}

export interface CloudflareDns extends DnsProvider {
  /**
   * Every zone the token can see, or with `name` the one by that name.
   * `limit` asks for at most that many (a probe, say); without it a list that
   * does not end is an error.
   */
  listZones(options?: RequestOptions & { name?: string; limit?: number }): Promise<CloudflareZone[]>;
  findZone(name: string, options?: RequestOptions): Promise<CloudflareZone | null>;
  getZone(zoneId: string, options?: RequestOptions): Promise<CloudflareZone>;
  /** Every record in the zone, or an error. `limit` asks for at most that many (a preview, say). */
  listRecords(zone: ZoneRef, options?: RequestOptions & { limit?: number }): Promise<ObservedRecord[]>;
}

const zoneSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string().min(1),
  status: z.string().optional(),
  paused: z.boolean().optional(),
  name_servers: z.array(z.unknown()).nullish(),
  account: z.looseObject({ id: z.string().optional() }).nullish()
});

const recordSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  name: z.string().min(1),
  content: z.string().optional(),
  ttl: z.number().optional(),
  priority: z.number().nullish(),
  proxied: z.boolean().nullish(),
  proxiable: z.boolean().nullish()
});

/** Cloudflare's TTL for a neutral one. `null` becomes its "automatic" sentinel. */
export function toCloudflareTtl(ttlSeconds: number | null): number {
  if (ttlSeconds === null) return AUTOMATIC_TTL;
  if (
    !Number.isInteger(ttlSeconds) ||
    ttlSeconds < CLOUDFLARE_MIN_TTL_SECONDS ||
    ttlSeconds > CLOUDFLARE_MAX_TTL_SECONDS
  ) {
    throw new CloudflareError({
      kind: 'invalid_input',
      message: `a Cloudflare TTL must be null (automatic) or ${CLOUDFLARE_MIN_TTL_SECONDS} to ${CLOUDFLARE_MAX_TTL_SECONDS} seconds`
    });
  }
  return ttlSeconds;
}

export function fromCloudflareTtl(ttl: number | undefined): number | null {
  return ttl === undefined || ttl === AUTOMATIC_TTL ? null : ttl;
}

/** Cloudflare zones and DNS records over API v4. */
export function createCloudflareDns(options: CloudflareDnsOptions): CloudflareDns {
  const proxiable = new Set<string>(CLOUDFLARE_PROXIABLE_TYPES);
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  let http: ReturnType<typeof createHttpClient>;
  try {
    const apiToken = assertHeaderSafe('Cloudflare', 'API token', options.apiToken);
    http = createHttpClient({
      provider: 'Cloudflare',
      baseUrl: options.baseUrl ?? CLOUDFLARE_API_BASE_URL,
      allowLoopbackHttp: options.allowLoopbackHttp ?? false,
      headers: { accept: 'application/json', authorization: `Bearer ${apiToken}` },
      secrets: [apiToken],
      rateBudget:
        options.rateBudget ?? createRateBudget({ provider: 'Cloudflare', capacity: 8, refillPerSecond: 1 }),
      createError: (input) => new CloudflareError(input),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes })
    });
  } catch (error) {
    if (error instanceof ProviderError && !(error instanceof CloudflareError)) {
      throw new CloudflareError({ kind: error.kind, message: error.message });
    }
    throw error;
  }

  async function request(
    operation: string,
    path: string,
    input: RequestOptions & {
      method?: string;
      query?: Record<string, QueryValue>;
      json?: unknown;
      /** DELETE is documented to answer `{result: {id}}` without the envelope. */
      bareResult?: boolean;
    }
  ): Promise<CloudflareEnvelope> {
    const result = await http.request({
      operation,
      path,
      ...(input.method ? { method: input.method } : {}),
      ...(input.query ? { query: input.query } : {}),
      ...(input.json === undefined ? {} : { json: input.json }),
      ...(input.signal ? { signal: input.signal } : {})
    });
    let body: unknown = null;
    try {
      body = JSON.parse(result.text);
    } catch {
      // Not JSON: reported below as not being an envelope.
    }
    const envelope = readEnvelope(body);
    const { status } = result;
    const ok = status >= 200 && status < 300;
    // The envelope decides, not the status: a 2xx can still report failure.
    if (ok && envelope.success === true) return envelope;
    if (ok && envelope.success === null && input.bareResult && envelope.result !== null) return envelope;

    const codes = envelopeCodes(envelope);
    const shapeless = ok && envelope.success === null;
    const first = envelope.errors[0];
    throw new CloudflareError({
      kind: shapeless ? 'invalid_response' : cloudflareErrorKind(status, codes),
      message: shapeless
        ? 'Cloudflare answered with something that is not an API response'
        : `Cloudflare refused ${operation} (HTTP ${status})${first ? `: ${first.code} ${http.safeText(first.message)}` : ''}`,
      status,
      operation,
      codes,
      providerCode: first ? String(first.code) : null,
      retryAfterMs: result.retryAfterMs,
      detail: {
        errors: envelope.errors.map((error) => ({
          code: error.code,
          message: http.safeText(error.message),
          ...(error.chain.length > 0
            ? { chain: error.chain.map(({ code, message }) => ({ code, message: http.safeText(message) })) }
            : {})
        }))
      }
    });
  }

  async function list(
    operation: string,
    path: string,
    query: Record<string, QueryValue>,
    perPage: number,
    { signal }: RequestOptions,
    pageLimit: number = maxPages,
    /** The caller wants at most this many items, and knows it. */
    itemLimit?: number
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    for (let page = 1; page <= pageLimit; page += 1) {
      const { result, totalPages } = await request(operation, path, {
        query: { ...query, page, per_page: perPage },
        ...(signal ? { signal } : {})
      });
      if (!Array.isArray(result)) {
        throw new CloudflareError({
          kind: 'invalid_response',
          message: 'a Cloudflare list was not an array',
          operation
        });
      }
      items.push(...(result as unknown[]));
      if (itemLimit !== undefined && items.length >= itemLimit) return items.slice(0, itemLimit);
      if (totalPages === null ? result.length < perPage : page >= totalPages) return items;
      if (result.length === 0) {
        throw new CloudflareError({
          kind: 'invalid_response',
          message: 'Cloudflare returned an empty page before the last one',
          operation
        });
      }
    }
    // A partial list is worse than none: a reconciler would act on the gap.
    throw new CloudflareError({
      kind: 'invalid_response',
      message: `a Cloudflare list did not end within ${pageLimit} pages`,
      operation
    });
  }

  function parse<T>(schema: z.ZodType<T>, value: unknown, operation: string): T {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new CloudflareError({
      kind: 'invalid_response',
      message: 'Cloudflare returned an object in an unexpected shape',
      operation,
      detail: { fields: parsed.error.issues.map((issue) => issue.path.join('.')) }
    });
  }

  function toZone(value: unknown, operation: string): CloudflareZone {
    const zone = parse(zoneSchema, value, operation);
    return {
      zoneId: zone.id,
      name: zone.name,
      status: zone.status ?? 'unknown',
      nameservers: (zone.name_servers ?? []).filter((host): host is string => typeof host === 'string'),
      accountId: zone.account?.id ?? null,
      paused: zone.paused ?? false
    };
  }

  function recordBody(record: DnsRecord, zoneName: string): Record<string, unknown> {
    const canProxy = proxiable.has(record.type);
    if (record.proxied && !canProxy) {
      // Writing it unproxied would publish an origin the caller thinks is hidden.
      throw new CloudflareError({
        kind: 'invalid_input',
        message: `Cloudflare cannot proxy a ${record.type} record`
      });
    }
    return {
      type: record.type,
      name: toFqdn(record.name, zoneName),
      content: record.content,
      ttl: toCloudflareTtl(record.ttlSeconds),
      ...(record.priority === null ? {} : { priority: record.priority }),
      ...(canProxy ? { proxied: record.proxied } : {})
    };
  }

  function checkLimit(limit: number | undefined, what: string): void {
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new CloudflareError({ kind: 'invalid_input', message: `a ${what} list limit must be a positive integer` });
    }
  }

  const recordsPath = (zoneId: string): string => `/zones/${encodeURIComponent(zoneId)}/dns_records`;

  function toRecord(item: unknown, zoneName: string, operation: string): ObservedRecord {
    const record = parse(recordSchema, item, operation);
    return {
      recordId: record.id,
      type: record.type,
      name: toRelativeName(record.name, zoneName),
      content: record.content ?? '',
      ttlSeconds: fromCloudflareTtl(record.ttl),
      priority: record.priority ?? null,
      proxied: record.proxied ?? false,
      proxiable: record.proxiable ?? false
    };
  }

  async function readRecords(
    zone: { zoneId: string; zoneName: string },
    operation: string,
    query: Record<string, QueryValue>,
    request_: RequestOptions,
    pageLimit?: number,
    itemLimit?: number
  ): Promise<ObservedRecord[]> {
    const items = await list(operation, recordsPath(zone.zoneId), query, RECORDS_PER_PAGE, request_, pageLimit, itemLimit);
    return items.map((item) => toRecord(item, zone.zoneName, operation));
  }

  async function applyOne(
    zoneId: string,
    zoneName: string,
    operation: DnsOperation,
    request_: RequestOptions
  ): Promise<DnsOperationResult> {
    const base = recordsPath(zoneId);
    const outcome = (
      status: DnsOperationResult['status'],
      recordId: string | null
    ): DnsOperationResult => ({
      kind: operation.kind,
      type: operation.record.type,
      name: operation.record.name,
      status,
      recordId
    });
    const idOf = (envelope: CloudflareEnvelope): string | null => {
      const id = asRecord(envelope.result)?.['id'];
      return typeof id === 'string' ? id : null;
    };
    if (operation.kind === 'create') {
      const json = recordBody(operation.record, zoneName);
      try {
        return outcome('applied', idOf(await request('records.create', base, { method: 'POST', json, ...request_ })));
      } catch (error) {
        if (
          error instanceof CloudflareError &&
          error.codes.some((code) => CLOUDFLARE_RECORD_EXISTS_CODES.has(code))
        ) {
          return settleRefusedCreate({ zoneId, zoneName }, operation.record, error, request_);
        }
        throw error;
      }
    }
    const path = `${base}/${encodeURIComponent(operation.recordId)}`;
    if (operation.kind === 'update') {
      const json = recordBody(operation.record, zoneName);
      const envelope = await request('records.update', path, { method: 'PUT', json, ...request_ });
      return outcome('applied', idOf(envelope) ?? operation.recordId);
    }
    try {
      await request('records.delete', path, { method: 'DELETE', bareResult: true, ...request_ });
      return outcome('applied', operation.recordId);
    } catch (error) {
      if (error instanceof CloudflareError && error.kind === 'not_found') {
        return outcome('already_absent', operation.recordId);
      }
      throw error;
    }
  }

  /**
   * A create refused because the name is taken is `already_present` only when
   * that record is read back: type, name, content as DNS data, and priority for
   * MX and SRV. TTL and proxying are reported, not required. Anything else at
   * the name is an error that names it. The read is one name, a few pages; if
   * it fails, its own error is thrown, so a transient failure stays one.
   */
  async function settleRefusedCreate(
    zone: { zoneId: string; zoneName: string },
    record: DnsRecord,
    refusal: CloudflareError,
    request_: RequestOptions
  ): Promise<DnsOperationResult> {
    const fqdn = toFqdn(record.name, zone.zoneName);
    const found = await readRecords(zone, 'records.verify', { 'name.exact': fqdn }, request_, READ_BACK_MAX_PAGES);
    const name = toRelativeName(fqdn, zone.zoneName);
    const atName = found.filter((candidate) => candidate.name.toLowerCase() === name);
    const match = atName.find(
      (candidate) =>
        candidate.type.toUpperCase() === record.type.toUpperCase() &&
        normalizeContent(record.type, candidate.content) === normalizeContent(record.type, record.content) &&
        (!PRIORITY_TYPES.has(record.type.toUpperCase()) || candidate.priority === record.priority)
    );
    if (match === undefined) {
      const holders = atName.slice(0, MAX_REPORTED_CONFLICTS).map(({ type, recordId }) => ({ type, recordId }));
      throw new CloudflareError({
        kind: refusal.kind,
        message:
          `Cloudflare refused to create the ${record.type} record "${record.name}": ` +
          (holders.length === 0
            ? 'it reports a record in the way but lists none at that name'
            : `a different record holds that name (${holders.map(({ type }) => type).join(', ')})`),
        ...(refusal.status === null ? {} : { status: refusal.status }),
        operation: 'records.create',
        codes: refusal.codes,
        providerCode: refusal.providerCode,
        detail: { ...refusal.detail, conflictingRecords: holders }
      });
    }
    const differing: Array<'ttlSeconds' | 'proxied'> = [];
    if (match.ttlSeconds !== record.ttlSeconds) differing.push('ttlSeconds');
    if (match.proxied !== record.proxied) differing.push('proxied');
    return {
      kind: 'create',
      type: record.type,
      name: record.name,
      status: 'already_present',
      recordId: match.recordId,
      ...(differing.length === 0 ? {} : { differingAttributes: differing })
    };
  }

  type Swap = { deletes: Extract<DnsOperation, { kind: 'delete' }>[]; creates: Extract<DnsOperation, { kind: 'create' }>[] };

  /** The group at `index` when it is deletes then creates: one batch. Anything else goes one by one. */
  function swapAt(operations: readonly DnsOperation[], index: number): Swap | null {
    const group = operations[index]?.group;
    if (group === undefined) return null;
    let end = index;
    while (end < operations.length && operations[end]?.group === group) end += 1;
    const members = operations.slice(index, end);
    const firstCreate = members.findIndex((operation) => operation.kind === 'create');
    if (firstCreate <= 0) return null;
    const deletes = members.slice(0, firstCreate);
    const creates = members.slice(firstCreate);
    if (!deletes.every((operation) => operation.kind === 'delete')) return null;
    if (!creates.every((operation) => operation.kind === 'create')) return null;
    return { deletes, creates } as Swap;
  }

  /**
   * `POST /dns_records/batch`: Cloudflare runs the deletes, then the posts, in
   * one database transaction, so the name holds the old records or the new
   * ones. Propagation to the edge is still per record.
   */
  async function applySwap(
    zone: { zoneId: string; zoneName: string },
    { deletes, creates }: Swap,
    request_: RequestOptions
  ): Promise<DnsOperationResult[]> {
    const json = {
      deletes: deletes.map(({ recordId }) => ({ id: recordId })),
      posts: creates.map(({ record }) => recordBody(record, zone.zoneName))
    };
    const envelope = await request('records.batch', `${recordsPath(zone.zoneId)}/batch`, {
      method: 'POST',
      json,
      ...request_
    });
    const posted = asRecord(envelope.result)?.['posts'];
    // Read in request order; the schema does not promise it, and a missing id is null.
    const ids = Array.isArray(posted)
      ? posted.map((entry) => {
          const id = asRecord(entry)?.['id'];
          return typeof id === 'string' ? id : null;
        })
      : [];
    return [
      ...deletes.map(({ recordId, record }): DnsOperationResult => ({
        kind: 'delete',
        type: record.type,
        name: record.name,
        status: 'applied',
        recordId
      })),
      ...creates.map(({ record }, position): DnsOperationResult => ({
        kind: 'create',
        type: record.type,
        name: record.name,
        status: 'applied',
        recordId: ids[position] ?? null
      }))
    ];
  }

  const client: CloudflareDns = {
    id: 'cloudflare',
    label: 'Cloudflare',

    capabilities(): DnsCapabilities {
      return {
        proxying: true,
        proxiableTypes: [...CLOUDFLARE_PROXIABLE_TYPES],
        proxiedWildcards: true,
        wildcardRecords: true,
        automaticTtl: true,
        minTtlSeconds: CLOUDFLARE_MIN_TTL_SECONDS,
        maxTtlSeconds: CLOUDFLARE_MAX_TTL_SECONDS,
        atomicGroups: true
      };
    },

    async listZones({ name, limit, ...request_ } = {}) {
      checkLimit(limit, 'zone');
      const items = await list(
        'zones.list',
        '/zones',
        { name, 'account.id': options.accountId },
        // Cloudflare accepts 5 to 50 zones per page.
        Math.min(ZONES_PER_PAGE, Math.max(5, limit ?? ZONES_PER_PAGE)),
        request_,
        maxPages,
        limit
      );
      return items.map((item) => toZone(item, 'zones.list'));
    },

    async findZone(name, request_ = {}) {
      const zones = await client.listZones({ name, ...request_ });
      return zones.find((zone) => zone.name === name) ?? null;
    },

    async getZone(zoneId, request_ = {}) {
      const { result } = await request('zones.get', `/zones/${encodeURIComponent(zoneId)}`, request_);
      return toZone(result, 'zones.get');
    },

    async listRecords(zone, { limit, ...request_ } = {}) {
      checkLimit(limit, 'record');
      return readRecords(zone, 'records.list', {}, request_, maxPages, limit);
    },

    async apply({ zoneId, zoneName }, operations, request_ = {}) {
      const done: DnsOperationResult[] = [];
      for (let index = 0; index < operations.length; ) {
        const operation = operations[index]!;
        const swap = swapAt(operations, index);
        try {
          if (swap === null) {
            done.push(await applyOne(zoneId, zoneName, operation, request_));
            index += 1;
          } else {
            done.push(...(await applySwap({ zoneId, zoneName }, swap, request_)));
            index += swap.deletes.length + swap.creates.length;
          }
        } catch (error) {
          // A failed batch changed nothing, so only what came before it is done.
          throw new DnsApplyError([...done], operation, error);
        }
      }
      return done;
    }
  };
  return client;
}
