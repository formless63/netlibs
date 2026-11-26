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
  /**
   * Resolves a host name to its addresses, so a server whose name points at a
   * private address is refused before it is asked. Called for every hop that
   * names a host, within the request's timeout; a failure counts as the server
   * being unreachable. Without it, names are not resolved. Either way `fetch`
   * resolves the name again when it connects, so a server that changes its DNS
   * answer in between (rebinding) is not stopped: only an egress policy does that.
   */
  resolveHost?: (hostname: string, options: { signal: AbortSignal }) => Promise<readonly string[]>;
  userAgent?: string;
  now?: () => number;
}

/** Who named a URL: the caller, the bootstrap file, or a redirect. */
type UrlSource = 'caller' | 'bootstrap' | 'redirect';

/** Whether a `URL.hostname` is an address literal, so there is nothing to resolve. */
function isAddressLiteral(hostname: string): boolean {
  return hostname.startsWith('[') || /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname);
}

/** Settles with `work`, or rejects as soon as the signal aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason as Error);
    if (signal.aborted) onAbort();
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

export interface RdapClient {
  /** Looks one registered name up. Accepts what a person would type; see `normalizeDomainName`. */
  lookup(name: string, options?: { signal?: AbortSignal }): Promise<RdapDomain>;
}

/**
 * A read-only RDAP client. No credential is involved. Servers are third
 * parties chosen by IANA data and redirects, so every hop must be https to a
 * public host (see `resolveHost` to also check where a name points), and
 * responses are bounded in size and time. One timeout covers a request with
 * all its redirects.
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

  const resolveHost = options.resolveHost;

  /** One request's deadline and cancellation, redirects included. */
  interface Deadline {
    signal: AbortSignal;
    failed(): RdapError;
  }

  function deadline(caller: AbortSignal | undefined): Deadline {
    const timeout = AbortSignal.timeout(timeoutMs);
    return {
      signal: caller ? AbortSignal.any([timeout, caller]) : timeout,
      failed() {
        if (caller?.aborted) return new RdapError({ kind: 'aborted', message: 'the RDAP lookup was aborted' });
        if (timeout.aborted) {
          return new RdapError({ kind: 'timeout', message: `the RDAP server did not answer within ${timeoutMs} ms` });
        }
        return new RdapError({ kind: 'unavailable', message: 'the RDAP server could not be reached' });
      }
    };
  }

  /** Validates one hop before anything is sent to it. Messages never echo the URL. */
  async function checkUrl(input: string, source: UrlSource, limit: Deadline): Promise<URL> {
    const refuse = (why: string): never => {
      throw new RdapError(
        source === 'caller'
          ? { kind: 'invalid_input', message: `refusing an RDAP URL with ${why}` }
          : source === 'redirect'
            ? { kind: 'invalid_response', message: `refusing an RDAP redirect to ${why}`, code: 'refused_redirect' }
            : { kind: 'invalid_response', message: `refusing an RDAP server at ${why}`, code: 'refused_server' }
      );
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
    if (loopback) return url;
    if (isPrivateHost(url.hostname)) refuse('a private host');
    if (resolveHost && !isAddressLiteral(url.hostname)) {
      let addresses: readonly string[];
      try {
        addresses = await untilAborted(resolveHost(url.hostname, { signal: limit.signal }), limit.signal);
      } catch {
        throw limit.failed();
      }
      if (addresses.some((address) => isPrivateHost(address))) refuse('a host that resolves to a private address');
    }
    return url;
  }

  async function getJson(
    start: string,
    source: Exclude<UrlSource, 'redirect'>,
    caller: AbortSignal | undefined
  ): Promise<{ status: number; body: unknown; url: string }> {
    const limit = deadline(caller);
    const { signal } = limit;
    let url = await checkUrl(start, source, limit);
    for (let hop = 0; ; hop += 1) {
      let response: FetchResponse;
      try {
        response = await doFetch(url.href, { method: 'GET', headers, signal, redirect: 'manual' });
      } catch {
        throw limit.failed();
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
        url = await checkUrl(next, 'redirect', limit);
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
        if (signal.aborted) throw limit.failed();
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
        value: getJson(bootstrapUrl, 'caller', undefined).then(({ status, body }) => {
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
      const answer = await getJson(`${base}domain/${encodeURIComponent(name)}`, 'bootstrap', signal);
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
