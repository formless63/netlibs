import { isDomainName, normalizeDomainName } from '@formless63/domain-intel';
import {
  isLoopbackHost,
  isPrivateHost,
  kindFromStatus,
  parseRetryAfter,
  readBounded,
  type FetchLike,
  type FetchResponse
} from '@formless63/provider-http';

import { IANA_RDAP_BOOTSTRAP_URL, rdapBaseUrl } from './bootstrap.ts';
import { RdapError } from './errors.ts';
import { normalizeRdapDomain, type RdapDomain } from './normalize.ts';

export interface RdapClientOptions {
  fetch?: FetchLike;
  bootstrapUrl?: string;
  /** How long a bootstrap file is reused. Default 24 hours. */
  bootstrapTtlMs?: number;
  /** Per request, redirects included. Default 20 000. */
  timeoutMs?: number;
  maxResponseBytes?: number;
  maxRedirects?: number;
  /** Permit `http:` and loopback hosts, for tests and local mocks. */
  allowLoopbackHttp?: boolean;
  userAgent?: string;
  now?: () => number;
}

export interface RdapClient {
  /** Looks one registered name up. Accepts what a person would type; see `normalizeDomainName`. */
  lookup(name: string, options?: { signal?: AbortSignal }): Promise<RdapDomain>;
}

/**
 * A read-only RDAP client. No credential is involved. Servers are third
 * parties chosen by IANA data and redirects, so every hop must be https to a
 * public host, and responses are bounded in size and time.
 */
