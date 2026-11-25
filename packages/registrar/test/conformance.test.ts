import { describe, expect, it } from 'bun:test';

import type { Registrar, RegistrarDomain } from '../src/index.ts';
import { assertRegistrarConformance, checkRegistrarDomain } from '../src/testing.ts';

const domain: RegistrarDomain = {
  name: 'example.com',
  registeredOn: '2020-01-01',
  expiresOn: null,
  autoRenew: null,
  privacy: null,
  transferLock: null,
  nameservers: ['ns1.example.net', 'ns2.example.net'],
  status: ['active'],
  renewalPrice: { amount: '10.98', currency: 'USD' },
  usesRegistrarDns: null,
  expired: null,
  lifecycle: null,
  premium: null
};
const fake = (over: Partial<Registrar> = {}): Registrar => ({
  id: 'fake',
  label: 'Fake',
  capabilities: { renewalPrice: true, status: true, nameservers: true },
  listDomains: async () => [domain],
  getDomain: async (name) => {
    if (name !== 'example.com') throw Object.assign(new Error('bad'), { kind: 'invalid_input' });
    return domain;
  },
  probe: async () => ({ domains: 1 }),
  ...over
});

describe('conformance kit', () => {
  it('passes a correct adapter', async () => {
    await assertRegistrarConformance(fake(), { knownDomain: 'example.com' });
  });
  it('reports every shape problem', () => {
    expect(checkRegistrarDomain({ ...domain, name: 'EXAMPLE.com.', expiresOn: '1/2/2026', nameservers: ['b.', 'a'], status: ['ok'], renewalPrice: { amount: '1e3', currency: 'usd' } })).toHaveLength(7);
  });
  it('catches duplicates, undeclared capabilities and unvalidated input', async () => {
    const bad = fake({
      capabilities: { renewalPrice: false, status: false, nameservers: true },
      listDomains: async () => [domain, domain],
      getDomain: async () => domain
    });
    const error = await assertRegistrarConformance(bad, { knownDomain: 'example.com' }).catch((e: Error) => e.message);
    for (const text of ['duplicates', 'renewalPrice reported', 'status reported', 'getDomain("../x") gave resolved']) expect(error).toContain(text);
  });
});
