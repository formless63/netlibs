/**
 * Replacing records: in place where certain, a type change as one group, and
 * never removing a record that stays to make room.
 */
import { describe, expect, it } from 'bun:test';
import {
  assertNoUnexpectedDeletes,
  DnsApplyError,
  diffRecords,
  normalizeContent,
  planChanges,
  planOperations,
  recordsConflict
} from '../src/index.ts';
import type { DesiredRecord, ObservedRecord } from '../src/index.ts';

const desired = (overrides: Partial<DesiredRecord> & { type: string; content: string }): DesiredRecord => ({
  name: 'www',
  ttlSeconds: null,
  priority: null,
  proxied: false,
  ...overrides
});
const observed = (overrides: Partial<ObservedRecord> & { recordId: string; type: string; content: string }): ObservedRecord => ({
  name: 'www',
  ttlSeconds: null,
  priority: null,
  proxied: false,
  proxiable: true,
  ...overrides
});

/** `kind [recordId] type content` per operation, in order. */
function plan(want: DesiredRecord[], removing: ObservedRecord[], present: ObservedRecord[] = [], keep: ObservedRecord[] = []): string[] {
  const diff = diffRecords(want, present, { pending: [...removing, ...keep] });
  const operations = planOperations(diff, { remove: removing });
  expect(() => assertNoUnexpectedDeletes(diff, operations, { remove: removing })).not.toThrow();
  return operations.map(
    (operation) =>
      `${operation.kind}${operation.kind === 'create' ? '' : ` ${operation.recordId}`} ${operation.record.type} ${operation.record.content}`
  );
}

const cname = (content: string, name = 'www') => desired({ type: 'CNAME', name, content });
const address = (content: string) => desired({ type: content.includes(':') ? 'AAAA' : 'A', content });
const old = (recordId: string, type: string, content: string, name = 'www') => observed({ recordId, type, content, name });

describe('replacing in place', () => {
  it('changes a CNAME target, a lone address and one TXT policy in one update', () => {
    expect(plan([cname('new.example')], [old('r1', 'CNAME', 'old.example')])).toEqual(['update r1 CNAME new.example']);
    expect(plan([address('203.0.113.11')], [old('r1', 'A', '203.0.113.10')])).toEqual(['update r1 A 203.0.113.11']);
    expect(
      plan([desired({ type: 'TXT', name: '@', content: 'v=spf1 include:new.example -all' })], [old('r1', 'TXT', '"v=spf1 -all"', '@')])
    ).toEqual(['update r1 TXT v=spf1 include:new.example -all']);
  });

  it.each(['MX', 'TXT', 'NS', 'CAA'])('creates a new %s value before deleting the old one', (type) => {
    expect(plan([desired({ type, name: '@', content: 'new-value' })], [old('r1', type, 'old-value', '@')])).toEqual([
      `create ${type} new-value`,
      `delete r1 ${type} old-value`
    ]);
  });

  it('creates a set of addresses before deleting the old set', () => {
    expect(
      plan([address('203.0.113.20'), address('203.0.113.21')], [old('o1', 'A', '203.0.113.10'), old('o2', 'A', '203.0.113.11')])
    ).toEqual(['create A 203.0.113.20', 'create A 203.0.113.21', 'delete o1 A 203.0.113.10', 'delete o2 A 203.0.113.11']);
  });

  it('carries what each operation does', () => {
    const want = cname('new.example');
    const gone = old('r1', 'CNAME', 'old.example');
    const [change] = planChanges(diffRecords([want], [gone], { pending: [gone] }), { remove: [gone] });
    expect(change?.desired).toBe(want);
    expect(change?.removed).toBe(gone);
  });
});

describe('changing a type', () => {
  it('deletes every old address before the CNAME that replaces them, as one group', () => {
    const diff = diffRecords([cname('new.example')], [], {
      pending: [old('a1', 'A', '203.0.113.10'), old('a2', 'A', '203.0.113.11'), old('a3', 'AAAA', '2001:db8::1')]
    });
    expect(planOperations(diff, { remove: diff.pending ?? [] }).map((op) => `${op.kind} ${op.record.type} ${op.group ?? '-'}`)).toEqual([
      'delete A replace www',
      'delete A replace www',
      'delete AAAA replace www',
      'create CNAME replace www'
    ]);
  });

  it('deletes an old CNAME once before all the addresses that replace it', () => {
    expect(plan([address('203.0.113.10'), address('2001:db8::1')], [old('c', 'CNAME', 'old.example')])).toEqual([
      'delete c CNAME old.example',
      'create A 203.0.113.10',
      'create AAAA 2001:db8::1'
    ]);
  });

  it('replaces a TXT key by a CNAME', () => {
    expect(plan([cname('key.mail.example', 'k1._domainkey')], [old('t', 'TXT', 'v=DKIM1; p=a', 'k1._domainkey')])).toEqual([
      'delete t TXT v=DKIM1; p=a',
      'create CNAME key.mail.example'
    ]);
  });

  it('does not let a swap at one name delay a set at another', () => {
    expect(
      plan(
        [desired({ type: 'MX', name: '@', content: 'new.mail.example' }), cname('new.example')],
        [old('omx', 'MX', 'old.mail.example', '@'), old('a', 'A', '203.0.113.10')]
      )
    ).toEqual(['delete a A 203.0.113.10', 'create CNAME new.example', 'create MX new.mail.example', 'delete omx MX old.mail.example']);
  });
});

