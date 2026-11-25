import { normalizeContent, type DnsOperation, type DnsRecord, type ObservedRecord } from './records.ts';

/** A record that should exist. */
export interface DesiredRecord extends DnsRecord {
  /** `false` means compare it but never write it (a hand-maintained record). Default true. */
  managed?: boolean;
  /** The provider id last seen for this record, when known. Pairs it exactly. */
  recordId?: string | null;
}

export type RecordAttribute = 'content' | 'proxied' | 'ttlSeconds' | 'priority';

export interface MissingRecord<D extends DesiredRecord = DesiredRecord> {
  kind: 'missing';
  desired: D;
}
export interface ModifiedRecord<D extends DesiredRecord = DesiredRecord> {
  kind: 'modified';
  desired: D;
  observed: ObservedRecord;
  changed: RecordAttribute[];
}
export interface UnexpectedRecord {
  kind: 'unexpected';
  observed: ObservedRecord;
}
export interface UnchangedRecord<D extends DesiredRecord = DesiredRecord> {
  kind: 'unchanged';
  desired: D;
  observed: ObservedRecord;
}

export interface DnsDiff<D extends DesiredRecord = DesiredRecord> {
  missing: MissingRecord<D>[];
  modified: ModifiedRecord<D>[];
  /** At the provider but not described. Never deleted or rewritten by a plan. */
  unexpected: UnexpectedRecord[];
  unchanged: UnchangedRecord<D>[];
}

export interface DiffOptions {
  /**
   * How a desired record with new content finds the record it replaces.
   *
   * `safe` (default) pairs only where the match is certain: the same recordId,
   * single-valued types, one address each side, or the same TXT version tag
   * (`v=spf1`, `v=DMARC1`). Otherwise it adds a record and reports the other as
   * unexpected, so somebody else's record is never overwritten.
   *
   * `positional` pairs leftovers of a (type, name) in order. Use it only when
   * the desired set is known to be complete for every name it mentions.
   */
  pairing?: 'safe' | 'positional';
  normalize?: (type: string, content: string) => string;
}

const SINGLE_VALUED = new Set(['CNAME', 'SOA', 'ALIAS', 'ANAME', 'DNAME']);
const ADDRESS = new Set(['A', 'AAAA']);

const keyOf = (record: DnsRecord): string =>
  `${record.type.toUpperCase()} ${record.name.trim().toLowerCase().replace(/\.$/, '')}`;

function txtTag(content: string): string | null {
  return /^(v=[A-Za-z0-9]+)/.exec(content)?.[1]?.toLowerCase() ?? null;
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(key(item));
    if (group) group.push(item);
    else groups.set(key(item), [item]);
  }
  return groups;
}

