import type { Registrar, RegistrarDomain } from './index.ts';

const NAME = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT = /^\d{1,12}(?:\.\d{1,4})?$/;

/** Problems with one record's shape; empty when it honours the contract. */
export function checkRegistrarDomain(domain: RegistrarDomain): string[] {
  const problems: string[] = [];
  const expect = (ok: boolean, message: string): void => {
    if (!ok) problems.push(`${domain.name || '(unnamed)'}: ${message}`);
  };
  const sortedUnique = (values: string[]): boolean =>
    values.every((value, index) => index === 0 || values[index - 1]! < value);
  expect(NAME.test(domain.name), 'name is not a normalized domain name');
  for (const field of ['registeredOn', 'expiresOn'] as const) {
    expect(domain[field] === null || DATE.test(domain[field]), `${field} is not an ISO date`);
  }
  for (const field of ['nameservers', 'status'] as const) {
    expect(sortedUnique(domain[field]), `${field} is not sorted and unique`);
    expect(
      domain[field].every((value) => value !== '' && value === value.trim().toLowerCase()),
      `${field} has unnormalized values`
    );
  }
  expect(
    domain.nameservers.every((host) => !host.endsWith('.')),
    'a nameserver has a trailing dot'
  );
  expect(
    domain.status.every((status) => !/[A-Z_]/.test(status) && status !== 'ok'),
    'status is not in RDAP wording'
  );
  if (domain.renewalPrice) {
    expect(AMOUNT.test(domain.renewalPrice.amount), 'renewalPrice.amount is not a decimal string');
    expect(/^[A-Z]{3}$/.test(domain.renewalPrice.currency), 'renewalPrice.currency is not ISO 4217');
  }
  return problems;
}

/**
 * Exercises an adapter against the contract and throws one Error listing every
 * problem. Works in any test runner; point it at a stubbed adapter.
 */
export async function assertRegistrarConformance(
  registrar: Registrar,
  { knownDomain }: { knownDomain: string }
): Promise<void> {
  const problems: string[] = [];
  if (!/^[a-z][a-z0-9-]*$/.test(registrar.id)) problems.push('id is not a machine id');
  if (registrar.label.trim() === '') problems.push('label is empty');

  const listed = await registrar.listDomains();
  const names = listed.map((domain) => domain.name);
  if (new Set(names).size !== names.length) problems.push('listDomains returned duplicates');
  for (const domain of [...listed, await registrar.getDomain(knownDomain)]) {
    problems.push(...checkRegistrarDomain(domain));
    if (!registrar.capabilities.renewalPrice && domain.renewalPrice !== null) {
      problems.push(`${domain.name}: renewalPrice reported without the capability`);
    }
    if (!registrar.capabilities.status && domain.status.length > 0) {
      problems.push(`${domain.name}: status reported without the capability`);
    }
  }
  if (!names.includes(knownDomain)) problems.push('listDomains did not include knownDomain');

  for (const bad of ['', 'not a domain', '../x']) {
    const kind = await registrar.getDomain(bad).then(
      () => 'resolved',
      (error: unknown) => (error as { kind?: unknown } | null)?.kind
    );
    if (kind !== 'invalid_input') problems.push(`getDomain(${JSON.stringify(bad)}) gave ${String(kind)}`);
  }
  if (problems.length > 0) throw new Error(`Registrar contract violated:\n- ${problems.join('\n- ')}`);
}
