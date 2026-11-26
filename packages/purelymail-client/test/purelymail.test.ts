import { diffRecords, planOperations } from '@formless63/dns-plan';
import { createRateBudget, type FetchInit, type FetchLike } from '@formless63/provider-http';
import { describe, expect, it } from 'bun:test';

import {
  createPurelymailClient,
  PURELYMAIL_OPERATIONS,
  purelymailAddress,
  purelymailErrorKind,
  PurelymailError,
  purelymailPath,
  readPurelymailEnvelope,
  type PurelymailClient
} from '../src/index.ts';

const TOKEN = 'synthetic-api-token-value-0001';
const PASSWORD = 'synthetic-mailbox-password-0002';
const DOMAIN = 'example.com';
type Reply = { status?: number; body?: unknown; text?: string; headers?: Record<string, string> };
const ok = (result: unknown): Reply => ({ body: { type: 'success', result } });
const fail = (code: string, message = 'refused', status = 200): Reply => ({ status, body: { type: 'error', code, message } });
const html = (status = 404): Reply => ({ status, text: '<!DOCTYPE html><h1>404 Not Found</h1>' });
const domain = (extra: Record<string, unknown> = {}) => ({
  name: DOMAIN,
  allowAccountReset: false,
  symbolicSubaddressing: false,
  isShared: false,
  dnsSummary: { passesMx: true, passesSpf: true, passesDkim: true, passesDmarc: true },
  ...extra
});
const rule = (extra: Record<string, unknown> = {}) => ({ id: 4_815_162_342, domainName: DOMAIN, prefix: false, matchUser: 'abuse', targetAddresses: [`ops@${DOMAIN}`], catchall: false, ...extra });