/** Compares desired records with observed ones. Pure: no network, no clock. */
export function diffRecords<D extends DesiredRecord>(
  desired: readonly D[],
  observed: readonly ObservedRecord[],
  options: DiffOptions = {}
): DnsDiff<D> {
  const normalize = options.normalize ?? normalizeContent;
  const pairing = options.pairing ?? 'safe';
  const diff: DnsDiff<D> = { missing: [], modified: [], unexpected: [], unchanged: [] };

  const pair = (want: D, have: ObservedRecord): void => {
    const changed: RecordAttribute[] = [];
    if (normalize(want.type, want.content) !== normalize(have.type, have.content)) changed.push('content');
    if (want.proxied !== have.proxied) changed.push('proxied');
    if (want.ttlSeconds !== have.ttlSeconds) changed.push('ttlSeconds');
    if ((want.priority ?? null) !== (have.priority ?? null)) changed.push('priority');
    if (changed.length === 0) diff.unchanged.push({ kind: 'unchanged', desired: want, observed: have });
    else diff.modified.push({ kind: 'modified', desired: want, observed: have, changed });
  };

  const observedGroups = groupBy(observed, keyOf);
  for (const [key, wants] of groupBy(desired, keyOf)) {
    const pool = [...(observedGroups.get(key) ?? [])];
    observedGroups.delete(key);
    let open = [...wants];

    const match = (find: (want: D) => number): void => {
      open = open.filter((want) => {
        const index = find(want);
        if (index < 0) return true;
        pair(want, pool.splice(index, 1)[0]!);
        return false;
      });
    };
    // Equal content (and priority, for repeated targets) first, so an unchanged
    // member of a multi-valued set never reads as drift.
    const sameContent = (want: D, have: ObservedRecord): boolean =>
      normalize(want.type, want.content) === normalize(have.type, have.content);
    match((want) =>
      pool.findIndex((have) => sameContent(want, have) && (want.priority ?? null) === (have.priority ?? null))
    );
    match((want) => pool.findIndex((have) => sameContent(want, have)));
    match((want) => (want.recordId ? pool.findIndex((have) => have.recordId === want.recordId) : -1));

    const type = key.split(' ')[0]!;
    const managed = (want: D): boolean => want.managed !== false;
    if (pairing === 'positional') {
      match(() => (pool.length > 0 ? 0 : -1));
    } else if (SINGLE_VALUED.has(type)) {
      match((want) => (managed(want) && pool.length > 0 ? 0 : -1));
    } else if (ADDRESS.has(type) && wants.length === 1 && open.length === 1 && pool.length === 1) {
      match((want) => (managed(want) ? 0 : -1));
    } else if (type === 'TXT') {
      match((want) => {
        const tag = txtTag(normalize(want.type, want.content));
        if (tag === null || !managed(want)) return -1;
        return pool.findIndex((have) => txtTag(normalize(have.type, have.content)) === tag);
      });
    }

    // Unmanaged records are never written, so claiming any leftover is harmless
    // and reports a hand edit as a change rather than as two findings.
    match((want) => (!managed(want) && pool.length > 0 ? 0 : -1));

    for (const want of open) diff.missing.push({ kind: 'missing', desired: want });
    for (const have of pool) diff.unexpected.push({ kind: 'unexpected', observed: have });
  }
  for (const group of observedGroups.values()) {
    for (const have of group) diff.unexpected.push({ kind: 'unexpected', observed: have });
  }
  return diff;
}

export interface PlanOptions {
  /** Records to remove, each as it was observed. The only source of deletes. */
  remove?: readonly ObservedRecord[];
}

const payload = (record: DnsRecord): DnsRecord => ({
  type: record.type,
  name: record.name,
  content: record.content,
  ttlSeconds: record.ttlSeconds,
  priority: record.priority,
  proxied: record.proxied
});

/**
 * The operations a diff implies: creates, then updates, then explicit removals.
 * Unmanaged records and unexpected records never produce an operation. A
 * removal that would block a create (a CNAME cannot coexist with other records
 * at its name) comes first.
 */
export function planOperations(diff: DnsDiff, { remove = [] }: PlanOptions = {}): DnsOperation[] {
  const creates = diff.missing
    .filter(({ desired }) => desired.managed !== false)
    .map(({ desired }): DnsOperation => ({ kind: 'create', record: payload(desired) }));
  const updates = diff.modified
    .filter(({ desired }) => desired.managed !== false)
    .map(
      ({ desired, observed }): DnsOperation => ({
        kind: 'update',
        recordId: observed.recordId,
        record: payload(desired)
      })
    );
  const blocking: DnsOperation[] = [];
  const trailing: DnsOperation[] = [];
  for (const { recordId, type, name, content } of remove) {
    const blocks = creates.some(
      ({ record }) =>
        record.name === name && record.type !== type && (record.type === 'CNAME' || type === 'CNAME')
    );
    (blocks ? blocking : trailing).push({ kind: 'delete', recordId, record: { type, name, content } });
  }
  return [...blocking, ...creates, ...updates, ...trailing];
}

/**
 * Throws if a plan deletes a record the diff found unexpected, other than those
 * the caller explicitly listed in `remove`. A guard for hand-assembled plans.
 */
export function assertNoUnexpectedDeletes(
  diff: DnsDiff,
  operations: readonly DnsOperation[],
  { remove = [] }: PlanOptions = {}
): void {
  const unexpected = new Set(diff.unexpected.map(({ observed }) => observed.recordId));
  for (const { recordId } of remove) unexpected.delete(recordId);
  for (const operation of operations) {
    if (operation.kind === 'delete' && unexpected.has(operation.recordId)) {
      throw new Error('refusing to delete an unexpected provider record');
    }
  }
}
