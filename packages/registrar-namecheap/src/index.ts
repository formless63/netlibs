import { isDomainName, normalizeDomainName, normalizeHostname, normalizeNameservers } from '@formless63/domain-intel';
import {
  createHttpClient,
  ProviderError,
  sleep as defaultSleep,
  type FetchLike,
  type ProviderErrorKind,
  type ProviderErrorOptions,
  type RateBudget
} from '@formless63/provider-http';
import type { Registrar, RegistrarDomain, RequestOptions } from '@formless63/registrar';
import { z } from 'zod';

import { attribute, childElement, childElements, parseXml, XmlParseError, type XmlElement } from './xml.ts';

export const NAMECHEAP_API_URL = 'https://api.namecheap.com/xml.response';
export const NAMECHEAP_SANDBOX_API_URL = 'https://api.sandbox.namecheap.com/xml.response';

/** Namecheap-specific reasons, in addition to the general `kind`. */
export type NamecheapErrorCode = 'ip_not_whitelisted' | 'api_disabled';

export class NamecheapError extends ProviderError {
  readonly code: NamecheapErrorCode | null;

  constructor(options: Omit<ProviderErrorOptions, 'provider'> & { code?: NamecheapErrorCode }) {
    super({ ...options, provider: 'Namecheap' });
    this.code = options.code ?? null;
  }
}

const PAGE_SIZE = 100;
const MAX_DOMAINS = 5000;
const MAX_PAGES = MAX_DOMAINS / PAGE_SIZE + 1;
const OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4 = new RegExp(`^${OCTET}(?:\\.${OCTET}){3}$`);

const credentialsSchema = z.looseObject({
  apiUser: z.string().trim().min(1).max(64),
  apiKey: z.string().trim().min(1).max(256),
  userName: z.string().trim().min(1).max(64),
  clientIp: z.string().trim().regex(IPV4)
});

/** `MM/DD/YYYY` to an ISO date, or null when it is not a real date. */
export function namecheapDate(value: string | null | undefined): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value?.trim() ?? '');
  if (!match) return null;
  const [month, day, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return real ? date.toISOString().slice(0, 10) : null;
}

function bool(value: string | null): boolean | null {
  const text = value?.trim().toLowerCase();
  return text === 'true' ? true : text === 'false' ? false : null;
}

function whoisGuard(value: string | null): boolean | null {
  const text = value?.trim().toUpperCase();
  return text === 'ENABLED' ? true : text === 'DISABLED' ? false : null;
}

function domainName(value: string | null): string {
  const name = normalizeHostname(value ?? '');
  if (!isDomainName(name)) {
    throw new NamecheapError({
      kind: 'invalid_response',
      message: 'Namecheap returned a domain without a valid name'
    });
  }
  return name;
}

/** Normalizes one `<Domain>` row of `namecheap.domains.getList`. */
export function normalizeNamecheapListDomain(element: XmlElement): RegistrarDomain {
  const expired = bool(attribute(element, 'IsExpired'));
  return {
    // Not reported by this API.
    status: [],
    renewalPrice: null,
    name: domainName(attribute(element, 'Name')),
    registeredOn: namecheapDate(attribute(element, 'Created')),
    expiresOn: namecheapDate(attribute(element, 'Expires')),
    autoRenew: bool(attribute(element, 'AutoRenew')),
    privacy: whoisGuard(attribute(element, 'WhoisGuard')),
    transferLock: bool(attribute(element, 'IsLocked')),
    nameservers: [],
    usesRegistrarDns: bool(attribute(element, 'IsOurDNS')),
    expired,
    lifecycle: expired === null ? null : expired ? 'expired' : 'active',
    premium: bool(attribute(element, 'IsPremium'))
  };
}

/** Normalizes a `<DomainGetInfoResult>` of `namecheap.domains.getInfo`. */
export function normalizeNamecheapDomainInfo(result: XmlElement): RegistrarDomain {
  const details = childElement(result, 'DomainDetails');
  const dns = childElement(result, 'DnsDetails');
  const status = attribute(result, 'Status')?.trim().toLowerCase() ?? '';
  const expired = /expired/.test(status) ? true : status === 'ok' ? false : null;
  return {
    // Not reported by this API.
    status: [],
    renewalPrice: null,
    name: domainName(attribute(result, 'DomainName')),
    registeredOn: namecheapDate(childElement(details, 'CreatedDate')?.text),
    expiresOn: namecheapDate(childElement(details, 'ExpiredDate')?.text),
    autoRenew: null,
    privacy: bool(attribute(childElement(result, 'Whoisguard'), 'Enabled')),
    transferLock: null,
    nameservers: normalizeNameservers(childElements(dns, 'Nameserver').map((node) => node.text)),
    usesRegistrarDns: bool(attribute(dns, 'IsUsingOurDNS')),
    expired,
    lifecycle: expired === true ? 'expired' : expired === false ? 'active' : status || null,
    premium: bool(attribute(result, 'IsPremium'))
  };
}