function setup(replies: Reply[] | Error, extra = {}) {
  const calls: Array<{ url: URL; init: FetchInit }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url: new URL(url), init });
    if (replies instanceof Error) throw replies;
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected request');
    return new Response(reply.text ?? JSON.stringify(reply.body), { status: reply.status ?? 200, headers: reply.headers ?? {} });
  };
  const client = createPurelymailClient({ apiToken: TOKEN, fetch, rateBudget: createRateBudget({ capacity: 1000, refillPerSecond: 1000 }), ...extra });
  return { client, calls, path: (i: number) => calls[i]!.url.pathname, body: (i: number) => calls[i]!.init.body };
}
async function caught(promise: Promise<unknown>): Promise<PurelymailError> {
  const error: unknown = await promise.then(() => null, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(PurelymailError);
  const text = `${JSON.stringify(error)}${String((error as Error).stack)}`;
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain(PASSWORD);
  return error as PurelymailError;
}

describe('configuration', () => {
  it('defaults to the provider, requires https and a header-safe token', () => {
    const at = (extra: object) => () => createPurelymailClient({ apiToken: 't', ...extra });
    expect(at({ baseUrl: 'http://mail.example.com' })).toThrow(/must use https/);
    expect(at({ baseUrl: 'http://127.0.0.1:1443', allowLoopbackHttp: true })).not.toThrow();
    for (const baseUrl of ['nope', 'https://u:p@example.com', 'https://example.com/?x=1', 'https://example.com/#f']) expect(at({ baseUrl })).toThrow(PurelymailError);
    expect(() => createPurelymailClient({ apiToken: '' })).toThrow(/API token/);
    expect(() => createPurelymailClient({ apiToken: 'a\nb' })).toThrow(PurelymailError);
  });

  it('honours a proxied base URL with a path', async () => {
    const { client, calls } = setup([ok({ credit: '1.00' })], { baseUrl: 'https://proxy.example.com/purelymail/' });
    await client.checkAccountCredit();
    expect(calls[0]!.url.href).toBe('https://proxy.example.com/purelymail/api/v0/checkAccountCredit');
  });
});

describe('transport', () => {
  const every: Array<[string, Reply, (c: PurelymailClient) => Promise<unknown>]> = [
    ['/api/v0/getOwnershipCode', ok({ code: 'c' }), (c) => c.getOwnershipCode()],
    ['/api/v0/addDomain', ok({}), (c) => c.addDomain(DOMAIN)],
    ['/api/v0/listDomains', ok({ domains: [] }), (c) => c.listDomains()],
    ['/api/v0/updateDomainSettings', ok({}), (c) => c.recheckDomainDns(DOMAIN)],
    ['/api/v0/createUser', ok({}), (c) => c.createUser({ userName: 'postmaster', domainName: DOMAIN, password: PASSWORD })],
    ['/api/v0/deleteUser', ok({}), (c) => c.deleteUser(purelymailAddress('postmaster', DOMAIN))],
    ['/api/v0/listUser', ok({ users: [] }), (c) => c.listUsers()],
    ['/api/v0/listRoutingRules', ok({ rules: [] }), (c) => c.listRoutingRules()],
    ['/api/v0/createRoutingRule', ok({}), (c) => c.createRoutingRule({ domainName: DOMAIN, matchUser: 'abuse', targetAddresses: [] })],
    ['/api/v0/deleteRoutingRule', ok({}), (c) => c.deleteRoutingRule(7)],
    ['/api/v0/checkAccountCredit', ok({ credit: '0.00' }), (c) => c.checkAccountCredit()]
  ];
  it.each(every)('POSTs JSON to %s with the token only in its header', async (expected, reply, run) => {
    const { client, calls, path } = setup([reply]);
    await run(client);
    const { url, init } = calls[0]!;
    expect([init.method, path(0), url.search, init.redirect]).toEqual(['POST', expected, '', 'error']);
    expect(init.headers).toMatchObject({ 'Purelymail-Api-Token': TOKEN, accept: 'application/json', 'content-type': 'application/json' });
    expect(init.headers['authorization']).toBeUndefined();
    expect(typeof JSON.parse(init.body!)).toBe('object');
    expect(`${url.href}${init.body}`).not.toContain(TOKEN);
  });

  it('sends {} to argument-less operations', async () => {
    const { client, body } = setup([ok({ code: 'c' }), ok({ users: [] }), ok({ rules: [] }), ok({ credit: '1' })]);
    await client.getOwnershipCode();
    await client.listUsers();
    await client.listRoutingRules();
    await client.checkAccountCredit();
    expect([0, 1, 2, 3].map(body)).toEqual(['{}', '{}', '{}', '{}']);
  });

  it('maps every operation label to the provider name under /api/v0', () => {
    expect(Object.keys(PURELYMAIL_OPERATIONS)).toHaveLength(19);
    expect(PURELYMAIL_OPERATIONS['user.list']).toBe('listUser');
    for (const operation of Object.keys(PURELYMAIL_OPERATIONS) as Array<keyof typeof PURELYMAIL_OPERATIONS>) {
      expect(purelymailPath(operation)).toMatch(/^\/api\/v0\/[A-Za-z]+$/);
    }
  });

  it('reports transport failures without the request', async () => {
    const failure = Object.assign(new TypeError(`fetch failed ${TOKEN}`), { cause: { code: 'ENOTFOUND' }, request: { body: PASSWORD } });
    const error = await caught(setup(failure).client.createUser({ userName: 'a', domainName: DOMAIN, password: PASSWORD }));
    expect(error).toMatchObject({ kind: 'unavailable', detail: { networkCode: 'ENOTFOUND' }, retryable: true });
    expect((await caught(setup(Object.assign(new Error('t'), { name: 'TimeoutError' })).client.listUsers())).kind).toBe('timeout');
  });

  it('refuses an oversized answer and is cancelled by a signal', async () => {
    const big = { status: 200, text: JSON.stringify({ type: 'success', result: { users: ['x'.repeat(200)] } }) };
    expect((await caught(setup([big], { maxResponseBytes: 100 }).client.listUsers())).kind).toBe('invalid_response');
    const controller = new AbortController();
    controller.abort();
    expect((await caught(setup([ok({ users: [] })]).client.listUsers({ signal: controller.signal }))).kind).toBe('aborted');
  });
});

describe('the envelope decides, not the status', () => {
  it('treats an error envelope at HTTP 200 as the failure it is', async () => {
    const error = await caught(setup([fail('invalidToken', 'Token not valid.')]).client.checkAccountCredit());
    expect(error).toMatchObject({ kind: 'unauthorized', status: 200, providerCode: 'invalidToken', operation: 'account.credit' });
    expect(error.message).toContain('Token not valid.');
  });

  it('classifies codes, then decisive statuses, then refusals', async () => {
    expect((await caught(setup([fail('somethingElse')]).client.listDomains())).kind).toBe('invalid_request');
    expect((await caught(setup([fail('noSuchUser')]).client.deleteUser(`ghost@${DOMAIN}`))).kind).toBe('not_found');
    expect(await caught(setup([html()]).client.listDomains())).toMatchObject({ kind: 'not_found', status: 404, detail: { notEnvelope: true } });
    expect((await caught(setup([{ status: 500, body: { type: 'success', result: {} } }]).client.addDomain(DOMAIN))).kind).toBe('unavailable');
    const cases: Array<[number, string]> = [[400, 'invalid_request'], [401, 'unauthorized'], [403, 'forbidden'], [422, 'invalid_request'], [500, 'unavailable'], [503, 'unavailable']];
    for (const [status, kind] of cases) expect([status, (await caught(setup([{ status, body: {} }]).client.listUsers())).kind]).toEqual([status, kind as never]);
    expect(purelymailErrorKind(500, readPurelymailEnvelope({ type: 'error', code: 'x' }))).toBe('invalid_request');
  });

  it('rejects a 2xx that is not an envelope, and accepts the documented shape', async () => {
    for (const reply of [{ body: { credit: '5.00' } }, { text: '' }, { text: '<html>' }]) {
      expect(await caught(setup([reply]).client.checkAccountCredit())).toMatchObject({ kind: 'invalid_response', detail: { notEnvelope: true } });
    }
    expect(await setup([{ body: { result: { credit: '5.00' } } }]).client.checkAccountCredit()).toBe('5.00');
    for (const body of [null, 'text', 42, ['a'], { type: 'partial', result: {} }]) expect(readPurelymailEnvelope(body).type).toBeNull();
    expect(readPurelymailEnvelope({ result: null }).type).toBe('success');
  });

  it('keeps retry-after from a provider 429', async () => {
    const error = await caught(setup([{ status: 429, body: {}, headers: { 'retry-after': '42' } }]).client.listUsers());
    expect(error).toMatchObject({ kind: 'rate_limited', retryAfterMs: 42_000 });
  });

  it('strips the token and a minted password from provider text', async () => {
    const echo = fail('weakPassword', `password ${PASSWORD} rejected for ${TOKEN}`);
    const error = await caught(setup([echo]).client.createUser({ userName: 'a', domainName: DOMAIN, password: PASSWORD }));
    expect(error.message).toContain('[redacted]');
  });

  it('refuses locally before the network when the budget is exhausted', async () => {
    const budget = createRateBudget({ capacity: 1, refillPerSecond: 0.01, maxWaitMs: 10 });
    budget.tryAcquire();
    const { client, calls } = setup([], { rateBudget: budget });
    expect(await caught(client.listDomains())).toMatchObject({ kind: 'rate_limited', detail: { source: 'local_rate_budget' } });
    expect(calls).toHaveLength(0);
  });

  it('probes with the credit call', async () => {
    expect(await setup([ok({ credit: '1' })]).client.probe()).toEqual({ authenticated: true });
    expect(await setup([fail('invalidToken')]).client.probe()).toEqual({ authenticated: false });
    expect((await caught(setup([{ status: 503, body: {} }]).client.probe())).kind).toBe('unavailable');
  });
});

describe('domains', () => {
  it('normalizes domains; anything not literally true is false', async () => {
    const { client, body } = setup([ok({ domains: [domain({ symbolicSubaddressing: true, extra: 'dropped' }), { name: 'bare.example.com', dnsSummary: { passesMx: 'yes', passesSpf: 1 } }] })]);
    expect(await client.listDomains()).toEqual([
      { name: DOMAIN, allowAccountReset: false, symbolicSubaddressing: true, isShared: false, dns: { passesMx: true, passesSpf: true, passesDkim: true, passesDmarc: true } },
      { name: 'bare.example.com', allowAccountReset: false, symbolicSubaddressing: false, isShared: false, dns: { passesMx: false, passesSpf: false, passesDkim: false, passesDmarc: false } }
    ]);
    expect(JSON.parse(body(0)!)).toEqual({ includeShared: false });
  });

  it('asks for shared domains only when told to', async () => {
    const { client, body } = setup([ok({ domains: [domain({ name: 'shared.example.net', isShared: true })] })]);
    expect((await client.listDomains({ includeShared: true }))[0]!.isShared).toBe(true);
    expect(JSON.parse(body(0)!)).toEqual({ includeShared: true });
  });

  it('fails the whole list on an unreadable row', async () => {
    expect(await caught(setup([ok({ domains: [{ isShared: false }] })]).client.listDomains())).toMatchObject({ kind: 'invalid_response', detail: { field: 'name' } });
    expect(await caught(setup([ok({ domains: { name: DOMAIN } })]).client.listDomains())).toMatchObject({ kind: 'invalid_response', detail: { field: 'domains' } });
  });

  it('finds a domain by name, never by suffix', async () => {
    expect((await setup([ok({ domains: [domain({ name: 'other.example' }), domain()] })]).client.findDomain('Example.com.'))?.name).toBe(DOMAIN);
    expect(await setup([ok({ domains: [domain({ name: `mail.${DOMAIN}` })] })]).client.findDomain(DOMAIN)).toBeNull();
  });

  it('sends exact bodies for add and recheck', async () => {
    const { client, body } = setup([ok({}), ok({})]);
    await client.addDomain(DOMAIN);
    await client.recheckDomainDns(DOMAIN);
    expect([JSON.parse(body(0)!), JSON.parse(body(1)!)]).toEqual([{ domainName: DOMAIN }, { name: DOMAIN, recheckDns: true }]);
  });

  it('reads the ownership code, and fails without one', async () => {
    expect(await setup([ok({ code: 'opaque-code-value' })]).client.getOwnershipCode()).toBe('opaque-code-value');
    expect(await caught(setup([ok({})]).client.getOwnershipCode())).toMatchObject({ kind: 'invalid_response', detail: { field: 'code' } });
  });
});

describe('users', () => {
  it('creates with a local part, returns nothing, and omits unset flags', async () => {
    const { client, body } = setup([ok({}), ok({})]);
    expect(await client.createUser({ userName: 'postmaster', domainName: DOMAIN, password: PASSWORD })).toBeUndefined();
    expect(JSON.parse(body(0)!)).toEqual({ userName: 'postmaster', domainName: DOMAIN, password: PASSWORD });
    await client.createUser({ userName: 'a', domainName: DOMAIN, password: PASSWORD, enablePasswordReset: false, enableSearchIndexing: false, sendWelcomeEmail: false });
    expect(JSON.parse(body(1)!)).toMatchObject({ enablePasswordReset: false, enableSearchIndexing: false, sendWelcomeEmail: false });
  });

  it('deletes by full address', async () => {
    const { client, body } = setup([ok({})]);
    await client.deleteUser(purelymailAddress('postmaster', DOMAIN));
    expect(JSON.parse(body(0)!)).toEqual({ userName: `postmaster@${DOMAIN}` });
  });

  it('lists addresses, and refuses a list at the ceiling', async () => {
    expect(await setup([ok({ users: [`a@${DOMAIN}`, 42, null] })]).client.listUsers()).toEqual([`a@${DOMAIN}`]);
    expect(await caught(setup([ok({ users: 'a' })]).client.listUsers())).toMatchObject({ detail: { field: 'users' } });
    const full = Array.from({ length: 1000 }, (_, i) => `u${i}@${DOMAIN}`);
    expect(await caught(setup([ok({ users: full })]).client.listUsers())).toMatchObject({ kind: 'invalid_response', detail: { count: 1000 } });
  });
});

describe('routing rules', () => {
  it('normalizes rules and keeps the id numeric', async () => {
    const rules = await setup([ok({ rules: [rule(), rule({ id: 2, catchall: true, matchUser: '', targetAddresses: ['x@example.com', 7] }), { id: 3, domainName: DOMAIN }] })]).client.listRoutingRules();
    expect(rules[0]).toEqual({ id: 4_815_162_342, domainName: DOMAIN, prefix: false, matchUser: 'abuse', targetAddresses: [`ops@${DOMAIN}`], catchall: false });
    expect(rules[1]).toMatchObject({ catchall: true, matchUser: '', targetAddresses: ['x@example.com'] });
    expect(rules[2]).toMatchObject({ matchUser: '', targetAddresses: [] });
  });

  it('refuses a rule without a numeric id', async () => {
    for (const id of ['7', null, undefined]) {
      expect(await caught(setup([ok({ rules: [rule({ id })] })]).client.listRoutingRules())).toMatchObject({ detail: { field: 'id' } });
    }
    expect(await caught(setup([ok({ rules: null })]).client.listRoutingRules())).toMatchObject({ detail: { field: 'rules' } });
  });

  it('always sends prefix and catchall, and copies the targets', async () => {
    const { client, body } = setup([ok({}), ok({})]);
    const targets = [`ops@${DOMAIN}`];
    const sent = client.createRoutingRule({ domainName: DOMAIN, matchUser: 'abuse', targetAddresses: targets });
    targets.push('late@example.com');
    await sent;
    expect(JSON.parse(body(0)!)).toEqual({ domainName: DOMAIN, prefix: false, matchUser: 'abuse', targetAddresses: [`ops@${DOMAIN}`], catchall: false });
    await client.deleteRoutingRule(4_815_162_342);
    expect(JSON.parse(body(1)!)).toEqual({ routingRuleId: 4_815_162_342 });
    expect((await caught(client.deleteRoutingRule(1.5))).kind).toBe('invalid_input');
  });
});

describe('account credit', () => {
  it('returns the string verbatim and refuses a number', async () => {
    for (const credit of ['12.34', '0.00', '-1.50', '1000.000']) expect(await setup([ok({ credit })]).client.checkAccountCredit()).toBe(credit);
    expect(await caught(setup([ok({ credit: 12.34 })]).client.checkAccountCredit())).toMatchObject({ detail: { field: 'credit' } });
  });
});

describe('dns-plan interplay', () => {
  it('plans the required records into an empty zone', async () => {
    const { purelymailDnsRecords } = await import('../src/index.ts');
    expect(planOperations(diffRecords(purelymailDnsRecords({ domain: DOMAIN, ownershipCode: 'code' }), []))).toHaveLength(7);
  });
});
