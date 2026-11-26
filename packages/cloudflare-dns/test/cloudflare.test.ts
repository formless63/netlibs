import { DnsApplyError, type DnsOperation, type DnsRecord } from '@formless63/dns-plan';
import { createRateBudget, type FetchInit, type FetchLike } from '@formless63/provider-http';
import { describe, expect, it } from 'bun:test';

import { cloudflareErrorKind, CloudflareError, createCloudflareDns, readEnvelope } from '../src/index.ts';

const TOKEN = 'synthetic-token-value-0001';
const ZONE = { zoneId: 'zone1', zoneName: 'example.test' };

type Reply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> };
const ok = (result: unknown, totalPages?: number): Reply => ({
  body: { success: true, errors: [], messages: [], result, ...(totalPages ? { result_info: { total_pages: totalPages } } : {}) }
});
const fail = (status: number, errors: unknown[] = []): Reply => ({ status, body: { success: false, errors, messages: [], result: null } });
const zone = (over = {}) => ({ id: 'zone1', name: 'example.test', status: 'active', paused: false, account: { id: 'acct' }, name_servers: ['ns1.cf.test', 'ns2.cf.test'], ...over });
const rec = (over = {}) => ({ id: 'r1', type: 'A', name: 'example.test', content: '203.0.113.10', ttl: 1, proxied: true, proxiable: true, ...over });
const A: DnsRecord = { type: 'A', name: '@', content: '203.0.113.10', ttlSeconds: null, priority: null, proxied: false };

function setup(replies: Reply[], extra = {}) {
  const calls: Array<{ url: URL; init: FetchInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected request');
    return new Response(reply.text ?? JSON.stringify(reply.body ?? {}), { status: reply.status ?? 200, headers: reply.headers ?? {} });
  };
  const dns = createCloudflareDns({ apiToken: TOKEN, accountId: 'acct', fetch, rateBudget: createRateBudget({ capacity: 1000, refillPerSecond: 1000 }), ...extra });
  return { dns, calls, body: (index: number) => JSON.parse(calls[index]!.init.body!) as Record<string, unknown> };
}

async function caught(promise: Promise<unknown>): Promise<CloudflareError> {
  let error: unknown = await promise.then(() => null, (reason: unknown) => reason);
  expect(`${JSON.stringify(error)}${String((error as Error).stack)}`).not.toContain(TOKEN);
  if (error instanceof DnsApplyError) error = error.cause;
  expect(error).toBeInstanceOf(CloudflareError);
  return error as CloudflareError;
}
const create = (record: Partial<DnsRecord> = {}): DnsOperation => ({ kind: 'create', record: { ...A, ...record } });

describe('transport', () => {
  it('sends the token only as a header and refuses redirects', async () => {
    const { dns, calls } = setup([ok([zone()], 1)]);
    await dns.listZones();
    expect(calls[0]!.init.headers['authorization']).toBe(`Bearer ${TOKEN}`);
    expect(calls[0]!.init.redirect).toBe('error');
    expect(calls[0]!.url.href).not.toContain(TOKEN);
    expect(calls[0]!.url.pathname).toBe('/client/v4/zones');
  });

  it('rejects an unusable token or base URL without echoing it', () => {
    for (const apiToken of ['', `${TOKEN}\r\nX: 1`]) expect(() => createCloudflareDns({ apiToken })).toThrow(CloudflareError);
    expect(() => createCloudflareDns({ apiToken: TOKEN, baseUrl: 'http://a.example' })).toThrow(/must use https/);
  });

  it('redacts a token the provider echoes', async () => {
    const { dns } = setup([fail(400, [{ code: 1, message: `bad ${TOKEN}` }])]);
    expect((await caught(dns.listZones())).message).toContain('[redacted]');
  });
});