export function createRdapClient(options: RdapClientOptions = {}): RdapClient {
  const doFetch: FetchLike = options.fetch ?? ((url, init) => globalThis.fetch(url, init));
  const bootstrapUrl = options.bootstrapUrl ?? IANA_RDAP_BOOTSTRAP_URL;
  const bootstrapTtlMs = options.bootstrapTtlMs ?? 86_400_000;
  const timeoutMs = options.timeoutMs ?? 20_000;
  const maxBytes = options.maxResponseBytes ?? 1_000_000;
  const maxRedirects = options.maxRedirects ?? 5;
  const allowLoopback = options.allowLoopbackHttp ?? false;
  const now = options.now ?? Date.now;
  const headers: Record<string, string> = {
    accept: 'application/rdap+json, application/json',
    ...(options.userAgent ? { 'user-agent': options.userAgent } : {})
  };
  let bootstrap: { loadedAt: number; value: Promise<unknown> } | null = null;

  function checkUrl(input: string, redirected: boolean): URL {
    const refuse = (why: string): never => {
      throw new RdapError({
        kind: redirected ? 'invalid_response' : 'invalid_input',
        message: `refusing ${redirected ? 'an RDAP redirect to' : 'an RDAP URL with'} ${why}`,
        ...(redirected ? { code: 'refused_redirect' as const } : {})
      });
    };
    let url: URL;
    try {
      url = new URL(input);
    } catch {
      return refuse('something that is not a URL');
    }
    const loopback = allowLoopback && isLoopbackHost(url.hostname);
    if (url.protocol !== 'https:' && !(loopback && url.protocol === 'http:')) refuse('a non-https address');
    if (url.username !== '' || url.password !== '') refuse('embedded credentials');
    if (!loopback && isPrivateHost(url.hostname)) refuse('a private host');
    return url;
  }

  async function getJson(
    start: string,
    caller: AbortSignal | undefined
  ): Promise<{ status: number; body: unknown; url: string }> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = caller ? AbortSignal.any([timeout, caller]) : timeout;
    const transportError = (): RdapError => {
      if (caller?.aborted) return new RdapError({ kind: 'aborted', message: 'the RDAP lookup was aborted' });
      if (timeout.aborted) {
        return new RdapError({
          kind: 'timeout',
          message: `the RDAP server did not answer within ${timeoutMs} ms`
        });
      }
      return new RdapError({ kind: 'unavailable', message: 'the RDAP server could not be reached' });
    };

    let url = checkUrl(start, false);
    for (let hop = 0; ; hop += 1) {
      let response: FetchResponse;
      try {
        response = await doFetch(url.href, { method: 'GET', headers, signal, redirect: 'manual' });
      } catch {
        throw transportError();
      }
      const { status } = response;
      const location = response.headers?.get('location') ?? null;
      if (status >= 300 && status < 400 && location !== null) {
        await response.body?.cancel().catch(() => undefined);
        if (hop >= maxRedirects) {
          throw new RdapError({
            kind: 'invalid_response',
            message: `the RDAP server redirected more than ${maxRedirects} times`,
            status
          });
        }
        let next: string;
        try {
          next = new URL(location, url).href;
        } catch {
          next = location;
        }
        url = checkUrl(next, true);
        continue;
      }
      if (status === 404) {
        await response.body?.cancel().catch(() => undefined);
        return { status, body: null, url: url.href };
      }
      if (status < 200 || status >= 300) {
        await response.body?.cancel().catch(() => undefined);
        throw new RdapError({
          kind: kindFromStatus(status),
          message:
            status === 429
              ? 'the RDAP server is rate limiting'
              : `the RDAP server answered HTTP ${status}`,
          status,
          retryAfterMs: parseRetryAfter(response.headers?.get('retry-after') ?? null, now())
        });
      }
      let text: string;
      try {
        text = await readBounded(response, maxBytes);
      } catch {
        if (signal.aborted) throw transportError();
        throw new RdapError({
          kind: 'invalid_response',
          message: `the RDAP answer could not be read or is too large (over ${maxBytes} bytes)`,
          status
        });
      }
      try {
        return { status, body: JSON.parse(text) as unknown, url: url.href };
      } catch {
        throw new RdapError({ kind: 'invalid_response', message: 'the RDAP answer is not JSON', status });
      }
    }
  }

  async function loadBootstrap(signal: AbortSignal | undefined): Promise<unknown> {
    if (!bootstrap || now() - bootstrap.loadedAt > bootstrapTtlMs) {
      // Shared by concurrent lookups, so one caller's abort must not fail the others.
      bootstrap = {
        loadedAt: now(),
        value: getJson(bootstrapUrl, undefined).then(({ status, body }) => {
          if (status === 404) {
            throw new RdapError({
              kind: 'unavailable',
              message: 'the RDAP bootstrap file was not found',
              status
            });
          }
          return body;
        })
      };
    }
    const current = bootstrap;
    try {
      const value = await current.value;
      if (signal?.aborted) {
        throw new RdapError({ kind: 'aborted', message: 'the RDAP lookup was aborted' });
      }
      return value;
    } catch (error) {
      if (bootstrap === current && !(error instanceof RdapError && error.kind === 'aborted')) {
        bootstrap = null;
      }
      throw error;
    }
  }

  return {
    async lookup(raw, { signal } = {}) {
      const name = normalizeDomainName(raw);
      if (name === null || !isDomainName(name)) {
        throw new RdapError({ kind: 'invalid_input', message: 'not a domain name' });
      }
      let base: string | null;
      try {
        base = rdapBaseUrl(await loadBootstrap(signal), name);
      } catch (error) {
        if (error instanceof RdapError && error.kind === 'invalid_response') bootstrap = null;
        throw error;
      }
      if (base === null) {
        throw new RdapError({
          kind: 'not_found',
          code: 'unsupported_tld',
          message: `no RDAP service is registered for .${name.split('.').at(-1)}`
        });
      }
      const answer = await getJson(`${base}domain/${encodeURIComponent(name)}`, signal);
      if (answer.status === 404) {
        throw new RdapError({
          kind: 'not_found',
          message: `RDAP has no record of ${name}; it is probably not registered`,
          status: 404
        });
      }
      return normalizeRdapDomain(answer.body, answer.url, name);
    }
  };
}
