import { describe, expect, it } from 'bun:test';

import {
  createHttpClient,
  createRateBudget,
  isPrivateHost,
  normalizeBaseUrl,
  parseRetryAfter,
  ProviderError,
  safeProviderText,
  sleep,
  type FetchInit,
  type FetchLike
} from '../src/index.ts';

const SECRET = 'synthetic secret/value+0001';
const BASE = 'https://api.example.invalid/v1';

async function caught(promise: Promise<unknown>): Promise<ProviderError> {
  const error = await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason
  );
  expect(error).toBeInstanceOf(ProviderError);
  const text = `${JSON.stringify(error)} ${String((error as Error).stack)}`;
  for (const form of [SECRET, encodeURIComponent(SECRET), 'token=']) expect(text).not.toContain(form);
  return error as ProviderError;
}

function client(fetch: FetchLike, extra: Partial<Parameters<typeof createHttpClient>[0]> = {}) {
  return createHttpClient({
    provider: 'Acme',
    baseUrl: BASE,
    fetch,
    headers: { authorization: SECRET },
    secrets: [SECRET],
    ...extra
  });
}

describe('createHttpClient', () => {
  it('sends method, query, headers and JSON, and refuses redirects', async () => {
    const calls: Array<{ url: string; init: FetchInit }> = [];
    const http = client(async (url, init) => {
      calls.push({ url, init });
      return new Response('{"ok":1}', { headers: { 'retry-after': '3' } });
    });
    const result = await http.request({
      operation: 'things.create',
      method: 'POST',
      path: '/things',
      query: { a: 1, skip: undefined, none: null, b: 'x y' },
      json: { n: 1 }
    });
    expect(calls[0]!.url).toBe(`${BASE}/things?a=1&b=x+y`);
    expect(calls[0]!.init).toMatchObject({ method: 'POST', redirect: 'error', body: '{"n":1}' });
    expect(calls[0]!.init.headers).toMatchObject({ 'content-type': 'application/json', authorization: SECRET });
    expect(result.json()).toEqual({ ok: 1 });
    expect(result.retryAfterMs).toBe(3000);
  });

  it('never lets a transport error, which can carry the URL, reach the caller', async () => {
    const http = client(async (url) => {
      throw Object.assign(new TypeError(`fetch failed for ${url}?token=${SECRET}`), {
        cause: { code: 'ECONNREFUSED', url }
      });
    });
    const error = await caught(http.request({ operation: 'x' }));
    expect(error).toMatchObject({ kind: 'unavailable', retryable: true, detail: { networkCode: 'ECONNREFUSED' } });
    expect(error.cause).toBeUndefined();
    const odd = client(async () => {
      throw Object.assign(new Error('x'), { code: `token=${SECRET}` });
    });
    expect((await caught(odd.request({ operation: 'x' }))).detail).toEqual({});
  });

  it('bounds responses by declared and by actual size, without reading the rest', async () => {
    const declared = client(async () => new Response('x', { headers: { 'content-length': '999999' } }), { maxResponseBytes: 10 });
    expect((await caught(declared.request({ operation: 'x' }))).kind).toBe('invalid_response');
    let pulled = 0;
    const endless = client(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulled += 1;
              controller.enqueue(new Uint8Array(1000));
            }
          })
        ),
      { maxResponseBytes: 5000 }
    );
    expect(await caught(endless.request({ operation: 'x' }))).toMatchObject({ status: 200, message: expect.stringContaining('too large') });
    expect(pulled).toBeLessThan(20);
  });

  it('keeps the status of an oversized error answer and drops its body', async () => {
    let cancelled = false;
    const big = client(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(new Uint8Array(1000));
            },
            cancel() {
              cancelled = true;
            }
          }),
          { status: 429, headers: { 'retry-after': '7' } }
        ),
      { maxResponseBytes: 5000 }
    );
    expect(await big.request({ operation: 'x' })).toMatchObject({ status: 429, text: '', retryAfterMs: 7000 });
    expect(cancelled).toBe(true);
  });

  it('tells a timeout from a caller abort', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('x'))));
    expect((await caught(client(hang, { timeoutMs: 10 }).request({ operation: 'x' }))).kind).toBe('timeout');
    const controller = new AbortController();
    const pending = client(hang).request({ operation: 'x', signal: controller.signal });
    controller.abort();
    const error = await caught(pending);
    expect(error).toMatchObject({ kind: 'aborted', retryable: false });
  });

  it('throws the package error class, including for local rate limiting', async () => {
    class AcmeError extends ProviderError {}
    const http = client(async () => new Response('not json'), {
      createError: (options) => new AcmeError(options),
      rateBudget: createRateBudget({ capacity: 1, refillPerSecond: 0.001, maxWaitMs: 1 })
    });
    const result = await http.request({ operation: 'x' });
    expect(() => result.json()).toThrow(AcmeError);
    const limited = await caught(http.request({ operation: 'x' }));
    expect(limited).toBeInstanceOf(AcmeError);
    expect(limited).toMatchObject({ name: 'AcmeError', kind: 'rate_limited', detail: { source: 'local_rate_budget' } });
  });
});

