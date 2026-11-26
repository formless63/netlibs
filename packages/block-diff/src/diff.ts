import { commonSubsequence, longestIncreasing } from './sequence.ts';
import { stableJson } from './stable-json.ts';

export type BlockStatus = 'unchanged' | 'modified' | 'moved' | 'added' | 'removed';

interface EntryBase {
  /** The block's identity, when it has one. */
  id: string | null;
}

export interface MatchedBlock<T> extends EntryBase {
  /** `modified` wins over `moved`; check `moved` for a block that is both. */
  status: 'unchanged' | 'modified' | 'moved';
  /** Whether it left the order it had among the blocks that stayed. */
  moved: boolean;
  before: T;
  after: T;
  beforeIndex: number;
  afterIndex: number;
  /** `replaced` pairs a removed block with the one that took its place. */
  matchedBy: 'id' | 'content' | 'replaced';
}

export interface AddedBlock<T> extends EntryBase {
  status: 'added';
  after: T;
  afterIndex: number;
}

export interface RemovedBlock<T> extends EntryBase {
  status: 'removed';
  before: T;
  beforeIndex: number;
}

export type BlockDiffEntry<T> = MatchedBlock<T> | AddedBlock<T> | RemovedBlock<T>;

export interface BlockDiffOptions<T> {
  /** A block's stable identity, or null when it has none. Default: none. */
  getId?: ((block: T) => string | null) | undefined;
  /**
   * What two blocks must share to count as the same content. It must not
   * include the identity. Default: key-order-independent JSON.
   */
  getContent?: ((block: T) => string) | undefined;
  /**
   * Pair a removed block with the added block beside it and report one
   * `modified`. Never pairs two blocks that both have ids. Default: true.
   */
  pairReplacements?: boolean | undefined;
}

interface Match {
  beforeIndex: number;
  afterIndex: number;
  by: MatchedBlock<unknown>['matchedBy'];
}

/**
 * Compare two ordered lists of blocks.
 *
 * Blocks sharing an id are matched wherever they went. Where either side has no
 * id (documents older than their ids, or pasted content), equal content is
 * matched in order. The result lists every block once, in the order of `after`,
 * with each removed block placed after the block it used to follow.
 */
export function diffBlocks<T>(
  before: readonly T[],
  after: readonly T[],
  options: BlockDiffOptions<T> = {},
): BlockDiffEntry<T>[] {
  const getId = options.getId ?? (() => null);
  const getContent = options.getContent ?? ((block: T) => stableJson(block));
  const beforeIds = before.map(getId);
  const afterIds = after.map(getId);
  const beforeContent = before.map(getContent);
  const afterContent = after.map(getContent);

  const matches = matchById(beforeIds, afterIds);
  matches.push(...matchByContent(matches, beforeIds, afterIds, beforeContent, afterContent));

  const matchOfAfter = new Map(matches.map((match) => [match.afterIndex, match]));
  const inOrder = [...matches].sort((x, y) => x.afterIndex - y.afterIndex);
  const kept = longestIncreasing(inOrder.map((match) => match.beforeIndex));
  const stayed = new Set(inOrder.filter((_, i) => kept.has(i)).map((match) => match.beforeIndex));
  const matchedBefore = new Set(matches.map((match) => match.beforeIndex));

  // Removed blocks grouped by the nearest earlier block that stayed in place.
  const removedAfter = new Map<number, number[]>();
  let anchor = -1;
  for (let i = 0; i < before.length; i++) {
    if (stayed.has(i)) anchor = i;
    else if (!matchedBefore.has(i)) {
      const group = removedAfter.get(anchor);
      if (group) group.push(i);
      else removedAfter.set(anchor, [i]);
    }
  }

  const entries: BlockDiffEntry<T>[] = [];
  const emitRemoved = (at: number) => {
    for (const i of removedAfter.get(at) ?? []) {
      entries.push({ status: 'removed', id: beforeIds[i]!, before: before[i]!, beforeIndex: i });
    }
  };
  emitRemoved(-1);
  for (let j = 0; j < after.length; j++) {
    const match = matchOfAfter.get(j);
    if (!match) {
      entries.push({ status: 'added', id: afterIds[j]!, after: after[j]!, afterIndex: j });
      continue;
    }
    const i = match.beforeIndex;
    const moved = !stayed.has(i);
    entries.push({
      status: beforeContent[i] !== afterContent[j] ? 'modified' : moved ? 'moved' : 'unchanged',
      moved,
      id: afterIds[j] ?? beforeIds[i]!,
      before: before[i]!,
      after: after[j]!,
      beforeIndex: i,
      afterIndex: j,
      matchedBy: match.by,
    });
    emitRemoved(i);
  }
  return options.pairReplacements === false ? entries : pairReplacements(entries);
}

