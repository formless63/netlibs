import { createRateBudget, type FetchInit, type FetchLike } from '@formless63/provider-http';
import { describe, expect, it } from 'bun:test';

import { createPangolinClient, isTailnetHostname, PangolinError, pangolinErrorKind, readPangolinEnvelope } from '../src/index.ts';

const SECRET = 'synthetic-secret-value-0001';
const BASE = 'https://pangolin-api.example.invalid';
type Reply = { status?: number; body?: unknown; text?: string };
const env = (data: unknown): Reply => ({ body: { data, success: true, error: false, message: '', status: 200 } });
const bad = (status: number, message = 'nope', http = status): Reply => ({ status: http, body: { data: null, success: false, error: true, message, status } });
const page = (key: string, rows: unknown[], total: unknown = rows.length) => env({ [key]: rows, pagination: { total } });

function setup(replies: Reply[], extra = {}) {
  const calls: Array<{ url: URL; init: FetchInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url: new URL(url), init });
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected request');
    return new Response(reply.text ?? JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  const client = createPangolinClient({ baseUrl: BASE, apiKeyId: 'id', apiKeySecret: SECRET, orgId: 'acme', fetch, rateBudget: createRateBudget({ capacity: 1000, refillPerSecond: 1000 }), ...extra });
  return { client, calls, path: (i: number) => calls[i]!.url.pathname, query: (i: number) => Object.fromEntries(calls[i]!.url.searchParams) };
}
async function caught(promise: Promise<unknown>): Promise<PangolinError> {
  const error: unknown = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(PangolinError);
  expect(`${JSON.stringify(error)}${String((error as Error).stack)}`).not.toContain(SECRET);
  return error as PangolinError;
}

describe('configuration', () => {
  it('requires https, except opted-in MagicDNS names', () => {
    const at = (baseUrl: string, extra = {}) => () => createPangolinClient({ baseUrl, apiKeyId: 'i', apiKeySecret: 's', ...extra });
    expect(at('http://hub.tailnet-name.ts.net:3003')).toThrow(/must use https/);
    expect(at('http://hub.tailnet-name.ts.net:3003', { allowTailnetHttp: true })).not.toThrow();
    for (const host of ['ts.net.example.com', 'example-ts.net', '.ts.net', 'ts.net']) expect(isTailnetHostname(host), host).toBe(false);
    for (const url of ['nope', 'https://u:p@a.example', 'https://a.example?x=1', 'https://a.example#f']) expect(at(url)).toThrow(PangolinError);
    expect(() => createPangolinClient({ baseUrl: BASE, apiKeyId: '', apiKeySecret: 's' })).toThrow(/API key id/);
  });
  it('needs an organization for organization calls', async () => {
    const { client, calls } = setup([], { orgId: undefined });
    expect((await caught(client.listSites())).kind).toBe('invalid_input');
    expect(calls).toHaveLength(0);
  });
});

describe('envelope', () => {
  it('decides success, and its status outranks the transport status', async () => {
    const error = await caught(setup([bad(401, 'Unauthorized', 200)]).client.listOrgs());
    expect(error).toMatchObject({ kind: 'unauthorized', status: 200, detail: { envelopeStatus: 401 } });
    expect((await caught(setup([{ text: '<!DOCTYPE html>' }]).client.listOrgs())).message).toContain('not the dashboard');
    expect(readPangolinEnvelope('<html>')).toEqual({ success: null, error: null, message: null, status: null, data: null });
    expect(pangolinErrorKind(200, readPangolinEnvelope({ success: false }))).toBe('invalid_request');
  });
  it.each([[400, 'invalid_request'], [401, 'unauthorized'], [403, 'forbidden'], [404, 'not_found'], [409, 'invalid_request'], [429, 'rate_limited'], [500, 'unavailable']])('maps %i to %s', async (status, kind) => {
    expect((await caught(setup([bad(status as number)]).client.listOrgs())).kind).toBe(kind as never);
  });
  it('redacts an echoed secret', async () => {
    expect((await caught(setup([bad(400, `key ${SECRET}`)]).client.listOrgs())).message).toContain('[redacted]');
  });
});

