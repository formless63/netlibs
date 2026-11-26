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
  /** `DiffOptions.pending`, as given: observed records the caller is removing. */
  pending?: ObservedRecord[];
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
  /**
   * Observed records the caller is about to remove (and will pass to
   * `planOperations` as `remove`, or keep on purpose). They are left out of the
   * comparison, whether or not they are also in `observed`. A desired record
   * that certainly replaces one of them stays `missing`, so the planner can
   * replace that record, and is never paired with another record at the name.
   */
  pending?: readonly ObservedRecord[];
}

const SINGLE_VALUED = new Set(['CNAME', 'SOA', 'ALIAS', 'ANAME', 'DNAME']);
const ADDRESS = new Set(['A', 'AAAA']);

const keyOf = (record: DnsRecord): string =>
  `${record.type.toUpperCase()} ${record.name.trim().toLowerCase().replace(/\.$/, '')}`;

function txtTag(content: string): string | null {
  return /^\s*(v=[A-Za-z0-9]+)/.exec(content)?.[1]?.toLowerCase() ?? null;
}

/**
 * Whether `have` is certainly the record `want` replaces, once equal content is
 * ruled out. `onlyPair`: the (type, name) holds one record on each side.
 */
function certainlyReplaces(
  want: DnsRecord,
  have: DnsRecord,
  onlyPair: boolean,
  normalize: (type: string, content: string) => string
): boolean {
  const type = want.type.toUpperCase();
  if (SINGLE_VALUED.has(type)) return true;
  if (ADDRESS.has(type)) return onlyPair;
  if (type === 'TXT') {
    const tag = txtTag(normalize(want.type, want.content));
    return tag !== null && tag === txtTag(normalize(have.type, have.content));
  }
  // MX, NS, CAA, SRV and the rest are sets: another value is another record.
  return false;
}

const sameName = (a: { name: string }, b: { name: string }): boolean =>
  a.name.trim().toLowerCase().replace(/\.$/, '') === b.name.trim().toLowerCase().replace(/\.$/, '');

/**
 * Whether two records cannot exist together at one name: a CNAME beside
 * anything (at the apex, where providers flatten it, only beside an address
 * or another CNAME), NS beside anything below the apex, two values of a
 * single-valued type. Deliberately wide; the provider still decides.
 */