interface Classified {
  kind: ProviderErrorKind;
  code?: NamecheapErrorCode;
  guidance: string;
}

const IP_ERROR: Classified = {
  kind: 'forbidden',
  code: 'ip_not_whitelisted',
  guidance:
    "Namecheap refused the client IP: whitelist this host's egress IPv4 in Namecheap → Profile → Tools → API Access and set clientIp to that address"
};
const AUTH_ERROR: Classified = {
  kind: 'unauthorized',
  guidance: 'Namecheap rejected the API credentials (check apiUser, userName and the API key)'
};
const DISABLED_ERROR: Classified = {
  kind: 'forbidden',
  code: 'api_disabled',
  guidance: 'API access is not enabled for this Namecheap account (Profile → Tools → API Access)'
};
const NOT_FOUND: Classified = {
  kind: 'not_found',
  guidance: 'Namecheap has no such domain in this account'
};
const RATE_LIMITED: Classified = {
  kind: 'rate_limited',
  guidance: 'Namecheap is rate limiting (20/min, 700/hour, 8000/day)'
};
const UPSTREAM: Classified = { kind: 'unavailable', guidance: 'Namecheap answered with an error' };

function classify(text: string, code: string | null): Classified {
  if (code === '1011150' || /\bIP\b|ClientIp|RequestIP|white-?list|allow-?list/i.test(text)) return IP_ERROR;
  if (/too many requests|rate limit/i.test(text)) return RATE_LIMITED;
  if (/api ?key|api ?user|user ?name|authenticat|credential|password/i.test(text)) return AUTH_ERROR;
  if (/api access has not been enabled|not been enabled for api|api (access )?(is )?disabled/i.test(text)) {
    return DISABLED_ERROR;
  }
  if (
    code === '2019166' ||
    code === '2016166' ||
    /not found|does ?n[o']t exist|not associated|no such domain/i.test(text)
  ) {
    return NOT_FOUND;
  }
  return UPSTREAM;
}

export interface NamecheapOptions {
  apiUser: string;
  apiKey: string;
  userName: string;
  /** This host's egress IPv4, whitelisted in Namecheap → Profile → Tools → API Access. */
  clientIp: string;
  sandbox?: boolean;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowLoopbackHttp?: boolean;
  rateBudget?: RateBudget;
  /** Pause between requests; Namecheap allows 20 per minute. Default 3500. */
  pauseMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Fetch each domain's nameservers. Default true; costs one request per domain. */
  withNameservers?: boolean;
  userAgent?: string;
}

/**
 * A read-only Namecheap adapter. Namecheap only accepts credentials in the
 * query string, so URLs never reach an error and redirects are refused; keep
 * request logging in proxies and APM tools off for this host.
 */
export function createNamecheapRegistrar(options: NamecheapOptions): Registrar {
  const credentials = credentialsSchema.safeParse(options);
  if (!credentials.success) {
    const fields = [...new Set(credentials.error.issues.map((issue) => String(issue.path[0] ?? 'options')))];
    throw new NamecheapError({
      kind: 'invalid_input',
      message: `the Namecheap options are missing or malformed (${fields.join(', ')}); clientIp must be a dotted-quad IPv4`
    });
  }
  const { apiUser, apiKey, userName, clientIp } = credentials.data;
  let http: ReturnType<typeof createHttpClient>;
  try {
    http = createHttpClient({
      provider: 'Namecheap',
      baseUrl: options.baseUrl ?? (options.sandbox ? NAMECHEAP_SANDBOX_API_URL : NAMECHEAP_API_URL),
      allowLoopbackHttp: options.allowLoopbackHttp ?? false,
      headers: {
        accept: 'application/xml, text/xml',
        ...(options.userAgent ? { 'user-agent': options.userAgent } : {})
      },
      secrets: [apiKey],
      maxResponseBytes: options.maxResponseBytes ?? 1_000_000,
      createError: (input) => new NamecheapError(input),
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.rateBudget ? { rateBudget: options.rateBudget } : {})
    });
  } catch (error) {
    if (error instanceof ProviderError && !(error instanceof NamecheapError)) {
      throw new NamecheapError({ kind: error.kind, message: error.message });
    }
    throw error;
  }
  const pauseMs = options.pauseMs ?? 3500;
  const pause = options.sleep ?? defaultSleep;
  const withNameservers = options.withNameservers ?? true;
  let requests = 0;

  async function command(
    operation: string,
    params: Record<string, string>,
    { signal }: RequestOptions
  ): Promise<XmlElement> {
    if (requests > 0 && pauseMs > 0) {
      try {
        await pause(pauseMs, signal);
      } catch {
        throw new NamecheapError({ kind: 'aborted', message: 'the Namecheap request was aborted', operation });
      }
    }
    requests += 1;
    const result = await http.request({
      operation,
      query: { ApiUser: apiUser, ApiKey: apiKey, UserName: userName, ClientIp: clientIp, Command: operation, ...params },
      ...(signal ? { signal } : {})
    });
    const { status } = result;
    const ok = status >= 200 && status < 300;
    const fail = (how: Classified, providerCode: string | null, detail: string | null): NamecheapError =>
      new NamecheapError({
        kind: how.kind,
        ...(how.code ? { code: how.code } : {}),
        message: `${how.guidance}${detail ? ` (${providerCode ? `${providerCode}: ` : ''}${detail})` : ''}`,
        status,
        operation,
        providerCode,
        retryAfterMs: result.retryAfterMs
      });
    const unreadable = (message: string): NamecheapError =>
      ok
        ? new NamecheapError({ kind: 'invalid_response', message, status, operation })
        : fail(UPSTREAM, null, `HTTP ${status}`);

    if (status === 429) throw fail(RATE_LIMITED, null, null);
    let root: XmlElement;
    try {
      root = parseXml(result.text, { maxBytes: options.maxResponseBytes ?? 1_000_000 });
    } catch (error) {
      const reason = error instanceof XmlParseError ? `: ${http.safeText(error.message)}` : '';
      throw unreadable(`the Namecheap answer is not valid XML${reason}`);
    }
    if (root.name.toLowerCase() !== 'apiresponse') throw unreadable('the Namecheap answer is not an ApiResponse');

    const firstError = childElements(childElement(root, 'Errors'), 'Error')[0] ?? null;
    if (attribute(root, 'Status')?.toUpperCase() !== 'OK' || firstError) {
      const text = firstError?.text.trim() ?? '';
      const code = attribute(firstError, 'Number')?.trim() || null;
      throw fail(
        text || code ? classify(text, code) : UPSTREAM,
        code,
        text ? http.safeText(text) : ok ? null : `HTTP ${status}`
      );
    }
    if (!ok) throw fail(UPSTREAM, null, `HTTP ${status}`);
    const response = childElement(root, 'CommandResponse');
    if (!response) throw unreadable('the Namecheap answer has no CommandResponse');
    return response;
  }

  async function getPage(
    page: number,
    pageSize: number,
    request: RequestOptions
  ): Promise<{ domains: XmlElement[]; total: number }> {
    const response = await command(
      'namecheap.domains.getList',
      { ListType: 'ALL', Page: String(page), PageSize: String(pageSize) },
      request
    );
    const result = childElement(response, 'DomainGetListResult');
    const total = childElement(childElement(response, 'Paging'), 'TotalItems')?.text.trim() ?? '';
    if (!result || !/^\d{1,7}$/.test(total)) {
      throw new NamecheapError({
        kind: 'invalid_response',
        message: 'the Namecheap domain list is missing its result or paging'
      });
    }
    return { domains: childElements(result, 'Domain'), total: Number(total) };
  }

  async function getInfo(name: string, request: RequestOptions): Promise<RegistrarDomain> {
    const response = await command('namecheap.domains.getInfo', { DomainName: name }, request);
    const result = childElement(response, 'DomainGetInfoResult');
    if (!result) {
      throw new NamecheapError({
        kind: 'invalid_response',
        message: 'the Namecheap domain info is missing its result'
      });
    }
    return normalizeNamecheapDomainInfo(result);
  }

  return {
    id: 'namecheap',
    label: 'Namecheap',
    capabilities: { renewalPrice: false, status: false, nameservers: withNameservers },

    async listDomains(request = {}) {
      const domains = new Map<string, RegistrarDomain>();
      for (let page = 1, read = 0, done = false; !done; page += 1) {
        const answer = page > MAX_PAGES ? null : await getPage(page, PAGE_SIZE, request);
        if (answer === null || answer.total > MAX_DOMAINS) {
          throw new NamecheapError({
            kind: 'invalid_response',
            message: `the Namecheap account lists more than ${MAX_DOMAINS} domains or its list never ends`
          });
        }
        for (const element of answer.domains) {
          const domain = normalizeNamecheapListDomain(element);
          if (!domains.has(domain.name)) domains.set(domain.name, domain);
        }
        read += answer.domains.length;
        done = answer.domains.length === 0 || read >= answer.total;
      }
      if (!withNameservers) return [...domains.values()];
      const enriched: RegistrarDomain[] = [];
      for (const domain of domains.values()) {
        try {
          const info = await getInfo(domain.name, request);
          enriched.push({
            ...domain,
            nameservers: info.nameservers,
            usesRegistrarDns: info.usesRegistrarDns ?? domain.usesRegistrarDns,
            privacy: domain.privacy ?? info.privacy,
            premium: domain.premium ?? info.premium
          });
        } catch (error) {
          if (!(error instanceof NamecheapError) || error.kind !== 'not_found') throw error;
          enriched.push(domain);
        }
      }
      return enriched;
    },

    async getDomain(raw, request = {}) {
      const name = typeof raw === 'string' ? normalizeDomainName(raw) : null;
      if (name === null) throw new NamecheapError({ kind: 'invalid_input', message: 'not a domain name' });
      return getInfo(name, request);
    },

    async probe(request = {}) {
      return { domains: (await getPage(1, 10, request)).total };
    }
  };
}