describe('lists', () => {
  it('signs requests, and uses page paging for sites and resources', async () => {
    const { client, calls, path, query } = setup([page('sites', [{ siteId: 1, niceId: 's', online: 1, address: '10.0.0.2' }])]);
    expect(await client.listSites()).toEqual([{ siteId: 1, niceId: 's', orgId: null, name: null, type: null, online: true, address: '10.0.0.2', subnet: null, endpoint: null, listenPort: null, status: null }]);
    expect(calls[0]!.init.headers['authorization']).toBe(`Bearer id.${SECRET}`);
    expect([path(0), query(0)]).toEqual(['/v1/org/acme/sites', { pageSize: '500', page: '1' }]);
  });
  it('follows the total across pages', async () => {
    const { client, query } = setup([page('resources', [{ resourceId: 1 }, { resourceId: 2 }], 3), page('resources', [{ resourceId: '3' }], 3)]);
    expect((await client.listResources()).map((r) => r.resourceId)).toEqual([1, 2, 3]);
    expect(query(1)).toEqual({ pageSize: '500', page: '2' });
  });
  it.each([
    ['listOrgs', 'orgs', '/v1/orgs', [], { orgId: 'o' }],
    ['listDomains', 'domains', '/v1/org/acme/domains', [], { domainId: 'd' }],
    ['listTargets', 'targets', '/v1/resource/10/targets', ['10'], { targetId: 1 }],
    ['listRules', 'rules', '/v1/resource/10/rules', ['10'], { ruleId: 1 }]
  ])('%s pages by offset, which those strict handlers require', async (method, key, expected, args, row) => {
    const { client, path, query } = setup([page(key as string, [row, row], '3'), page(key as string, [row], '3')]);
    const call = (client as unknown as Record<string, (...a: unknown[]) => Promise<unknown[]>>)[method as string]!;
    expect(await call(...(args as unknown[]))).toHaveLength(3);
    expect([path(0), query(0), query(1)]).toEqual([expected as string, { limit: '500', offset: '0' }, { limit: '500', offset: '2' }]);
  });
  it('reads one page without pagination, and reports rows it had to skip', async () => {
    const skipped: unknown[] = [];
    const { client, calls } = setup([env({ orgs: [{ orgId: 'a' }, { name: 'no id' }] })], { onSkipped: (s: unknown) => skipped.push(s) });
    expect(await client.listOrgs()).toEqual([{ orgId: 'a', name: null }]);
    expect(skipped).toEqual([{ operation: 'orgs.list', index: 1 }]);
    expect(calls).toHaveLength(1);
  });
  it('carries embedded targets', async () => {
    const { client } = setup([page('resources', [{ resourceId: 1, sso: 1, emailWhitelistEnabled: 0, targets: [{ targetId: 9, siteId: 4, siteName: 's', ip: 'app', port: 80, enabled: true }, 'garbage'] }])]);
    const [resource] = await client.listResources();
    expect(resource).toMatchObject({ sso: true, emailWhitelistEnabled: false });
    expect(resource!.targets).toEqual([{ targetId: 9, siteId: 4, siteName: 's', ip: 'app', port: 80, enabled: true, healthStatus: null }]);
  });
  it('reads DNS records from a bare array and rejects wrong shapes', async () => {
    expect(await setup([env([{ id: 1, recordType: 'A', value: '203.0.113.1', verified: 1 }])]).client.listDomainDnsRecords('d')).toMatchObject([{ recordType: 'A', verified: true }]);
    expect((await caught(setup([env({ nope: [] })]).client.listSites())).kind).toBe('invalid_response');
  });
});

describe('single reads', () => {
  it('picks the path by identifier and turns 404 into null', async () => {
    const byId = setup([env({ siteId: 1 })], { orgId: undefined });
    expect((await byId.client.getSite('1'))?.siteId).toBe(1);
    expect(byId.path(0)).toBe('/v1/site/1');
    const byName = setup([env({ niceId: 'a b' })]);
    await byName.client.getSite('a b');
    expect(byName.path(0)).toBe('/v1/org/acme/site/a%20b');
    expect(await setup([bad(404)]).client.getResource('9')).toBeNull();
  });
  it('probes cheaply', async () => {
    const { client, query } = setup([page('sites', [{}], 63)]);
    expect(await client.probe()).toEqual({ authenticated: true, count: 63 });
    expect(query(0)).toEqual({ pageSize: '1', page: '1' });
    expect(await setup([bad(403)]).client.probe()).toEqual({ authenticated: false, count: null });
    expect((await caught(setup([bad(503)]).client.probe())).kind).toBe('unavailable');
  });
});

describe('writes', () => {
  const rule = { action: 'ACCEPT', match: 'CIDR', value: '203.0.113.7/32', priority: 7, enabled: false };
  it('creates with PUT and updates with POST, always sending a whole rule', async () => {
    const { client, calls, path } = setup([env({ resourceId: 99 }), env({ targetId: 55 }), env({ ruleId: 77 }), env({ ruleId: 77 })]);
    await client.createResource({ name: 'app', domainId: 'd', subdomain: null, mode: 'http' });
    await client.createTarget('10', { siteId: '1', ip: '192.0.2.1', port: 3000 });
    await client.createRule('10', rule);
    await client.updateRule('10', '77', { ...rule, extra: 'dropped' } as never);
    expect(calls.map(({ init }, i) => `${init.method} ${path(i)}`)).toEqual(['PUT /v1/org/acme/resource', 'PUT /v1/resource/10/target', 'PUT /v1/resource/10/rule', 'POST /v1/resource/10/rule/77']);
    expect(JSON.parse(calls[1]!.init.body!)).toEqual({ siteId: 1, ip: '192.0.2.1', port: 3000 });
    expect(JSON.parse(calls[3]!.init.body!)).toEqual(rule);
  });
  it('reports a write refused inside HTTP 200, and one whose confirmation is unreadable', async () => {
    expect(await caught(setup([bad(409, 'exists', 200)]).client.createRule('1', rule))).toMatchObject({ kind: 'invalid_request' });
    expect(await caught(setup([env(null)]).client.createRule('1', rule))).toMatchObject({ kind: 'invalid_response', retryable: false });
  });
  it('never deletes', () => {
    expect(Object.keys(setup([]).client).filter((name) => /delete|remove/i.test(name))).toEqual([]);
  });
});
