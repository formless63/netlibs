import {
  assertHeaderSafe,
  createHttpClient,
  createRateBudget,
  kindFromStatus,
  ProviderError,
  type FetchLike,
  type ProviderErrorKind,
  type ProviderErrorOptions,
  type QueryValue,
  type RateBudget
} from '@formless63/provider-http';

import {
  parseDnsRecord,
  parseDomain,
  parseOrg,
  parseResource,
  parseRule,
  parseSite,
  parseTarget,
  type PangolinDnsRecord,
  type PangolinDomain,
  type PangolinOrg,
  type PangolinResource,
  type PangolinRule,
  type PangolinSite,
  type PangolinTarget
} from './model.ts';

export * from './model.ts';

export class PangolinError extends ProviderError {
  constructor(options: Omit<ProviderErrorOptions, 'provider'>) {
    super({ ...options, provider: 'Pangolin' });
  }
}

/** The `{data, success, error, message, status}` envelope. Fields are null when absent. */
export interface PangolinEnvelope {
  success: boolean | null;
  error: boolean | null;
  message: string | null;
  status: number | null;
  data: unknown;
}

export function readPangolinEnvelope(body: unknown): PangolinEnvelope {
  const record =
    typeof body === 'object' && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const { success, error, message, status, data } = record;
  return {
    success: typeof success === 'boolean' ? success : null,
    error: typeof error === 'boolean' ? error : null,
    message: typeof message === 'string' ? message : null,
    status: typeof status === 'number' ? status : null,
    data: data ?? null
  };
}

/** Classifies a failed answer. The envelope's own status outranks the transport's. */
export function pangolinErrorKind(httpStatus: number, envelope: PangolinEnvelope): ProviderErrorKind {
  const status = envelope.status ?? httpStatus;
  if (status >= 400) return kindFromStatus(status);
  if (envelope.success === false || envelope.error === true) return 'invalid_request';
  return httpStatus >= 400 ? kindFromStatus(httpStatus) : 'invalid_response';
}

/** Tailscale MagicDNS names, whose traffic is already WireGuard-encrypted. */
export function isTailnetHostname(hostname: string): boolean {
  return /[^.]\.ts\.net$/i.test(hostname);
}

export interface PangolinOptions {
  /**
   * The Integration API's own origin. It is a separate server (usually port
   * 3003), not the dashboard, and must be exposed explicitly.
   */
  baseUrl: string;
  apiKeyId: string;
  apiKeySecret: string;
  /** Default organization for calls that accept one. */
  orgId?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** Default 6 burst, 1 per second; Pangolin publishes no limit. */
  rateBudget?: RateBudget;
  /** Permit `http:` to a `*.ts.net` host. Default false. */
  allowTailnetHttp?: boolean;
  allowLoopbackHttp?: boolean;
  /** Told about list rows that could not be read and were left out. */
  onSkipped?: (info: { operation: string; index: number }) => void;
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface CreateResourceInput {
  name: string;
  domainId: string;
  /** `null` for the domain's apex. */
  subdomain: string | null;
  /** e.g. `http`. Replaces the deprecated `http`/`protocol` pair. */
  mode: string;
  proxyPort?: number | null;
  ssl?: boolean;
  enabled?: boolean;
}

export interface CreateTargetInput {
  siteId: string | number;
  ip: string;
  port: number;
  method?: string | null;
  enabled?: boolean;
  path?: string | null;
  pathMatchType?: string | null;
  priority?: number;
}

/** Always sent whole: an update that omits `priority` silently reorders rules. */
export interface RuleInput {
  action: string;
  match: string;
  value: string;
  priority: number;
  enabled: boolean;
}

export interface PangolinProbe {
  authenticated: boolean;
  /** Sites in the configured org, or visible orgs when none is configured. */
  count: number | null;
}

export interface PangolinClient {
  /** The cheapest authenticated read. Rejects unless the failure is a refused credential. */
  probe(options?: RequestOptions): Promise<PangolinProbe>;
  /** Needs a root API key. */
  listOrgs(options?: RequestOptions): Promise<PangolinOrg[]>;
  listSites(orgId?: string, options?: RequestOptions): Promise<PangolinSite[]>;
  /** By numeric id, or by `niceId` within an org. */
  getSite(siteIdOrNiceId: string, orgId?: string, options?: RequestOptions): Promise<PangolinSite | null>;
  listResources(orgId?: string, options?: RequestOptions): Promise<PangolinResource[]>;
  getResource(resourceId: string, options?: RequestOptions): Promise<PangolinResource | null>;
  listTargets(resourceId: string, options?: RequestOptions): Promise<PangolinTarget[]>;
  listRules(resourceId: string, options?: RequestOptions): Promise<PangolinRule[]>;
  listDomains(orgId?: string, options?: RequestOptions): Promise<PangolinDomain[]>;
  listDomainDnsRecords(domainId: string, orgId?: string, options?: RequestOptions): Promise<PangolinDnsRecord[]>;

