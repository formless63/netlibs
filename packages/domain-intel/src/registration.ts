import { dnsProviderMoved } from './dns-provider.ts';
import { normalizeHostname } from './names.ts';
import { normalizeStatus, statusSignals, type StatusSignal } from './status.ts';
import { dayNumber } from './expiry.ts';

/** What is publicly knowable about a registration. `@formless63/rdap` results satisfy this. */
export interface RegistrationFacts {
  registrar: string | null;
  /** ISO calendar date. */
  expiresOn: string | null;
  status: readonly string[];
  nameservers: readonly string[];
}

export type RegistrationField = 'expiresOn' | 'registrar' | 'nameservers' | 'status';
export type ChangeSignal = StatusSignal | 'registrar_changed' | 'dns_moved';

export interface RegistrationChange {
  field: RegistrationField;
  before: string | string[] | null;
  after: string | string[] | null;
  /** Why the change deserves attention; empty when routine. */
  signals: ChangeSignal[];
}

export const CHANGE_SIGNAL_LABELS: Record<ChangeSignal, string> = {
  client_hold: 'Client hold (the domain does not resolve)',
  server_hold: 'Server hold (the registry stopped resolving it)',
  redemption_period: 'Redemption period (expired; restore fee applies)',
  pending_delete: 'Pending delete (about to be released)',
  pending_transfer: 'Transfer pending',
  registrar_changed: 'Registrar changed (transferred)',
  dns_moved: 'Nameservers moved to another DNS provider'
};

export const REGISTRATION_FIELD_LABELS: Record<RegistrationField, string> = {
  expiresOn: 'Expiry',
  registrar: 'Registrar',
  nameservers: 'Nameservers',
  status: 'Status'
};

function sameSet(a: readonly string[], b: readonly string[], normalize: (v: string) => string): boolean {
  const x = [...new Set(a.map(normalize))].toSorted();
  const y = [...new Set(b.map(normalize))].toSorted();
  return x.length === y.length && x.every((value, index) => value === y[index]);
}

/**
 * What changed between two observations. A first observation (`previous` null)
 * is not a change, and a blank expiry or registrar is treated as "not stated".
 */
export function compareRegistrations(
  previous: RegistrationFacts | null,
  next: RegistrationFacts
): RegistrationChange[] {
  if (previous === null) return [];
  const changes: RegistrationChange[] = [];
  if (next.expiresOn !== null && previous.expiresOn !== next.expiresOn) {
    changes.push({ field: 'expiresOn', before: previous.expiresOn, after: next.expiresOn, signals: [] });
  }
  if (
    next.registrar !== null &&
    (previous.registrar ?? '').toLowerCase() !== next.registrar.toLowerCase()
  ) {
    changes.push({
      field: 'registrar',
      before: previous.registrar,
      after: next.registrar,
      signals: previous.registrar === null ? [] : ['registrar_changed']
    });
  }
  if (!sameSet(previous.nameservers, next.nameservers, normalizeHostname)) {
    changes.push({
      field: 'nameservers',
      before: [...previous.nameservers],
      after: [...next.nameservers],
      signals: dnsProviderMoved(previous.nameservers, next.nameservers) ? ['dns_moved'] : []
    });
  }
  if (!sameSet(previous.status, next.status, normalizeStatus)) {
    const had = new Set(statusSignals(previous.status));
    changes.push({
      field: 'status',
      before: [...previous.status],
      after: [...next.status],
      signals: statusSignals(next.status).filter((signal) => !had.has(signal))
    });
  }
  return changes;
}

/** One line of English, e.g. `Expiry 2026-12-09 → 2027-12-09 (renewed)`. */
export function describeChange(change: RegistrationChange): string {
  const show = (value: string | string[] | null): string =>
    (Array.isArray(value) ? value.join(', ') : value) || 'none';
  let suffix = '';
  if (
    change.field === 'expiresOn' &&
    typeof change.before === 'string' &&
    typeof change.after === 'string'
  ) {
    suffix = change.after > change.before ? ' (renewed)' : ' (moved earlier)';
  }
  const flags = change.signals.map((signal) => CHANGE_SIGNAL_LABELS[signal]).join('; ');
  return `${REGISTRATION_FIELD_LABELS[change.field]} ${show(change.before)} → ${show(change.after)}${suffix}${flags ? ` — ${flags}` : ''}`;
}

export interface SourceMismatch {
  field: 'expiresOn' | 'nameservers' | 'registrar';
  account: string | string[] | null;
  public: string | string[] | null;
}

/**
 * Where a registrar account and public data (RDAP) disagree. Expiries one day
 * apart are time-zone noise; a registrar name matches as a substring, ignoring
 * case and punctuation ("Spaceship" in "Spaceship, Inc.").
 */
export function compareSources(
  account: Pick<RegistrationFacts, 'expiresOn' | 'nameservers'> & { registrar: string },
  publicFacts: Pick<RegistrationFacts, 'expiresOn' | 'nameservers' | 'registrar'>
): SourceMismatch[] {
  const out: SourceMismatch[] = [];
  const a = account.expiresOn === null ? null : dayNumber(account.expiresOn);
  const b = publicFacts.expiresOn === null ? null : dayNumber(publicFacts.expiresOn);
  if (a !== null && b !== null && Math.abs(a - b) > 1) {
    out.push({ field: 'expiresOn', account: account.expiresOn, public: publicFacts.expiresOn });
  }
  if (
    account.nameservers.length > 0 &&
    publicFacts.nameservers.length > 0 &&
    !sameSet(account.nameservers, publicFacts.nameservers, normalizeHostname)
  ) {
    out.push({
      field: 'nameservers',
      account: [...account.nameservers],
      public: [...publicFacts.nameservers]
    });
  }
  const key = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (publicFacts.registrar !== null && !key(publicFacts.registrar).includes(key(account.registrar))) {
    out.push({ field: 'registrar', account: account.registrar, public: publicFacts.registrar });
  }
  return out;
}
