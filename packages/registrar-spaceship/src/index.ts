import {
  isDomainName,
  normalizeDomainName,
  normalizeHostname,
  normalizeNameservers,
  normalizeStatuses
} from '@formless63/domain-intel';
import {
  assertHeaderSafe,
  createHttpClient,
  kindFromStatus,
  ProviderError,
  sleep as defaultSleep,
  type FetchLike,
  type ProviderErrorOptions,
  type RateBudget
} from '@formless63/provider-http';
import type { Money, Registrar, RegistrarDomain, RequestOptions } from '@formless63/registrar';
import { z } from 'zod';

export const SPACESHIP_API_BASE_URL = 'https://spaceship.dev/api/v1';

export class SpaceshipError extends ProviderError {
  constructor(options: Omit<ProviderErrorOptions, 'provider'>) {
    super({ ...options, provider: 'Spaceship' });
  }
}

const PAGE_SIZE = 100;
const MAX_DOMAINS = 5000;
const MAX_PAGES = 60;
const PRICE = /^\d{1,10}(\.\d{1,2})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const EXPIRED_LIFECYCLE = /expir|redemption|grace|pending ?delete|deleted/i;

const itemSchema = z.looseObject({
  name: z.string(),
  isPremium: z.boolean().optional(),
  autoRenew: z.boolean().optional(),
  registrationDate: z.string().optional(),
  expirationDate: z.string().optional(),
  lifecycleStatus: z.string().optional(),
  eppStatuses: z.array(z.string()).optional(),
  privacyProtection: z.looseObject({ level: z.string().optional() }).optional(),
  nameservers: z
    .looseObject({ provider: z.string().optional(), hosts: z.array(z.string()).optional() })
    .optional()
});

const listSchema = z.looseObject({ items: z.array(z.unknown()), total: z.number().int().nonnegative() });

const moneySchema = z.looseObject({ amount: z.union([z.string(), z.number()]), currency: z.string() });
const priceEntrySchema = z.looseObject({
  period: z.looseObject({ value: z.number().optional(), unit: z.string().optional() }).optional(),
  priceInDefaultCurrency: z.looseObject({ finalPrice: moneySchema.optional() }).optional()
});
const pricingSchema = z.looseObject({
  prices: z.looseObject({ renew: z.array(z.unknown()).optional() }).optional(),
  errorCode: z.string().nullable().optional()
});
const errorBodySchema = z.looseObject({ detail: z.string() });

function isoDate(value: string | undefined): string | null {
  const ms = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? null : new Date(ms).toISOString().slice(0, 10);
}

function unexpected(what: string): SpaceshipError {
  return new SpaceshipError({
    kind: 'invalid_response',
    message: `Spaceship returned ${what} in an unexpected shape`
  });
}

/** Normalizes one domain item. Contacts are never kept. Pricing is a separate endpoint. */
export function normalizeSpaceshipDomain(item: unknown, price: Money | null = null): RegistrarDomain {
  const parsed = itemSchema.safeParse(item);
  if (!parsed.success) throw unexpected('a domain item');
  const domain = parsed.data;
  const name = normalizeHostname(domain.name);
  if (!isDomainName(name)) {
    throw new SpaceshipError({
      kind: 'invalid_response',
      message: 'Spaceship returned a domain item without a valid name'
    });
  }
  const privacy = domain.privacyProtection?.level?.toLowerCase();
  const dns = domain.nameservers?.provider?.toLowerCase();
  const lifecycle = domain.lifecycleStatus?.trim().toLowerCase() || null;
  return {
    name,
    registeredOn: isoDate(domain.registrationDate),
    expiresOn: isoDate(domain.expirationDate),
    autoRenew: domain.autoRenew ?? null,
    privacy: privacy === 'high' ? true : privacy === 'public' ? false : null,
    transferLock: domain.eppStatuses
      ? domain.eppStatuses.some((status) => status.trim() === 'clientTransferProhibited')
      : null,
    nameservers: normalizeNameservers(domain.nameservers?.hosts ?? []),
    status: normalizeStatuses(domain.eppStatuses ?? []),
    renewalPrice: price,
    usesRegistrarDns: dns === 'basic' ? true : dns === 'custom' ? false : null,
    expired:
      lifecycle === null
        ? null
        : EXPIRED_LIFECYCLE.test(lifecycle)
          ? true
          : lifecycle === 'registered'
            ? false
            : null,
    lifecycle,
    premium: domain.isPremium ?? null
  };
}

