import { describe, expect, it } from 'bun:test';

import {
  PURELYMAIL_DKIM_SELECTORS,
  PURELYMAIL_DMARC_CONTENT,
  PURELYMAIL_DMARC_NAME,
  PURELYMAIL_MX_HOST,
  PURELYMAIL_MX_PRIORITY,
  PURELYMAIL_RECORD_COUNT,
  PURELYMAIL_SPF_CONTENT,
  purelymailDnsRecords
} from '../src/index.ts';

const CODE = 'Opaque-Ownership-Code-0000 ';
const base = { ttlSeconds: null, proxied: false };
// Typed out from the provider's page rather than derived from the constants.
const SEVEN = [
  { type: 'MX', name: '@', content: 'mailserver.purelymail.com', priority: 50, purpose: 'mx', ...base },
  { type: 'TXT', name: '@', content: 'v=spf1 include:_spf.purelymail.com ~all', priority: null, purpose: 'spf', ...base },
  { type: 'CNAME', name: 'purelymail1._domainkey', content: 'key1.dkimroot.purelymail.com', priority: null, purpose: 'dkim', ...base },
  { type: 'CNAME', name: 'purelymail2._domainkey', content: 'key2.dkimroot.purelymail.com', priority: null, purpose: 'dkim', ...base },
  { type: 'CNAME', name: 'purelymail3._domainkey', content: 'key3.dkimroot.purelymail.com', priority: null, purpose: 'dkim', ...base },
  { type: 'CNAME', name: '_dmarc', content: 'dmarcroot.purelymail.com', priority: null, purpose: 'dmarc', ...base },
  { type: 'TXT', name: '@', content: CODE, priority: null, purpose: 'ownership', ...base }
];

describe('purelymailDnsRecords', () => {
  it('emits the seven documented records, ownership last and verbatim', () => {
    expect(purelymailDnsRecords({ domain: 'example.com', ownershipCode: CODE })).toEqual(SEVEN as never);
    expect(PURELYMAIL_RECORD_COUNT).toBe(7);
  });

  it('emits six while the ownership code is unknown', () => {
    for (const ownershipCode of [null, '', undefined]) {
      expect(purelymailDnsRecords({ domain: 'example.com', ...(ownershipCode === undefined ? {} : { ownershipCode }) })).toEqual(SEVEN.slice(0, 6) as never);
    }
  });

  it('names records relative to the zone, for an apex or a subdomain', () => {
    expect(purelymailDnsRecords({ domain: 'Example.COM.' }).map((r) => r.name)).toEqual(['@', '@', 'purelymail1._domainkey', 'purelymail2._domainkey', 'purelymail3._domainkey', '_dmarc']);
    expect(purelymailDnsRecords({ domain: 'mail.example.com', zone: 'example.com', ownershipCode: 'c' }).map((r) => r.name)).toEqual([
      'mail', 'mail', 'purelymail1._domainkey.mail', 'purelymail2._domainkey.mail', 'purelymail3._domainkey.mail', '_dmarc.mail', 'mail'
    ]);
    expect(() => purelymailDnsRecords({ domain: 'example.org', zone: 'example.com' })).toThrow(RangeError);
    expect(() => purelymailDnsRecords({ domain: 'badexample.com', zone: 'example.com' })).toThrow(RangeError);
  });

  it('publishes DMARC as a CNAME and three DKIM keys', () => {
    const records = purelymailDnsRecords({ domain: 'example.com' });
    expect(records.filter((r) => r.purpose === 'dmarc').map((r) => r.type)).toEqual(['CNAME']);
    expect(records.filter((r) => r.purpose === 'dkim')).toHaveLength(3);
    expect(records.every((r) => !r.proxied && r.ttlSeconds === null)).toBe(true);
  });

  it('agrees with the exported constants', () => {
    expect([PURELYMAIL_MX_HOST, PURELYMAIL_MX_PRIORITY, PURELYMAIL_SPF_CONTENT, PURELYMAIL_DMARC_NAME, PURELYMAIL_DMARC_CONTENT]).toEqual([
      'mailserver.purelymail.com', 50, 'v=spf1 include:_spf.purelymail.com ~all', '_dmarc', 'dmarcroot.purelymail.com'
    ]);
    expect(PURELYMAIL_DKIM_SELECTORS.map((s) => s.content)).toEqual(['key1.dkimroot.purelymail.com', 'key2.dkimroot.purelymail.com', 'key3.dkimroot.purelymail.com']);
    expect(Object.isFrozen(PURELYMAIL_DKIM_SELECTORS[0])).toBe(true);
  });

  it('returns fresh objects every call', () => {
    const first = purelymailDnsRecords({ domain: 'example.com' });
    first[0]!.content = 'mutated.example.com';
    first.push(first[0]!);
    const second = purelymailDnsRecords({ domain: 'example.com' });
    expect([second.length, second[0]!.content]).toEqual([6, 'mailserver.purelymail.com']);
  });
});
