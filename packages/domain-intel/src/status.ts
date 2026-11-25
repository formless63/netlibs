/** EPP statuses whose RDAP wording is not just the split camelCase (RFC 8056). */
const IRREGULAR: Record<string, string> = { ok: 'active', linked: 'associated' };

/**
 * A domain status in RDAP wording: `clientTransferProhibited` becomes
 * `client transfer prohibited`, `ok` becomes `active` (RFC 8056). RDAP values,
 * underscored and hyphenated spellings normalize to the same text.
 */
export function normalizeStatus(status: string): string {
  const words = status
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
  return IRREGULAR[words] ?? words;
}

/** Normalized, de-duplicated and sorted statuses. */
export function normalizeStatuses(statuses: readonly string[]): string[] {
  return [...new Set(statuses.map(normalizeStatus).filter((status) => status !== ''))].toSorted();
}

/** Statuses that mean the registration is in trouble or in motion. */
export type StatusSignal =
  | 'client_hold'
  | 'server_hold'
  | 'redemption_period'
  | 'pending_delete'
  | 'pending_transfer';

const SIGNALS: ReadonlyArray<readonly [status: string, signal: StatusSignal]> = [
  ['client hold', 'client_hold'],
  ['server hold', 'server_hold'],
  ['redemption period', 'redemption_period'],
  ['pending restore', 'redemption_period'],
  ['pending delete', 'pending_delete'],
  ['pending transfer', 'pending_transfer']
];

/** The signals a status list carries, in a fixed order. */
export function statusSignals(statuses: readonly string[]): StatusSignal[] {
  const present = new Set(statuses.map(normalizeStatus));
  const out: StatusSignal[] = [];
  for (const [status, signal] of SIGNALS) {
    if (present.has(status) && !out.includes(signal)) out.push(signal);
  }
  return out;
}

/** Whether transfers are locked; null when no statuses are known. */
export function isTransferLocked(statuses: readonly string[]): boolean | null {
  if (statuses.length === 0) return null;
  return statuses
    .map(normalizeStatus)
    .some((status) => status === 'client transfer prohibited' || status === 'server transfer prohibited');
}