describe('the envelope decides, not the status', () => {
  it('rejects a 200 that reports failure, and one that is not an envelope', async () => {
    const lied = setup([{ body: { success: false, errors: [{ code: 1004, message: 'DNS Validation Error' }], result: null } }]);
    const error = await caught(lied.dns.listZones());
    expect(error).toMatchObject({ kind: 'invalid_request', status: 200, providerCode: '1004' });
    const html = setup([{ text: '<html>origin unreachable</html>' }]);
    expect((await caught(html.dns.listZones())).kind).toBe('invalid_response');
  });

  it('classifies by code, then status', async () => {
    const chained = setup([fail(400, [{ code: 6003, message: 'x', error_chain: [{ code: 6111, message: 'y' }] }])]);
    expect(await caught(chained.dns.listZones())).toMatchObject({ kind: 'unauthorized', codes: [6003, 6111] });
    for (const [status, kind] of [[401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [422, 'invalid_request'], [500, 'unavailable']] as const) {
      expect((await caught(setup([fail(status)]).dns.getZone('z'))).kind).toBe(kind);
    }
    expect(cloudflareErrorKind(400, [7003])).toBe('not_found');
  });

  it('keeps Retry-After', async () => {
    const { dns } = setup([{ status: 429, headers: { 'retry-after': '42' } }]);
    expect(await caught(dns.listZones())).toMatchObject({ kind: 'rate_limited', retryAfterMs: 42_000, retryable: true });
  });

  it('never throws on odd bodies', () => {
    for (const body of [null, 'x', 1, ['a']]) expect(readEnvelope(body).success).toBeNull();
  });
});

describe('zones', () => {
  it('filters, pages at 50 and keeps the status verbatim', async () => {
    const { dns, calls } = setup([ok([zone({ id: 'z1' })], 2), ok([zone({ id: 'z2', status: 'deactivated' })], 2)]);
    const zones = await dns.listZones({ name: 'example.test' });
    expect(zones.map(({ zoneId, status }) => [zoneId, status])).toEqual([['z1', 'active'], ['z2', 'deactivated']]);
    expect(Object.fromEntries(calls[1]!.url.searchParams)).toEqual({ name: 'example.test', 'account.id': 'acct', page: '2', per_page: '50' });
    expect(zones[0]).toMatchObject({ nameservers: ['ns1.cf.test', 'ns2.cf.test'], accountId: 'acct', paused: false });
  });
  it('finds by exact name or returns null', async () => {
    expect((await setup([ok([zone()], 1)]).dns.findZone('example.test'))?.zoneId).toBe('zone1');
    expect(await setup([ok([], 1)]).dns.findZone('nope.test')).toBeNull();
  });
});

describe('listRecords', () => {
  it('returns relative names and a null automatic TTL', async () => {
    const { dns } = setup([ok([rec(), rec({ id: 'r2', name: 'www.example.test', ttl: 300, proxied: false }), rec({ id: 'r3', type: 'MX', priority: 10, proxiable: false })], 1)]);
    const records = await dns.listRecords(ZONE);
    expect(records.map(({ name, ttlSeconds, priority }) => [name, ttlSeconds, priority])).toEqual([['@', null, null], ['www', 300, null], ['@', null, 10]]);
  });
  it('fails rather than returning a truncated list', async () => {
    const page = Array.from({ length: 100 }, (_, i) => rec({ id: `r${i}` }));
    const { dns } = setup([ok(page, 9), ok(page, 9)], { maxPages: 2 });
    expect((await caught(dns.listRecords(ZONE))).message).toContain('did not end');
  });
  it('stops on a short page without result_info, and rejects non-lists and bad rows', async () => {
    const short = setup([ok([rec()])]);
    expect(await short.dns.listRecords(ZONE)).toHaveLength(1);
    expect((await caught(setup([ok({ id: 'x' })]).dns.listRecords(ZONE))).kind).toBe('invalid_response');
    expect((await caught(setup([ok([{ id: 'x' }], 1)]).dns.listRecords(ZONE))).kind).toBe('invalid_response');
  });
});

describe('apply', () => {
  it('creates with a full name, the automatic TTL and priority only when set', async () => {
    const { dns, calls, body } = setup([ok(rec({ id: 'new' })), ok(rec({ id: 'mx' }))]);
    const results = await dns.apply(ZONE, [create({ proxied: true }), create({ type: 'MX', content: 'mail.test', priority: 10 })]);
    expect(calls[0]!.init.method).toBe('POST');
    expect(body(0)).toEqual({ type: 'A', name: 'example.test', content: '203.0.113.10', ttl: 1, proxied: true });
    expect(body(1)).toEqual({ type: 'MX', name: 'example.test', content: 'mail.test', ttl: 1, priority: 10 });
    expect(results[0]).toEqual({ kind: 'create', type: 'A', name: '@', status: 'applied', recordId: 'new' });
  });
  it('overwrites on update', async () => {
    const { dns, calls, body } = setup([ok(rec())]);
    await dns.apply(ZONE, [{ kind: 'update', recordId: 'r/1', record: { ...A, name: 'www', ttlSeconds: 300 } }]);
    expect([calls[0]!.init.method, calls[0]!.url.pathname]).toEqual(['PUT', '/client/v4/zones/zone1/dns_records/r%2F1']);
    expect(body(0)['ttl']).toBe(300);
  });
  it('refuses unproxiable proxying and out-of-range TTLs before any request', async () => {
    const { dns, calls } = setup([]);
    for (const record of [{ type: 'TXT', proxied: true }, { ttlSeconds: 1 }, { ttlSeconds: 30 }, { ttlSeconds: 86_401 }]) {
      expect((await caught(dns.apply(ZONE, [create(record)]))).kind).toBe('invalid_input');
    }
    expect(calls).toHaveLength(0);
  });
  it('converges a repeated create only when that record is really there', async () => {
    const exists = fail(400, [{ code: 81_057, message: 'The record already exists.' }]);
    const same = setup([exists, ok([rec()], 1)]);
    expect((await same.dns.apply(ZONE, [create()]))[0]!.status).toBe('already_present');
    const other = setup([fail(400, [{ code: 81_053, message: 'host already exists' }]), ok([rec({ type: 'CNAME', content: 'x.test' })], 1)]);
    expect((await caught(other.dns.apply(ZONE, [create()]))).kind).toBe('invalid_request');
  });
  it('converges a repeated delete and accepts both documented bodies', async () => {
    const remove: DnsOperation = { kind: 'delete', recordId: 'r1', record: A };
    expect((await setup([fail(404)]).dns.apply(ZONE, [remove]))[0]!.status).toBe('already_absent');
    for (const reply of [{ body: { result: { id: 'r1' } } }, ok({ id: 'r1' })]) {
      expect((await setup([reply]).dns.apply(ZONE, [remove]))[0]!.status).toBe('applied');
    }
  });
  it('stops at the first failure and reports what was already done', async () => {
    const { dns, calls } = setup([ok(rec({ id: 'first' })), fail(500, [{ code: 1000, message: 'boom' }])]);
    const error = await dns.apply(ZONE, [create(), create({ name: 'www' }), create({ name: 'api' })]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DnsApplyError);
    expect((error as DnsApplyError).completed.map((done) => done.recordId)).toEqual(['first']);
    expect((error as DnsApplyError).failed.record.name).toBe('www');
    expect(((error as DnsApplyError).cause as CloudflareError).kind).toBe('unavailable');
    expect(calls).toHaveLength(2);
  });
});

describe('a create refused because the name is taken', () => {
  const exists = fail(400, [{ code: 81_053, message: 'An A, AAAA, or CNAME record with that host already exists.' }]);

  it('reads back one name, a few pages, and compares content as DNS data', async () => {
    const txt = create({ type: 'TXT', name: 'www', content: 'v=spf1 -all' });
    const { dns, calls } = setup([exists, ok([rec({ id: 'there', type: 'TXT', name: 'www.example.test', content: '"v=spf1 -all"', proxied: false })], 1)]);
    const [result] = await dns.apply(ZONE, [txt]);
    expect(result).toEqual({ kind: 'create', type: 'TXT', name: 'www', status: 'already_present', recordId: 'there' });
    expect(calls[1]!.url.searchParams.get('name.exact')).toBe('www.example.test');

    const page = Array.from({ length: 100 }, (_, i) => rec({ id: `r${i}`, content: '203.0.113.99' }));
    const long = setup([exists, ...Array.from({ length: 5 }, () => ok(page, 9))]);
    expect((await caught(long.dns.apply(ZONE, [create()]))).message).toContain('did not end within 5 pages');
    expect(long.calls).toHaveLength(6);
  });

  it('reports a TTL or proxy difference instead of claiming a full match', async () => {
    const { dns } = setup([exists, ok([rec({ ttl: 300, proxied: true })], 1)]);
    expect((await dns.apply(ZONE, [create()]))[0]!.differingAttributes).toEqual(['ttlSeconds', 'proxied']);
  });

  it('names what holds the name, and does not take another case or priority for the same record', async () => {
    const other = setup([exists, ok([rec({ id: 'c1', type: 'CNAME', content: 'x.test' })], 1)]);
    const error = await caught(other.dns.apply(ZONE, [create()]));
    expect(error.message).toContain('a different record holds that name (CNAME)');
    expect(error.detail['conflictingRecords']).toEqual([{ type: 'CNAME', recordId: 'c1' }]);

    const txt = setup([exists, ok([rec({ type: 'TXT', content: 'token=abc' })], 1)]);
    await caught(txt.dns.apply(ZONE, [create({ type: 'TXT', content: 'token=ABC' })]));
    const mx = setup([exists, ok([rec({ type: 'MX', content: 'mail.test', priority: 20 })], 1)]);
    await caught(mx.dns.apply(ZONE, [create({ type: 'MX', content: 'mail.test', priority: 10 })]));
  });

  it('keeps the kind of a read-back that fails', async () => {
    const { dns } = setup([exists, { status: 429, body: {} }]);
    expect((await caught(dns.apply(ZONE, [create()]))).kind).toBe('rate_limited');
  });
});

describe('a type change is one batch', () => {
  const swap: DnsOperation[] = [
    { kind: 'delete', recordId: 'a1', record: { type: 'A', name: 'www', content: '203.0.113.10' }, group: 'g' },
    { kind: 'delete', recordId: 'a2', record: { type: 'AAAA', name: 'www', content: '2001:db8::1' }, group: 'g' },
    { kind: 'create', record: { ...A, type: 'CNAME', name: 'www', content: 'target.example.net' }, group: 'g' }
  ];

  it('sends the deletes and the creates in one request, one result each', async () => {
    const { dns, calls, body } = setup([ok({ deletes: [{ id: 'a1' }, { id: 'a2' }], posts: [{ id: 'c1' }] })]);
    const results = await dns.apply(ZONE, swap);
    expect(calls).toHaveLength(1);
    expect([calls[0]!.init.method, calls[0]!.url.pathname]).toEqual(['POST', '/client/v4/zones/zone1/dns_records/batch']);
    expect(body(0)).toEqual({
      deletes: [{ id: 'a1' }, { id: 'a2' }],
      posts: [{ type: 'CNAME', name: 'www.example.test', content: 'target.example.net', ttl: 1, proxied: false }]
    });
    expect(results.map(({ kind, status, recordId }) => [kind, status, recordId])).toEqual([
      ['delete', 'applied', 'a1'],
      ['delete', 'applied', 'a2'],
      ['create', 'applied', 'c1']
    ]);
    expect(dns.capabilities().atomicGroups).toBe(true);
  });

  it('reports a refused batch with only what came before it', async () => {
    const { dns } = setup([ok(rec({ id: 'first' })), fail(400, [{ code: 1004, message: 'DNS Validation Error' }])]);
    const error = await dns.apply(ZONE, [create({ name: 'api' }), ...swap]).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DnsApplyError);
    expect((error as DnsApplyError).completed.map(({ recordId }) => recordId)).toEqual(['first']);
    expect((error as DnsApplyError).failed).toBe(swap[0]!);
    expect((error as DnsApplyError).kind).toBe('invalid_request');
  });

  it('applies any other group one operation at a time', async () => {
    const { dns, calls } = setup([ok(rec({ id: 'n' })), ok({ id: 'a1' })]);
    await dns.apply(ZONE, [
      { ...create({ name: 'www' }), group: 'g' },
      { kind: 'delete', recordId: 'a1', record: { type: 'A', name: 'www', content: '203.0.113.9' }, group: 'g' }
    ]);
    expect(calls.map(({ init }) => init.method)).toEqual(['POST', 'DELETE']);
    expect(calls[0]!.url.pathname).toBe('/client/v4/zones/zone1/dns_records');
  });
});

describe('a list that does not end', () => {
  it('is an error on an empty page before the last one', async () => {
    const { dns } = setup([ok([rec()], 3), ok([], 3)]);
    expect((await caught(dns.listRecords(ZONE))).message).toContain('empty page before the last');
  });
  it('accepts an empty zone', async () => {
    expect(await setup([ok([], 1)]).dns.listRecords(ZONE)).toEqual([]);
    expect(await setup([ok([])]).dns.listRecords(ZONE)).toEqual([]);
  });
});

describe('a zone list the caller limits', () => {
  it('stops at the limit, in as few requests as it needs', async () => {
    const zones = Array.from({ length: 5 }, (_, i) => zone({ id: `z${i}` }));
    const { dns, calls } = setup([ok(zones, 4)]);
    expect((await dns.listZones({ limit: 5 })).map(({ zoneId }) => zoneId)).toEqual(['z0', 'z1', 'z2', 'z3', 'z4']);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.searchParams.get('per_page')).toBe('5');
    expect((await caught(setup([]).dns.listZones({ limit: 0 }))).kind).toBe('invalid_input');
  });
});