describe('safeProviderText', () => {
  it('removes secrets in every encoding, control characters and excess length', () => {
    const text = safeProviderText(
      `a ${SECRET} b ${encodeURIComponent(SECRET)} c ${new URLSearchParams({ k: SECRET }).toString()}\r\nX: 1`,
      [SECRET, '']
    );
    expect(text).toBe('a [redacted] b [redacted] c k=[redacted] X: 1');
    expect(safeProviderText('y'.repeat(300))).toHaveLength(201);
  });
});

describe('URLs', () => {
  it('normalizes and rejects unsafe base URLs', () => {
    const ok = (url: string, extra = {}) => normalizeBaseUrl(url, { provider: 'Acme', ...extra });
    expect(ok('https://a.example/v1//')).toBe('https://a.example/v1');
    expect(ok('http://127.0.0.1:9/x', { allowLoopbackHttp: true })).toBe('http://127.0.0.1:9/x');
    expect(ok('http://h.ts.net', { allowHttpHost: (h: string) => h.endsWith('.ts.net') })).toBe('http://h.ts.net');
    for (const bad of ['nope', 'http://a.example', 'http://127.0.0.1', 'https://u:p@a.example', 'https://a.example?x', 'https://a.example#x', 'ftp://a.example']) {
      expect(() => ok(bad), bad).toThrow(ProviderError);
    }
    expect(() => ok('http://127.0.0.1.evil.example', { allowLoopbackHttp: true })).toThrow();
  });

  it('classifies private hosts at range boundaries', () => {
    const privates = ['localhost', 'router', 'x.local', 'x.internal', '10.0.0.0', '100.64.0.0', '100.127.255.255', '127.9.9.9', '169.254.169.254', '172.16.0.0', '172.31.255.255', '192.168.1.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '[::1]', '::', 'fc00::1', 'fd7a:115c:a1e0::1', 'fe80::1', 'ff02::1', '::ffff:192.168.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'zz::1'];
    // Documentation, relay and special-use ranges, and IPv6 outside global unicast.
    privates.push('192.0.2.1', '192.88.99.1', '198.51.100.1', '203.0.113.1', '[fec0::1]', '[2001:db8::1]', '[2001::1]', '[3fff::1]', '[100::1]', '[::10.0.0.1]', '[64:ff9b:1::1]', '[2002:7f00:1::]', '[2002:c000:201::]');
    const publics = ['example.com', '9.255.255.255', '11.0.0.0', '100.63.255.255', '100.128.0.0', '172.15.255.255', '172.32.0.0', '192.167.1.1', '8.8.8.8', '2001:4860::1', '::ffff:8.8.8.8', 'localhost.example.com', '[2600::1]', '[2a00::1]', '[64:ff9b::909:909]', '[2002:909:909::]', '203.0.114.1'];
    expect(privates.filter((host) => !isPrivateHost(host))).toEqual([]);
    expect(publics.filter((host) => isPrivateHost(host))).toEqual([]);
  });
});

describe('createRateBudget', () => {
  it('starts full, refills, reserves ahead and refuses long waits', async () => {
    let now = 0;
    const waits: number[] = [];
    const budget = createRateBudget({
      capacity: 2,
      refillPerSecond: 1,
      maxWaitMs: 1500,
      now: () => now,
      sleep: async (ms) => void waits.push(ms)
    });
    await budget.acquire(2);
    expect(budget.tryAcquire()).toBe(false);
    await budget.acquire();
    expect(waits).toEqual([1000]);
    await expect(budget.acquire()).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 2000 });
    now = 3000;
    expect(budget.stats()).toMatchObject({ available: 2, acquired: 2, rejected: 1, pending: 0 });
    expect(() => createRateBudget({ capacity: 0, refillPerSecond: 1 })).toThrow(ProviderError);
    await expect(budget.acquire(3)).rejects.toMatchObject({ kind: 'invalid_input' });
  });

  it('returns the reservation when a waiter aborts', async () => {
    const now = 0;
    const budget = createRateBudget({ capacity: 1, refillPerSecond: 1, now: () => now });
    await budget.acquire();
    const controller = new AbortController();
    const waiting = budget.acquire(1, { signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ kind: 'aborted' });
    expect(budget.stats()).toMatchObject({ pending: 0, acquired: 1 });
    expect(budget.tryAcquire()).toBe(false);
  });

  it('sleep rejects at once for an aborted signal', async () => {
    await expect(sleep(10_000, AbortSignal.abort())).rejects.toBeDefined();
  });
});

describe('parseRetryAfter', () => {
  it('reads seconds and dates', () => {
    expect(parseRetryAfter('42')).toBe(42_000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:10 GMT', 4000)).toBe(6000);
    expect(parseRetryAfter('Thu, 01 Jan 1970 00:00:00 GMT', 4000)).toBe(0);
    expect(parseRetryAfter('soon')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
  });
});