/** Duplicate ids are invalid; on each side the first block keeps the id. */
function matchById(
  beforeIds: readonly (string | null)[],
  afterIds: readonly (string | null)[],
): Match[] {
  const first = new Map<string, number>();
  beforeIds.forEach((id, i) => {
    if (id !== null && !first.has(id)) first.set(id, i);
  });
  const matches: Match[] = [];
  afterIds.forEach((id, afterIndex) => {
    const beforeIndex = id === null ? undefined : first.get(id);
    if (id === null || beforeIndex === undefined) return;
    first.delete(id);
    matches.push({ beforeIndex, afterIndex, by: 'id' });
  });
  return matches;
}

/**
 * Match equal content among the blocks identity could not settle. Two blocks
 * with different ids are never matched: that identity says they differ.
 */
function matchByContent(
  matched: readonly Match[],
  beforeIds: readonly (string | null)[],
  afterIds: readonly (string | null)[],
  beforeContent: readonly string[],
  afterContent: readonly string[],
): Match[] {
  const usedBefore = new Set(matched.map((match) => match.beforeIndex));
  const usedAfter = new Set(matched.map((match) => match.afterIndex));
  const freeBefore = indexes(beforeIds.length, usedBefore);
  const freeAfter = indexes(afterIds.length, usedAfter);
  const allIdentified =
    freeBefore.every((i) => beforeIds[i] !== null) && freeAfter.every((j) => afterIds[j] !== null);
  if (allIdentified) return [];

  const found: Match[] = [];
  for (const [x, y] of commonSubsequence(
    freeBefore.map((i) => beforeContent[i]!),
    freeAfter.map((j) => afterContent[j]!),
  )) {
    const beforeIndex = freeBefore[x]!;
    const afterIndex = freeAfter[y]!;
    if (beforeIds[beforeIndex] !== null && afterIds[afterIndex] !== null) continue;
    found.push({ beforeIndex, afterIndex, by: 'content' });
  }
  return found;
}

function indexes(length: number, except: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i < length; i++) if (!except.has(i)) out.push(i);
  return out;
}

/**
 * Turn each run of removals directly followed by additions into `modified`
 * pairs, in order. Two blocks that both have ids are left alone: their ids
 * already say that one was removed and the other added.
 */
function pairReplacements<T>(entries: readonly BlockDiffEntry<T>[]): BlockDiffEntry<T>[] {
  const out: BlockDiffEntry<T>[] = [];
  let at = 0;
  while (at < entries.length) {
    const removed: RemovedBlock<T>[] = [];
    const added: AddedBlock<T>[] = [];
    for (let entry = entries[at]; entry?.status === 'removed'; entry = entries[++at]) {
      removed.push(entry);
    }
    for (let entry = entries[at]; entry?.status === 'added'; entry = entries[++at]) {
      added.push(entry);
    }
    const pairs = Math.min(removed.length, added.length);
    let paired = 0;
    while (paired < pairs && (removed[paired]!.id === null || added[paired]!.id === null)) {
      const old = removed[paired]!;
      const now = added[paired]!;
      out.push({
        status: 'modified',
        moved: false,
        id: now.id ?? old.id,
        before: old.before,
        after: now.after,
        beforeIndex: old.beforeIndex,
        afterIndex: now.afterIndex,
        matchedBy: 'replaced',
      });
      paired++;
    }
    out.push(...removed.slice(paired), ...added.slice(paired));
    const entry = entries[at];
    if (entry && entry.status !== 'removed' && entry.status !== 'added') {
      out.push(entry);
      at++;
    }
  }
  return out;
}

/** How many blocks have each status. */
export function summarizeBlockDiff(
  entries: readonly BlockDiffEntry<unknown>[],
): Record<BlockStatus, number> {
  const counts = { unchanged: 0, modified: 0, moved: 0, added: 0, removed: 0 };
  for (const entry of entries) counts[entry.status]++;
  return counts;
}

/** The block to show: the new one, or the old one when it was removed. */
export function visibleBlock<T>(entry: BlockDiffEntry<T>): T {
  return entry.status === 'removed' ? entry.before : entry.after;
}