  /** Not idempotent: Pangolin has no upsert. Read back before repeating a failed call. */
  createResource(input: CreateResourceInput, orgId?: string, options?: RequestOptions): Promise<PangolinResource>;
  /** Not idempotent. */
  createTarget(resourceId: string, input: CreateTargetInput, options?: RequestOptions): Promise<PangolinTarget>;
  /** Not idempotent. */
  createRule(resourceId: string, input: RuleInput, options?: RequestOptions): Promise<PangolinRule>;
  updateRule(resourceId: string, ruleId: string, input: RuleInput, options?: RequestOptions): Promise<PangolinRule>;
}

type Paging = 'page' | 'offset';

const PAGE_SIZE = 500;
const MAX_PAGES = 50;
const segment = encodeURIComponent;

/**
 * A client for the Pangolin Integration API. Note the API's inverted verbs:
 * PUT creates and POST updates. This client never deletes.
 */
export function createPangolinClient(options: PangolinOptions): PangolinClient {
  let http: ReturnType<typeof createHttpClient>;
  try {
    const id = assertHeaderSafe('Pangolin', 'API key id', options.apiKeyId);
    const secret = assertHeaderSafe('Pangolin', 'API key secret', options.apiKeySecret);
    http = createHttpClient({
      provider: 'Pangolin',
      baseUrl: options.baseUrl,
      allowLoopbackHttp: options.allowLoopbackHttp ?? false,
      allowHttpHost: (host) => options.allowTailnetHttp === true && isTailnetHostname(host),
      headers: { accept: 'application/json', authorization: `Bearer ${id}.${secret}` },
      secrets: [secret],
      timeoutMs: options.timeoutMs ?? 15_000,
      rateBudget:
        options.rateBudget ?? createRateBudget({ provider: 'Pangolin', capacity: 6, refillPerSecond: 1 }),
      createError: (input) => new PangolinError(input),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.maxResponseBytes === undefined ? {} : { maxResponseBytes: options.maxResponseBytes })
    });
  } catch (error) {
    if (error instanceof ProviderError && !(error instanceof PangolinError)) {
      throw new PangolinError({ kind: error.kind, message: error.message });
    }
    throw error;
  }

