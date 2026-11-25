/**
 * Sorting for the children index, shared by the live node view and the renderer. Pure. Dates may be
 * `Date` objects or ISO strings.
 */

export const CHILDREN_INDEX_SORT_KEYS = ['title', 'updatedAt', 'publishedAt'] as const;
export type ChildrenIndexSortKey = (typeof CHILDREN_INDEX_SORT_KEYS)[number];

export const CHILDREN_INDEX_SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type ChildrenIndexSortDirection = (typeof CHILDREN_INDEX_SORT_DIRECTIONS)[number];

export interface ChildrenIndexSortState {
  key: ChildrenIndexSortKey;
  direction: ChildrenIndexSortDirection;
}

/** Column header label, in display order left-to-right. */
export const CHILDREN_INDEX_SORT_COLUMNS: ReadonlyArray<{
  key: ChildrenIndexSortKey;
  label: string;
}> = [
  { key: 'title', label: 'Title' },
  { key: 'updatedAt', label: 'Updated' },
  { key: 'publishedAt', label: 'Published' }
];

/** Sensible first-click direction per column: A-Z for title, newest-first for the two dates. */
const DEFAULT_DIRECTION_FOR_KEY: Record<ChildrenIndexSortKey, ChildrenIndexSortDirection> = {
  title: 'asc',
  updatedAt: 'desc',
  publishedAt: 'desc'
};

/** The default sort. */
export const DEFAULT_CHILDREN_INDEX_SORT: ChildrenIndexSortState = {
  key: 'updatedAt',
  direction: 'desc'
};

/** Clicking the active column flips its direction; another column starts at its own default. */
export function nextChildrenIndexSort(
  current: ChildrenIndexSortState,
  clickedKey: ChildrenIndexSortKey
): ChildrenIndexSortState {
  if (current.key === clickedKey) {
    return { key: clickedKey, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key: clickedKey, direction: DEFAULT_DIRECTION_FOR_KEY[clickedKey] };
}

export interface ChildrenIndexSortableRow {
  title: string;
  updatedAt: Date | string;
  publishedAt: Date | string;
}

function timeOf(value: Date | string): number {
  return new Date(value).getTime();
}

/**
 * Pure, non-mutating sort. Direction is part of the comparator, so tied rows keep their order in
 * both directions.
 */
export function sortChildrenIndexRows<T extends ChildrenIndexSortableRow>(
  rows: readonly T[],
  sort: ChildrenIndexSortState
): T[] {
  const signum = sort.direction === 'asc' ? 1 : -1;
  return rows.toSorted((a, b) => {
    const diff =
      sort.key === 'title'
        ? a.title.localeCompare(b.title)
        : timeOf(a[sort.key]) - timeOf(b[sort.key]);
    return diff * signum;
  });
}
