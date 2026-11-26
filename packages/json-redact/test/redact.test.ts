import { describe, expect, it } from 'bun:test';

import { CIRCULAR, isSensitiveKey, normalizeKey, REDACTED, redactJson, SENSITIVE_KEYS } from '../src/index.ts';

describe('isSensitiveKey', () => {
  it('matches secret-shaped names in any casing or separator style', () => {
    for (const key of ['password', 'apiToken', 'api_key', 'clientSecret', 'PRIVATE-KEY', 'sshPassphrase', 'credentials', 'authorization', 'Cookie', 'x-auth-token', 'dbPassword2']) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    for (const key of SENSITIVE_KEYS) expect(isSensitiveKey(key.toUpperCase()), key).toBe(true);
  });

  it('leaves ordinary names alone', () => {
    for (const key of ['domain', 'connectionId', 'targetId', 'tokenCount', 'keyId', 'payload', 'author', 'secretary']) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it('takes extra names and a predicate', () => {
    expect(isSensitiveKey('payload', { extraKeys: ['PAYLOAD'] })).toBe(true);
    expect(isSensitiveKey('signature', { isSensitive: (key) => key === 'signature' })).toBe(true);
    expect(normalizeKey('Secret_Access-Key')).toBe('secretaccesskey');
  });
});

describe('redactJson', () => {
  it('replaces sensitive values of any shape, recursively', () => {
    const input = {
      domain: 'example.com',
      apiToken: 'synthetic-value-1',
      nested: { list: [{ password: { deep: true } }, 'plain', 3], client_secret: ['a'] },
      tokenCount: 4
    };
    expect(redactJson(input)).toEqual({
      domain: 'example.com',
      apiToken: REDACTED,
      nested: { list: [{ password: REDACTED }, 'plain', 3], client_secret: REDACTED },
      tokenCount: 4
    });
    expect(input.apiToken).toBe('synthetic-value-1');
  });

  it('passes non-objects through', () => {
    for (const value of [null, undefined, 1, 'text', true]) expect(redactJson(value)).toBe(value);
  });

  it('redacts extra keys only when asked', () => {
    expect(redactJson({ payload: 'x' })).toEqual({ payload: 'x' });
    expect(redactJson({ payload: 'x' }, { extraKeys: ['payload'] })).toEqual({ payload: REDACTED });
    expect(redactJson({ token: 'x' }, { replacement: null })).toEqual({ token: null });
  });

  it('converts toJSON values as JSON.stringify would', () => {
    const at = new Date('2026-01-02T03:04:05.000Z');
    expect(redactJson({ at, wrapped: { toJSON: () => ({ secret: 'x', ok: 1 }) } })).toEqual({
      at: '2026-01-02T03:04:05.000Z',
      wrapped: { secret: REDACTED, ok: 1 }
    });
  });

  it('survives cycles and copies shared references', () => {
    const shared = { name: 'shared' };
    const node: Record<string, unknown> = { a: shared, b: shared };
    node['self'] = node;
    expect(redactJson(node)).toEqual({ a: { name: 'shared' }, b: { name: 'shared' }, self: CIRCULAR });
  });

  it('keeps a parsed __proto__ key as data', () => {
    const out = redactJson(JSON.parse('{"__proto__": {"polluted": true}, "secret": "x"}')) as Record<string, unknown>;
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(Object.keys(out)).toEqual(['__proto__', 'secret']);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});