  async function request(
    operation: string,
    path: string,
    input: RequestOptions & {
      method?: 'GET' | 'PUT' | 'POST';
      query?: Record<string, QueryValue>;
      json?: unknown;
    } = {}
  ): Promise<unknown> {
    const result = await http.request({
      operation,
      path: `/v1${path}`,
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
    const envelope = readPangolinEnvelope(body);
    const ok = result.status >= 200 && result.status < 300;
    // The envelope is checked on every answer: HTTP 200 does not imply success.
    if (ok && envelope.success === true && envelope.error !== true) return envelope.data;
    const message = envelope.message ? `: ${http.safeText(envelope.message)}` : '';
    throw new PangolinError({
      kind: pangolinErrorKind(result.status, envelope),
      message:
        ok && envelope.success === null
          ? 'Pangolin answered with something that is not an API response (is this the Integration API, not the dashboard?)'
          : `Pangolin refused ${operation} (HTTP ${result.status})${message}`,
      status: result.status,
      operation,
      retryAfterMs: result.retryAfterMs,
      detail:
        envelope.status !== null && envelope.status !== result.status ? { envelopeStatus: envelope.status } : {}
    });
  }

  const unreadable = (operation: string): PangolinError =>
    new PangolinError({
      kind: 'invalid_response',
      message: `Pangolin answered ${operation} in an unexpected shape`,
      operation
    });

  function readRows<T>(rows: readonly unknown[], parse: (row: unknown) => T | null, operation: string): T[] {
    return rows.flatMap((row, index) => {
      const value = parse(row);
      if (value === null) options.onSkipped?.({ operation, index });
      return value === null ? [] : [value];
    });
  }

  /**
   * Reads a whole list. Pangolin has two paging styles: sites and resources
   * default to 20 rows by `page`/`pageSize`, the rest to 1000 by
   * `limit`/`offset` and reject unknown parameters.
   */
  async function list<T>(
    operation: string,
    path: string,
    key: string,
    paging: Paging,
    parse: (row: unknown) => T | null,
    { signal }: RequestOptions
  ): Promise<T[]> {
    const rows: unknown[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const data = await request(operation, path, {
        query:
          paging === 'page' ? { pageSize: PAGE_SIZE, page } : { limit: PAGE_SIZE, offset: rows.length },
        ...(signal ? { signal } : {})
      });
      const record = (data ?? {}) as Record<string, unknown>;
      const items = record[key];
      if (!Array.isArray(items)) throw unreadable(operation);
      rows.push(...(items as unknown[]));
      // Some handlers count with an uncast SQL bigint, which arrives as a string.
      const rawTotal = (record['pagination'] as Record<string, unknown> | null | undefined)?.['total'];
      const total = rawTotal === undefined || rawTotal === null ? Number.NaN : Number(rawTotal);
      if (!Number.isFinite(total) || items.length === 0 || rows.length >= total) {
        return readRows(rows, parse, operation);
      }
    }
    throw new PangolinError({
      kind: 'invalid_response',
      message: `a Pangolin list did not end within ${MAX_PAGES} pages`,
      operation
    });
  }

  function org(orgId: string | undefined): string {
    const value = orgId ?? options.orgId;
    if (value === undefined || value === '') {
      throw new PangolinError({ kind: 'invalid_input', message: 'an organization id is required' });
    }
    return `/org/${segment(value)}`;
  }

  async function getOrNull<T>(
    operation: string,
    path: string,
    parse: (row: unknown) => T | null,
    request_: RequestOptions
  ): Promise<T | null> {
    let data: unknown;
    try {
      data = await request(operation, path, request_);
    } catch (error) {
      if (error instanceof PangolinError && error.kind === 'not_found') return null;
      throw error;
    }
    const value = parse(data);
    if (value === null) throw unreadable(operation);
    return value;
  }

  async function write<T>(
    operation: string,
    method: 'PUT' | 'POST',
    path: string,
    json: Record<string, unknown>,
    parse: (row: unknown) => T | null,
    request_: RequestOptions
  ): Promise<T> {
    const value = parse(await request(operation, path, { method, json, ...request_ }));
    // The write happened; only its confirmation could not be read.
    if (value === null) throw unreadable(operation);
    return value;
  }

  const ruleBody = ({ action, match, value, priority, enabled }: RuleInput): Record<string, unknown> => ({
    action,
    match,
    value,
    priority,
    enabled
  });

  return {
    async probe(request_ = {}) {
      const byOrg = options.orgId !== undefined;
      try {
        const data = await request(
          byOrg ? 'sites.list' : 'orgs.list',
          byOrg ? `${org(undefined)}/sites` : '/orgs',
          { query: byOrg ? { pageSize: 1, page: 1 } : { limit: 1, offset: 0 }, ...request_ }
        );
        const record = (data ?? {}) as Record<string, unknown>;
        const items = record[byOrg ? 'sites' : 'orgs'];
        if (!Array.isArray(items)) throw unreadable('probe');
        const total = Number((record['pagination'] as Record<string, unknown> | undefined)?.['total']);
        return { authenticated: true, count: Number.isFinite(total) ? total : items.length };
      } catch (error) {
        if (error instanceof PangolinError && ['unauthorized', 'forbidden'].includes(error.kind)) {
          return { authenticated: false, count: null };
        }
        throw error;
      }
    },

    listOrgs: (request_ = {}) => list('orgs.list', '/orgs', 'orgs', 'offset', parseOrg, request_),

    listSites: async (orgId, request_ = {}) =>
      list('sites.list', `${org(orgId)}/sites`, 'sites', 'page', parseSite, request_),

    getSite: async (id, orgId, request_ = {}) =>
      getOrNull(
        'sites.get',
        /^\d+$/.test(id) ? `/site/${id}` : `${org(orgId)}/site/${segment(id)}`,
        parseSite,
        request_
      ),

    listResources: async (orgId, request_ = {}) =>
      list('resources.list', `${org(orgId)}/resources`, 'resources', 'page', parseResource, request_),

    getResource: (id, request_ = {}) =>
      getOrNull('resources.get', `/resource/${segment(id)}`, parseResource, request_),

    listTargets: (resourceId, request_ = {}) =>
      list('targets.list', `/resource/${segment(resourceId)}/targets`, 'targets', 'offset', parseTarget, request_),

    listRules: (resourceId, request_ = {}) =>
      list('rules.list', `/resource/${segment(resourceId)}/rules`, 'rules', 'offset', parseRule, request_),

    listDomains: async (orgId, request_ = {}) =>
      list('domains.list', `${org(orgId)}/domains`, 'domains', 'offset', parseDomain, request_),

    async listDomainDnsRecords(domainId, orgId, request_ = {}) {
      const operation = 'domains.dnsRecords';
      const data = await request(operation, `${org(orgId)}/domain/${segment(domainId)}/dns-records`, request_);
      if (!Array.isArray(data)) throw unreadable(operation);
      return readRows(data as unknown[], parseDnsRecord, operation);
    },

    createResource: async (input, orgId, request_ = {}) =>
      write(
        'resources.create',
        'PUT',
        `${org(orgId)}/resource`,
        {
          name: input.name,
          domainId: input.domainId,
          subdomain: input.subdomain,
          mode: input.mode,
          ...(input.proxyPort === undefined ? {} : { proxyPort: input.proxyPort }),
          ...(input.ssl === undefined ? {} : { ssl: input.ssl }),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled })
        },
        parseResource,
        request_
      ),

    createTarget: (resourceId, input, request_ = {}) =>
      write(
        'targets.create',
        'PUT',
        `/resource/${segment(resourceId)}/target`,
        {
          siteId: /^\d+$/.test(String(input.siteId)) ? Number(input.siteId) : input.siteId,
          ip: input.ip,
          port: input.port,
          ...(input.method === undefined ? {} : { method: input.method }),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          ...(input.path === undefined ? {} : { path: input.path }),
          ...(input.pathMatchType === undefined ? {} : { pathMatchType: input.pathMatchType }),
          ...(input.priority === undefined ? {} : { priority: input.priority })
        },
        parseTarget,
        request_
      ),

    createRule: (resourceId, input, request_ = {}) =>
      write('rules.create', 'PUT', `/resource/${segment(resourceId)}/rule`, ruleBody(input), parseRule, request_),

    updateRule: (resourceId, ruleId, input, request_ = {}) =>
      write(
        'rules.update',
        'POST',
        `/resource/${segment(resourceId)}/rule/${segment(ruleId)}`,
        ruleBody(input),
        parseRule,
        request_
      )
  };
}