describe('a record that stays is never removed to make room', () => {
  const removal = old('a', 'A', '203.0.113.10');

  it('keeps the old record and lets the create fail last, for an unexpected one', () => {
    expect(
      plan([cname('new.example'), desired({ type: 'A', name: '@', content: '203.0.113.10' })], [removal], [old('theirs', 'A', '203.0.113.99')])
    ).toEqual(['create A 203.0.113.10', 'create CNAME new.example']);
  });

  it('does the same for an unmanaged record, and a pending one not removed', () => {
    expect(
      plan([cname('new.example'), { ...address('203.0.113.99'), managed: false }], [removal], [old('m', 'A', '203.0.113.99')])
    ).toEqual(['create CNAME new.example']);
    expect(plan([cname('new.example')], [removal], [], [old('kept', 'A', '203.0.113.99')])).toEqual(['create CNAME new.example']);
  });

  it('never replaces a pending record the caller keeps', () => {
    expect(plan([cname('new.example')], [], [], [old('kept', 'CNAME', 'old.example')])).toEqual(['create CNAME new.example']);
  });

  it('never writes over a stranger instead of the record it replaces', () => {
    expect(plan([address('203.0.113.11')], [removal], [old('theirs', 'A', '203.0.113.99')])).toEqual(['update a A 203.0.113.11']);
    expect(
      plan(
        [desired({ type: 'TXT', name: '@', content: 'v=spf1 -all' })],
        [old('ours', 'TXT', 'v=spf1 ~all', '@')],
        [old('theirs', 'TXT', 'v=spf1 include:theirs.example -all', '@')]
      )
    ).toEqual(['update ours TXT v=spf1 -all']);
  });

  it('leaves pending records out of the diff whether or not they are observed too', () => {
    const gone = old('r1', 'CNAME', 'old.example');
    const diff = diffRecords([cname('new.example')], [gone], { pending: [gone] });
    expect(diff.missing).toHaveLength(1);
    expect(diff.unexpected).toEqual([]);
    expect(diff.pending).toEqual([gone]);
  });
});

describe('recordsConflict', () => {
  it('allows types beside a CNAME only at the apex, where it is flattened', () => {
    expect(recordsConflict({ type: 'CNAME', name: '@' }, { type: 'MX', name: '@' })).toBe(false);
    expect(recordsConflict({ type: 'CNAME', name: '@' }, { type: 'A', name: '@' })).toBe(true);
    expect(recordsConflict({ type: 'MX', name: 'www' }, { type: 'CNAME', name: 'WWW' })).toBe(true);
    expect(recordsConflict({ type: 'A', name: 'www' }, { type: 'AAAA', name: 'www' })).toBe(false);
    expect(recordsConflict({ type: 'NS', name: 'sub' }, { type: 'A', name: 'sub' })).toBe(true);
    expect(recordsConflict({ type: 'NS', name: '@' }, { type: 'A', name: '@' })).toBe(false);
    expect(recordsConflict({ type: 'CNAME', name: 'a' }, { type: 'CNAME', name: 'b' })).toBe(false);
  });
});

describe('guards and helpers', () => {
  it('refuses a hand-assembled update of an unexpected record', () => {
    const diff = diffRecords([], [old('r1', 'A', '203.0.113.10')]);
    const record = { type: 'A', name: 'www', content: '203.0.113.11', ttlSeconds: null, priority: null, proxied: false };
    expect(() => assertNoUnexpectedDeletes(diff, [{ kind: 'update', recordId: 'r1', record }])).toThrow(/refusing to rewrite/);
  });

  it.each([
    ['TXT', '"v=DKIM1; p=abc""def"', 'v=DKIM1; p=abcdef'],
    ['TXT', '"say \\"hi\\""', 'say "hi"'],
    ['SRV', '10 5060 SIP.Example.NET.', '10 5060 sip.example.net'],
    ['MX', 'MAIL.example.net.', 'mail.example.net']
  ])('normalizes %s %s', (type, input, output) => {
    expect(normalizeContent(type, input)).toBe(output);
  });

  it('keeps the TXT case', () => {
    expect(normalizeContent('TXT', '"token=ABC"')).toBe('token=ABC');
  });

  it("exposes the cause's kind on a failed apply", () => {
    const failed = { kind: 'delete', recordId: 'r1', record: { type: 'A', name: 'www', content: '203.0.113.10' } } as const;
    const error = new DnsApplyError([], failed, { kind: 'rate_limited', retryable: true });
    expect(error.kind).toBe('rate_limited');
    expect(error.retryable).toBe(true);
    expect(new DnsApplyError([], failed, new Error('x')).kind).toBeNull();
  });
});
