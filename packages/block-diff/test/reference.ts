// A deliberately plain implementation of the same rules, used as a test oracle:
// the package must agree with it wherever it is well defined. Not shipped.
import { stableJson } from '../src/index.ts';

const BLOCK_ID = /^b_[0-9A-HJKMNP-TV-Z]{16}$/;

export interface ReferenceNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: ReferenceNode[];
  text?: string;
}

export type ReferenceStatus =
  | 'added'
  | 'removed'
  | 'modified'
  | 'unchanged'
  | 'moved';

export interface ReferenceEntry {
  status: ReferenceStatus;
    blockId: string | null;
    node: ReferenceNode;
  matchedBy: 'blockId' | 'position';
}

function blockIdOf(node: ReferenceNode): string | null {
  const attrs = node.attrs;
  if (!attrs || typeof attrs !== 'object') return null;
  const id = (attrs as Record<string, unknown>).blockId;
  return typeof id === 'string' && BLOCK_ID.test(id) ? id : null;
}

function contentKeyOf(node: ReferenceNode): string {
  return stableJson(node);
}

function longestIncreasingSubsequenceIndices(seq: number[]): Set<number> {
  const n = seq.length;
  if (n === 0) return new Set();

  const tails: number[] = [];
  const predecessors: number[] = Array.from({ length: n }, () => -1);

  for (let i = 0; i < n; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]] < seq[i]) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) predecessors[i] = tails[lo - 1];
    if (lo === tails.length) tails.push(i);
    else tails[lo] = i;
  }

  const result = new Set<number>();
  let k = tails.at(-1) ?? -1;
  while (k !== -1) {
    result.add(k);
    k = predecessors[k];
  }
  return result;
}

function keyedDiff(
  fromBlocks: readonly ReferenceNode[],
  toBlocks: readonly ReferenceNode[]
): ReferenceEntry[] {
  const fromById = new Map<string, number>();
  fromBlocks.forEach((node, index) => {
    const id = blockIdOf(node);
    if (id !== null && !fromById.has(id)) fromById.set(id, index);
  });

  const sharedIds: string[] = [];
  const seenSharedIds = new Set<string>();
  toBlocks.forEach((node) => {
    const id = blockIdOf(node);
    if (id !== null && fromById.has(id) && !seenSharedIds.has(id)) {
      seenSharedIds.add(id);
      sharedIds.push(id);
    }
  });

  const fromIndexSeq = sharedIds.map((id) => fromById.get(id)!);
  const stablePositions = longestIncreasingSubsequenceIndices(fromIndexSeq);
  const stableIds = new Set(sharedIds.filter((_id, position) => stablePositions.has(position)));

  const consumedFrom = new Set<number>();
  interface WorkingEntry extends ReferenceEntry {
    fromIndex: number | null;
  }
  const entries: WorkingEntry[] = [];

  toBlocks.forEach((node) => {
    const id = blockIdOf(node);
    if (id !== null && fromById.has(id)) {
      const fromIndex = fromById.get(id)!;
      consumedFrom.add(fromIndex);
      const changed = contentKeyOf(node) !== contentKeyOf(fromBlocks[fromIndex]);
      const status: ReferenceStatus = changed
        ? 'modified'
        : stableIds.has(id)
          ? 'unchanged'
          : 'moved';
      entries.push({ status, blockId: id, node, matchedBy: 'blockId', fromIndex });
    } else {
      entries.push({ status: 'added', blockId: id, node, matchedBy: 'blockId', fromIndex: null });
    }
  });

  const output: ReferenceEntry[] = [];
  let entryPointer = 0;
  for (let fromIndex = 0; fromIndex < fromBlocks.length; fromIndex++) {
    if (consumedFrom.has(fromIndex)) {
      while (entryPointer < entries.length && entries[entryPointer].fromIndex !== fromIndex) {
        const { fromIndex: _drop, ...rest } = entries[entryPointer];
        output.push(rest);
        entryPointer++;
      }
      if (entryPointer < entries.length) {
        const { fromIndex: _drop, ...rest } = entries[entryPointer];
        output.push(rest);
        entryPointer++;
      }
    } else {
      const node = fromBlocks[fromIndex];
      output.push({ status: 'removed', blockId: blockIdOf(node), node, matchedBy: 'blockId' });
    }
  }
  while (entryPointer < entries.length) {
    const { fromIndex: _drop, ...rest } = entries[entryPointer];
    output.push(rest);
    entryPointer++;
  }

  return output;
}

function positionalDiff(
  fromBlocks: readonly ReferenceNode[],
  toBlocks: readonly ReferenceNode[]
): ReferenceEntry[] {
  const n = fromBlocks.length;
  const m = toBlocks.length;
  const fromKeys = fromBlocks.map(contentKeyOf);
  const toKeys = toBlocks.map(contentKeyOf);

  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0)
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        fromKeys[i] === toKeys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  type RawOp =
    | { op: 'common'; fromIndex: number; toIndex: number }
    | { op: 'removed'; fromIndex: number }
    | { op: 'added'; toIndex: number };
  const raw: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (fromKeys[i] === toKeys[j]) {
      raw.push({ op: 'common', fromIndex: i, toIndex: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ op: 'removed', fromIndex: i });
      i++;
    } else {
      raw.push({ op: 'added', toIndex: j });
      j++;
    }
  }
  while (i < n) {
    raw.push({ op: 'removed', fromIndex: i });
    i++;
  }
  while (j < m) {
    raw.push({ op: 'added', toIndex: j });
    j++;
  }

  const merged: ReferenceEntry[] = [];
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k];
    const next = raw[k + 1];
    if (cur.op === 'removed' && next?.op === 'added') {
      merged.push({
        status: 'modified',
        blockId: null,
        node: toBlocks[next.toIndex],
        matchedBy: 'position'
      });
      k++;
      continue;
    }
    if (cur.op === 'added' && next?.op === 'removed') {
      merged.push({
        status: 'modified',
        blockId: null,
        node: toBlocks[cur.toIndex],
        matchedBy: 'position'
      });
      k++;
      continue;
    }
    if (cur.op === 'common') {
      merged.push({
        status: 'unchanged',
        blockId: null,
        node: toBlocks[cur.toIndex],
        matchedBy: 'position'
      });
    } else if (cur.op === 'removed') {
      merged.push({
        status: 'removed',
        blockId: null,
        node: fromBlocks[cur.fromIndex],
        matchedBy: 'position'
      });
    } else {
      merged.push({
        status: 'added',
        blockId: null,
        node: toBlocks[cur.toIndex],
        matchedBy: 'position'
      });
    }
  }
  return merged;
}

export function referenceDiff(
  fromBlocks: readonly ReferenceNode[],
  toBlocks: readonly ReferenceNode[]
): ReferenceEntry[] {
  const anyBlockId = (blocks: readonly ReferenceNode[]) =>
    blocks.some((b) => blockIdOf(b) !== null);
  if (!anyBlockId(fromBlocks) && !anyBlockId(toBlocks)) {
    return positionalDiff(fromBlocks, toBlocks);
  }
  return keyedDiff(fromBlocks, toBlocks);
}
