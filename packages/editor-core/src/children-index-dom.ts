/**
 * DOM builders for the children-index card, used by the live node view. No React. Callers own the
 * sort state; sorting and display text come from the pure sibling modules.
 */

import {
  childrenIndexChildCountLabel,
  formatChildrenIndexDate,
  childrenIndexSortAriaLabel,
  childrenIndexSortArrowGlyph
} from './children-index-format.ts';
import {
  CHILDREN_INDEX_SORT_COLUMNS,
  type ChildrenIndexSortKey,
  type ChildrenIndexSortState
} from './children-index-sort.ts';

export interface ChildrenIndexDomRow {
  id: string;
  title: string;
  href: string;
  updatedAt: Date | string;
  publishedAt: Date | string;
  childCount: number;
}

const HEADER_ACTIVE_CLASS = 'rich-children-index__sort-btn--active';

/**
 * The heading row: one sort control per column. Activating it reports the column's key; the caller
 * owns the direction (`nextChildrenIndexSort`) and re-renders.
 */
export function buildChildrenIndexHeaderElement(
  sort: ChildrenIndexSortState,
  onSelectKey: (key: ChildrenIndexSortKey) => void
): HTMLElement {
  const header = document.createElement('div');
  header.className = 'rich-children-index__header';

  for (const column of CHILDREN_INDEX_SORT_COLUMNS) {
    const isActive = sort.key === column.key;
    const btn = document.createElement('span');
    btn.className = isActive
      ? `rich-children-index__sort-btn ${HEADER_ACTIVE_CLASS}`
      : 'rich-children-index__sort-btn';
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.dataset.sortKey = column.key;
    btn.setAttribute('aria-label', childrenIndexSortAriaLabel(column, sort));

    const label = document.createElement('span');
    label.textContent = column.label;
    btn.appendChild(label);

    if (isActive) {
      const arrow = document.createElement('span');
      arrow.className = 'rich-children-index__sort-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = childrenIndexSortArrowGlyph(sort.direction);
      btn.appendChild(arrow);
    }

    const activate = (event: Event) => {
      event.stopPropagation();
      onSelectKey(column.key);
    };
    // Same mousedown-stopPropagation technique the row links already use
    // (see `buildChildrenIndexRowElement` below) — keeps a header click from
    // being read by ProseMirror as "select the atom" when this renders
    // inside the live editor's node view.
    btn.addEventListener('mousedown', (event) => event.stopPropagation());
    btn.addEventListener('click', activate);
    btn.addEventListener('keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key === 'Enter' || key === ' ') {
        event.preventDefault();
        activate(event);
      }
    });

    header.appendChild(btn);
  }

  return header;
}

/** One data row: title (+ own child count, when >0) | Updated | Published. */
export function buildChildrenIndexRowElement(
  row: ChildrenIndexDomRow,
  onNavigate: ((href: string) => void) | undefined
): HTMLElement {
  const item = document.createElement('li');
  item.className = 'rich-children-index__item';

  const titleCol = document.createElement('span');
  titleCol.className = 'rich-children-index__col rich-children-index__col--title';

  const link = document.createElement('a');
  link.className = 'rich-children-index__link';
  link.href = row.href;
  link.textContent = row.title;
  link.addEventListener('mousedown', (event) => {
    event.stopPropagation();
  });
  link.addEventListener('click', (event) => {
    event.stopPropagation();
    // No `onNavigate` wired — fall back to the anchor's own `href` doing a
    // normal browser navigation rather than silently swallowing the click.
    if (!onNavigate) return;
    event.preventDefault();
    onNavigate(row.href);
  });
  titleCol.appendChild(link);

  const countLabel = childrenIndexChildCountLabel(row.childCount);
  if (countLabel !== null) {
    const count = document.createElement('span');
    count.className = 'rich-children-index__count';
    count.textContent = countLabel;
    titleCol.appendChild(count);
  }

  const updatedCol = document.createElement('span');
  updatedCol.className = 'rich-children-index__col rich-children-index__col--updated';
  updatedCol.textContent = formatChildrenIndexDate(row.updatedAt);

  const publishedCol = document.createElement('span');
  publishedCol.className = 'rich-children-index__col rich-children-index__col--published';
  publishedCol.textContent = formatChildrenIndexDate(row.publishedAt);

  item.append(titleCol, updatedCol, publishedCol);
  return item;
}

export function buildChildrenIndexListElement(
  rows: readonly ChildrenIndexDomRow[],
  onNavigate: ((href: string) => void) | undefined
): HTMLElement {
  const list = document.createElement('ul');
  list.className = 'rich-children-index__list';
  for (const row of rows) {
    list.appendChild(buildChildrenIndexRowElement(row, onNavigate));
  }
  return list;
}