export function recordsConflict(a: Pick<DnsRecord, 'type' | 'name'>, b: Pick<DnsRecord, 'type' | 'name'>): boolean {
  if (!sameName(a, b)) return false;
  const one = a.type.toUpperCase();
  const other = b.type.toUpperCase();
  if (one === other) return SINGLE_VALUED.has(one);
  const apex = a.name.trim() === '@';
  for (const [x, y] of [
    [one, other],
    [other, one]
  ] as const) {
    if (x === 'CNAME' && (!apex || ADDRESS.has(y))) return true;
    if (x === 'NS' && !apex) return true;
  }
  return false;
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
  const pending = [...(options.pending ?? [])];
  const pendingIds = new Set(pending.map((record) => record.recordId));
  const diff: DnsDiff<D> = {
    missing: [],
    modified: [],
    unexpected: [],
    unchanged: [],
    ...(options.pending ? { pending } : {})
  };

  const pair = (want: D, have: ObservedRecord): void => {
    const changed: RecordAttribute[] = [];
    if (normalize(want.type, want.content) !== normalize(have.type, have.content)) changed.push('content');
    if (want.proxied !== have.proxied) changed.push('proxied');
    if (want.ttlSeconds !== have.ttlSeconds) changed.push('ttlSeconds');
    if ((want.priority ?? null) !== (have.priority ?? null)) changed.push('priority');
    if (changed.length === 0) diff.unchanged.push({ kind: 'unchanged', desired: want, observed: have });
    else diff.modified.push({ kind: 'modified', desired: want, observed: have, changed });
  };

  const observedGroups = groupBy(
    observed.filter((record) => !pendingIds.has(record.recordId)),
    keyOf
  );
  const pendingGroups = groupBy(pending, keyOf);
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
    // A record that replaces one being removed is that record's successor,
    // and must not take over somebody else's.
    const successors = new Set(
      open.filter(
        (want) =>
          managed(want) &&
          (pendingGroups.get(key) ?? []).some((have) => certainlyReplaces(want, have, true, normalize))
      )
    );
    const free = (want: D): boolean => !successors.has(want);
    if (pairing === 'positional') {
      match((want) => (free(want) && pool.length > 0 ? 0 : -1));
    } else if (SINGLE_VALUED.has(type)) {
      match((want) => (managed(want) && free(want) && pool.length > 0 ? 0 : -1));
    } else if (ADDRESS.has(type) && wants.length === 1 && open.length === 1 && pool.length === 1) {
      match((want) => (managed(want) && free(want) ? 0 : -1));
    } else if (type === 'TXT') {
      match((want) => {
        const tag = txtTag(normalize(want.type, want.content));
        if (tag === null || !managed(want) || !free(want)) return -1;
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

export interface PlanOptions<R extends ObservedRecord = ObservedRecord> {
  /**
   * Records to remove, each as it was observed. The only source of deletes.
   * Anything else in `DnsDiff.pending` stays where it is.
   */
  remove?: readonly R[];
}

/** One planned operation and what it carries out. */
export interface PlannedChange<D extends DesiredRecord = DesiredRecord, R extends ObservedRecord = ObservedRecord> {
  operation: DnsOperation;
  /** The desired record a create or update writes. */
  desired?: D;
  /** The record a delete removes, or the one an update replaces in place. */
  removed?: R;
}

const payload = (record: DnsRecord): DnsRecord => ({
  type: record.type,
  name: record.name,
  content: record.content,
  ttlSeconds: record.ttlSeconds,
  priority: record.priority,
  proxied: record.proxied
});

const nameKey = (record: { name: string }): string => record.name.trim().toLowerCase().replace(/\.$/, '');

/**
 * The operations a diff implies, each with what it carries out, in this order:
 *
 * 1. a removal and a missing record of the same type that are certainly one
 *    record become one update, so the name is never empty;
 * 2. removals that conflict with a create (a type change), then those creates,
 *    as one `group` per name;
 * 3. other creates, before any other delete, so a set never has a gap;
 * 4. updates for modified records;
 * 5. other removals;
 * 6. creates blocked by a record that stays (unexpected, unmanaged, or pending
 *    and not removed). Nothing is deleted to make room for them; the provider
 *    refuses them, last, so the rest of the zone goes through.
 *
 * Unmanaged and unexpected records never produce an operation.
 */
export function planChanges<D extends DesiredRecord, R extends ObservedRecord = ObservedRecord>(
  diff: DnsDiff<D>,
  { remove = [] }: PlanOptions<R> = {},
  options: Pick<DiffOptions, 'normalize'> = {}
): PlannedChange<D, R>[] {
  const normalize = options.normalize ?? normalizeContent;
  const managed = (desired: D): boolean => desired.managed !== false;
  const missing = diff.missing.map(({ desired }) => desired).filter(managed);
  const removals = new Set<R>(remove);
  const removedIds = new Set(remove.map((record) => record.recordId));

  // Everything at the provider that this plan leaves there.
  const staying: ObservedRecord[] = [
    ...diff.unexpected.map(({ observed }) => observed),
    ...diff.unchanged.map(({ observed }) => observed),
    ...diff.modified.map(({ observed }) => observed),
    ...(diff.pending ?? [])
  ].filter((record) => !removedIds.has(record.recordId));

  // 1. Replace in place.
  const planned: PlannedChange<D, R>[] = [];
  const creates: D[] = [];
  for (const desired of missing) {
    const sameKey = [...removals].filter((record) => keyOf(record) === keyOf(desired));
    const onlyPair = sameKey.length === 1 && missing.filter((other) => keyOf(other) === keyOf(desired)).length === 1;
    const replaced = sameKey.find((record) => certainlyReplaces(desired, record, onlyPair, normalize));
    if (replaced === undefined) {
      creates.push(desired);
      continue;
    }
    removals.delete(replaced);
    planned.push({
      operation: { kind: 'update', recordId: replaced.recordId, record: payload(desired) },
      desired,
      removed: replaced
    });
  }

  // 2. Creates a removal stands in the way of. Deleting first only helps when
  // nothing that stays blocks the same name: otherwise the create fails anyway
  // and the delete would just leave the name empty.
  const inTheWay = (desired: D): R[] => [...removals].filter((record) => recordsConflict(desired, record));
  const blockedBy = (desired: D): boolean => staying.some((record) => recordsConflict(desired, record));
  const blockedNames = new Set(creates.filter(blockedBy).map(nameKey));
  const swaps = new Map<string, { deletes: R[]; creates: D[] }>();
  const plain: D[] = [];
  const blocked: D[] = [];
  const withheld = new Set<R>();
  for (const desired of creates) {
    const conflicting = inTheWay(desired);
    if (blockedBy(desired) || (blockedNames.has(nameKey(desired)) && conflicting.length > 0)) {
      blocked.push(desired);
      for (const record of conflicting) withheld.add(record);
      continue;
    }
    if (conflicting.length === 0) {
      plain.push(desired);
      continue;
    }
    const swap = swaps.get(nameKey(desired)) ?? { deletes: [], creates: [] };
    for (const record of conflicting) if (!swap.deletes.includes(record)) swap.deletes.push(record);
    swap.creates.push(desired);
    swaps.set(nameKey(desired), swap);
  }

  const create = (desired: D, group?: string): PlannedChange<D, R> => ({
    operation: { kind: 'create', record: payload(desired), ...(group === undefined ? {} : { group }) },
    desired
  });
  const del = (record: R, group?: string): PlannedChange<D, R> => ({
    operation: {
      kind: 'delete',
      recordId: record.recordId,
      record: { type: record.type, name: record.name, content: record.content },
      ...(group === undefined ? {} : { group })
    },
    removed: record
  });

  for (const [name, swap] of swaps) {
    const group = `replace ${name}`;
    for (const record of swap.deletes) {
      planned.push(del(record, group));
      removals.delete(record);
    }
    planned.push(...swap.creates.map((desired) => create(desired, group)));
  }
  // 3.
  planned.push(...plain.map((desired) => create(desired)));
  // 4.
  for (const { desired, observed } of diff.modified) {
    if (!managed(desired)) continue;
    planned.push({ operation: { kind: 'update', recordId: observed.recordId, record: payload(desired) }, desired });
  }
  // 5.
  for (const record of removals) if (!withheld.has(record)) planned.push(del(record));
  // 6.
  planned.push(...blocked.map((desired) => create(desired)));
  return planned;
}

/** {@link planChanges}, operations only. */
export function planOperations(diff: DnsDiff, options: PlanOptions = {}): DnsOperation[] {
  return planChanges(diff, options).map(({ operation }) => operation);
}

/**
 * Throws if a plan deletes or rewrites a record the diff found unexpected,
 * other than those the caller explicitly listed in `remove`. A guard for
 * hand-assembled plans.
 */
export function assertNoUnexpectedDeletes(
  diff: DnsDiff,
  operations: readonly DnsOperation[],
  { remove = [] }: PlanOptions = {}
): void {
  const unexpected = new Set(diff.unexpected.map(({ observed }) => observed.recordId));
  for (const { recordId } of remove) unexpected.delete(recordId);
  for (const operation of operations) {
    if (operation.kind === 'create' || !unexpected.has(operation.recordId)) continue;
    throw new Error(
      operation.kind === 'delete'
        ? 'refusing to delete an unexpected provider record'
        : 'refusing to rewrite an unexpected provider record'
    );
  }
}
