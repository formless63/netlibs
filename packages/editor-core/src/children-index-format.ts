/** Display text for the children index, shared by the live node view and the renderer. Pure. */

import type {
  ChildrenIndexSortDirection,
  ChildrenIndexSortKey,
  ChildrenIndexSortState
} from './children-index-sort.ts';

/** Pre-resolution placeholder copy (no children resolved for this render). */
export const CHILDREN_INDEX_PLACEHOLDER_HEADING = 'Children index';
export const CHILDREN_INDEX_PLACEHOLDER_BODY =
  'Renders the live list of child pages on the published view.';

/** Resolved, but this document genuinely has no children. */
export const CHILDREN_INDEX_EMPTY_LABEL = 'No child pages yet.';

/**
 * A row's own child count as the meta line rendered next to its title, or
 * `null` when there is nothing to say — the "only when >0" rule lives here
 * rather than at each call site, so a leaf row can never accidentally render
 * "0 child pages" on one surface and nothing on another. Callers treat `null`
 * as "skip the whole count element".
 */
export function childrenIndexChildCountLabel(childCount: number): string | null {
  if (childCount <= 0) return null;
  return `${childCount} ${childCount === 1 ? 'child page' : 'child pages'}`;
}

/** Spoken direction, as used inside `childrenIndexSortAriaLabel`. */
export function childrenIndexSortDirectionLabel(
  direction: ChildrenIndexSortDirection
): 'ascending' | 'descending' {
  return direction === 'asc' ? 'ascending' : 'descending';
}

/**
 * The arrow glyph for the active column, for the two surfaces that render
 * text rather than an icon component (the static HTML string and the vanilla
 * DOM node view). The React card draws a chevron icon instead — same
 * meaning, different medium.
 */
export function childrenIndexSortArrowGlyph(direction: ChildrenIndexSortDirection): '↑' | '↓' {
  return direction === 'asc' ? '↑' : '↓';
}

/**
 * The sort header's accessible name. The active column announces its current
 * direction; inactive columns stay terse ("Sort by Updated") because
 * activating them is what sets a direction in the first place.
 */
export function childrenIndexSortAriaLabel(
  column: { key: ChildrenIndexSortKey; label: string },
  sort: ChildrenIndexSortState
): string {
  if (sort.key !== column.key) return `Sort by ${column.label}`;
  return `Sort by ${column.label}, currently ${childrenIndexSortDirectionLabel(sort.direction)}`;
}

/**
 * Date cell text. Fixed locale and UTC so the server-rendered page and the
 * hydrated client always produce the same string. Invalid input renders '—'.
 */
export function formatChildrenIndexDate(value: Date | string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '\u2014';
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