/** The one-year renewal price (or the first listed), or null when none is usable. */
export function pickSpaceshipRenewalPrice(payload: unknown): Money | null {
  const parsed = pricingSchema.safeParse(payload);
  if (!parsed.success) throw unexpected('pricing');
  if (parsed.data.errorCode) return null;
  const entries = (parsed.data.prices?.renew ?? []).flatMap((entry) => {
    const result = priceEntrySchema.safeParse(entry);
    return result.success ? [result.data] : [];
  });
  const entry =
    entries.find(({ period }) => period?.value === 1 && period.unit?.toLowerCase() === 'y') ?? entries[0];
  const price = entry?.priceInDefaultCurrency?.finalPrice;
  if (!price) return null;
  const amount = String(price.amount).trim();
  const currency = price.currency.trim().toUpperCase();
  return PRICE.test(amount) && CURRENCY.test(currency) ? { amount, currency } : null;
}

export interface SpaceshipOptions {
  /** A key with the `domains:read` scope is enough. */
  apiKey: string;
  apiSecret: string;
  fetch?: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  maxResponseBytes?: number;
  allowLoopbackHttp?: boolean;
  rateBudget?: RateBudget;
  /** Fetch each domain's renewal price. Default true; costs one request per domain. */
  withPricing?: boolean;
  /** Pause between pricing calls; Spaceship allows 25 per 5 s. Default 250. */
  pricingPauseMs?: number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  userAgent?: string;
}

export interface SpaceshipRegistrar extends Registrar {
  getRenewalPrice(name: string, options?: RequestOptions): Promise<Money | null>;
}

