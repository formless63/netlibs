/**
 * Positions in `sequence` forming one longest strictly increasing subsequence
 * (patience sorting, O(n log n)).
 */
export function longestIncreasing(sequence: readonly number[]): Set<number> {
  const tails: number[] = [];
  const previous: number[] = [];
  for (let i = 0; i < sequence.length; i++) {
    const value = sequence[i]!;
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (sequence[tails[middle]!]! < value) low = middle + 1;
      else high = middle;
    }
    previous[i] = low > 0 ? tails[low - 1]! : -1;
    tails[low] = i;
  }
  const kept = new Set<number>();
  for (let at = tails.at(-1) ?? -1; at !== -1; at = previous[at]!) kept.add(at);
  return kept;
}

/** Above this many cells the quadratic table is not built. */
const MAX_CELLS = 4_000_000;

/**
 * Index pairs of a longest common subsequence of two key lists, in order.
 *
 * Exact up to `MAX_CELLS`. Beyond that, keys occurring exactly once on both
 * sides are used as anchors (patience diff) and the gaps between them are
 * solved exactly, so a long document stays bounded in memory. A gap that is
 * still too large and has no anchors is reported as wholly replaced.
 */
export function commonSubsequence(
  before: readonly string[],
  after: readonly string[],
): [number, number][] {
  const pairs: [number, number][] = [];
  solve(before, after, 0, before.length, 0, after.length, pairs);
  return pairs;
}

function solve(
  a: readonly string[],
  b: readonly string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
  out: [number, number][],
): void {
  while (aStart < aEnd && bStart < bEnd && a[aStart] === b[bStart]) {
    out.push([aStart++, bStart++]);
  }
  const n = aEnd - aStart;
  const m = bEnd - bStart;
  if (n === 0 || m === 0) return;

  if ((n + 1) * (m + 1) <= MAX_CELLS) {
    exact(a, b, aStart, n, bStart, m, out);
    return;
  }
  const anchors = uniqueAnchors(a, b, aStart, aEnd, bStart, bEnd);
  let aAt = aStart;
  let bAt = bStart;
  for (const [i, j] of anchors) {
    solve(a, b, aAt, i, bAt, j, out);
    out.push([i, j]);
    aAt = i + 1;
    bAt = j + 1;
  }
  if (anchors.length > 0) solve(a, b, aAt, aEnd, bAt, bEnd, out);
}

function exact(
  a: readonly string[],
  b: readonly string[],
  aStart: number,
  n: number,
  bStart: number,
  m: number,
  out: [number, number][],
): void {
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[aStart + i] === b[bStart + j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[aStart + i] === b[bStart + j]) out.push([aStart + i++, bStart + j++]);
    // Ties drop the old block first, so a replacement reads old then new.
    else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) i++;
    else j++;
  }
}

function uniqueAnchors(
  a: readonly string[],
  b: readonly string[],
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): [number, number][] {
  const inA = uniqueIndexes(a, aStart, aEnd);
  const inB = uniqueIndexes(b, bStart, bEnd);
  const pairs: [number, number][] = [];
  for (const [key, i] of inA) {
    const j = inB.get(key);
    if (j !== undefined) pairs.push([i, j]);
  }
  const kept = longestIncreasing(pairs.map((pair) => pair[1]));
  return pairs.filter((_, index) => kept.has(index));
}

/** In ascending index order, since Map keeps insertion order. */
function uniqueIndexes(keys: readonly string[], start: number, end: number): Map<string, number> {
  const seen = new Map<string, number>();
  const repeated = new Set<string>();
  for (let i = start; i < end; i++) {
    const key = keys[i]!;
    if (seen.has(key)) repeated.add(key);
    else seen.set(key, i);
  }
  for (const key of repeated) seen.delete(key);
  return seen;
}