/** A read-only Spaceship adapter (docs.spaceship.dev). */
export function createSpaceshipRegistrar(options: SpaceshipOptions): SpaceshipRegistrar {
  const createError = (input: ProviderErrorOptions): SpaceshipError => new SpaceshipError(input);
  let apiKey: string;
  let apiSecret: string;
  let http: ReturnType<typeof createHttpClient>;
  try {
    apiKey = assertHeaderSafe('Spaceship', 'API key', options.apiKey);
    apiSecret = assertHeaderSafe('Spaceship', 'API secret', options.apiSecret);
    http = createHttpClient({
      provider: 'Spaceship',
      baseUrl: options.baseUrl ?? SPACESHIP_API_BASE_URL,
      allowLoopbackHttp: options.allowLoopbackHttp ?? false,
      headers: {
        accept: 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-Secret': apiSecret,
        ...(options.userAgent ? { 'user-agent': options.userAgent } : {})
      },
      secrets: [apiKey, apiSecret],
      maxResponseBytes: options.maxResponseBytes ?? 1_000_000,
      createError,
      ...(options.fetch ? { fetch: options.fetch } : {}),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.rateBudget ? { rateBudget: options.rateBudget } : {})
    });
  } catch (error) {
    if (error instanceof ProviderError && !(error instanceof SpaceshipError)) {
      throw new SpaceshipError({ kind: error.kind, message: error.message });
    }
    throw error;
  }
  const pause = options.sleep ?? defaultSleep;
  const pricingPauseMs = options.pricingPauseMs ?? 250;
  const withPricing = options.withPricing ?? true;
  let pricingCalls = 0;

  function detailOf(text: string): string {
    try {
      const parsed = errorBodySchema.safeParse(JSON.parse(text));
      const detail = parsed.success ? http.safeText(parsed.data.detail) : '';
      return detail === '' ? '' : `: ${detail}`;
    } catch {
      return '';
    }
  }

  async function getJson(
    operation: string,
    path: string,
    query: Record<string, number>,
    { signal }: RequestOptions
  ): Promise<unknown> {
    const result = await http.request({ operation, path, query, ...(signal ? { signal } : {}) });
    const { status } = result;
    if (status >= 200 && status < 300) return result.json();
    const messages: Record<number, string> = {
      401: 'Spaceship rejected the API key or secret (HTTP 401)',
      403: 'Spaceship refused the request (HTTP 403); the API key may lack the domains:read scope',
      404: 'Spaceship has no such domain (HTTP 404)',
      429: 'Spaceship is rate limiting (HTTP 429)'
    };
    throw http.error({
      kind: kindFromStatus(status),
      message: `${messages[status] ?? `Spaceship answered HTTP ${status}`}${detailOf(result.text)}`,
      status,
      operation,
      retryAfterMs: result.retryAfterMs
    });
  }

  async function getPage(
    take: number,
    skip: number,
    request: RequestOptions
  ): Promise<{ items: unknown[]; total: number }> {
    const parsed = listSchema.safeParse(await getJson('domains.list', '/domains', { take, skip }, request));
    if (!parsed.success) throw unexpected('a domain list');
    return parsed.data;
  }

  function domainPath(raw: string): string {
    const name = typeof raw === 'string' ? normalizeDomainName(raw) : null;
    if (name === null) throw http.error({ kind: 'invalid_input', message: 'not a domain name' });
    return `/domains/${encodeURIComponent(name)}`;
  }

  async function getRenewalPrice(raw: string, request: RequestOptions = {}): Promise<Money | null> {
    const path = `${domainPath(raw)}/pricing`;
    if (pricingCalls > 0 && pricingPauseMs > 0) {
      try {
        await pause(pricingPauseMs, request.signal);
      } catch {
        throw http.error({ kind: 'aborted', message: 'the Spaceship request was aborted' });
      }
    }
    pricingCalls += 1;
    return pickSpaceshipRenewalPrice(await getJson('domains.pricing', path, {}, request));
  }

  /** A missing or odd price never fails the domain; auth, limits and outages do. */
  async function priceOrNull(name: string, request: RequestOptions): Promise<Money | null> {
    if (!withPricing) return null;
    try {
      return await getRenewalPrice(name, request);
    } catch (error) {
      if (error instanceof SpaceshipError && ['not_found', 'invalid_response'].includes(error.kind)) return null;
      throw error;
    }
  }

  const truncated = (): SpaceshipError =>
    new SpaceshipError({
      kind: 'invalid_response',
      message: `the Spaceship account lists more than ${MAX_DOMAINS} domains or its list never ends`,
      operation: 'domains.list'
    });

  return {
    id: 'spaceship',
    label: 'Spaceship',
    capabilities: { renewalPrice: true, status: true, nameservers: true },

    async listDomains(request = {}) {
      const items: unknown[] = [];
      for (let page = 0, done = false; !done; page += 1) {
        if (page >= MAX_PAGES) throw truncated();
        const answer = await getPage(PAGE_SIZE, items.length, request);
        if (answer.total > MAX_DOMAINS || items.length + answer.items.length > MAX_DOMAINS) throw truncated();
        items.push(...answer.items);
        done = answer.items.length === 0 || items.length >= answer.total;
      }
      const domains = new Map<string, RegistrarDomain>();
      for (const item of items) {
        const domain = normalizeSpaceshipDomain(item);
        if (domains.has(domain.name)) continue;
        domains.set(domain.name, { ...domain, renewalPrice: await priceOrNull(domain.name, request) });
      }
      return [...domains.values()];
    },

    async getDomain(raw, request = {}) {
      const domain = normalizeSpaceshipDomain(await getJson('domains.get', domainPath(raw), {}, request));
      return { ...domain, renewalPrice: await priceOrNull(domain.name, request) };
    },

    getRenewalPrice,

    async probe(request = {}) {
      return { domains: (await getPage(1, 0, request)).total };
    }
  };
}
