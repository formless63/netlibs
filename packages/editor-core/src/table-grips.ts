import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * Table grips: hover buttons drawn as decorations in the anchor cells, so nothing shows while
 * typing. They are inert triggers; clicking one emits an event that `EditorTableControls` turns
 * into a menu.
 *
 * Grip actions use stock table commands, none of which can write an attr the validator rejects.
 */

export type RichTableGripKind = 'row' | 'column' | 'corner';

export interface RichTableGripClickDetail {
  kind: RichTableGripKind;
  index: number;
  /** A cell position inside the row/column this grip represents (or the
   * table's corner cell) — pass straight to `setCellSelection({ anchorCell })`
   * before running the structural command the click resolves to. */
  anchorPos: number;
  rect: { left: number; bottom: number };
}

export const RICH_TABLE_GRIP_CLICK_EVENT = 'rich-table-grip-click';

export const richTableGripsPluginKey = new PluginKey('richTableGrips');

const GRIP_GLYPH: Record<RichTableGripKind, string> = {
  row: '⋮',
  column: '⋯',
  corner: '▦'
};

const GRIP_LABEL: Record<RichTableGripKind, string> = {
  row: 'Row options',
  column: 'Column options',
  corner: 'Table options'
};

function buildGripButton(
  kind: RichTableGripKind,
  index: number,
  anchorPos: number
): HTMLElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.contentEditable = 'false';
  button.dataset.tableGrip = kind;
  button.dataset.gripIndex = String(index);
  button.dataset.anchorPos = String(anchorPos);
  button.className = `rich-table-grip rich-table-grip--${kind}`;
  button.textContent = GRIP_GLYPH[kind];
  button.title = GRIP_LABEL[kind];
  button.setAttribute('aria-label', GRIP_LABEL[kind]);
  return button;
}

/** Exported for tests. */
export function buildRichTableGripDecorations(doc: ProseMirrorNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== 'table') return true;

    const map = TableMap.get(node);
    const tableStart = pos + 1;

    // Row grips sit inside each row's first cell, so no ancestor's `overflow: hidden` clips them.
    // `rowIndex` is the callback's own argument because widgets are created lazily.
    node.forEach((rowNode, rowOffset, rowIndex) => {
      const firstCell = rowNode.firstChild;
      if (firstCell) {
        // `rowOffset` is the row's own offset within the *table's* content —
        // one level up from the cell. The row's position is `pos + 1 +
        // rowOffset`; its first cell (what `setCellSelection` needs) is one
        // further in, at `rowPos + 1`.
        const rowPos = pos + 1 + rowOffset;
        const cellPos = rowPos + 1;
        decorations.push(
          Decoration.widget(cellPos + 1, () => buildGripButton('row', rowIndex, cellPos), {
            key: `row-grip-${pos}-${rowIndex}`,
            side: -1
          })
        );
      }
    });

    // Column grips: anchored on row 0's cell in each column.
    for (let col = 0; col < map.width; col += 1) {
      const relative = map.map[col];
      if (relative === undefined) continue;
      const cellPos = tableStart + relative;
      const cellNode = doc.nodeAt(cellPos);
      if (!cellNode) continue;
      decorations.push(
        Decoration.widget(cellPos + 1, () => buildGripButton('column', col, cellPos), {
          key: `col-grip-${pos}-${col}`,
          side: -1
        })
      );
    }

    // The corner cell hosts three grips, placed in separate quadrants by CSS.
    const cornerRelative = map.map[0];
    if (cornerRelative !== undefined) {
      const cornerPos = tableStart + cornerRelative;
      decorations.push(
        Decoration.widget(cornerPos + 1, () => buildGripButton('corner', 0, cornerPos), {
          key: `corner-grip-${pos}`,
          side: -2
        })
      );
    }

    return false;
  });

  return DecorationSet.create(doc, decorations);
}

function dispatchGripClick(host: HTMLElement, target: HTMLElement): void {
  const kind = target.dataset.tableGrip as RichTableGripKind | undefined;
  const anchorPosRaw = target.dataset.anchorPos;
  if (!kind || anchorPosRaw === undefined) return;
  const anchorPos = Number(anchorPosRaw);
  if (!Number.isInteger(anchorPos)) return;
  const index = Number(target.dataset.gripIndex ?? '0');
  const rect = target.getBoundingClientRect();
  const detail: RichTableGripClickDetail = {
    kind,
    index: Number.isInteger(index) ? index : 0,
    anchorPos,
    rect: { left: rect.left, bottom: rect.bottom }
  };
  host.dispatchEvent(
    new CustomEvent<RichTableGripClickDetail>(RICH_TABLE_GRIP_CLICK_EVENT, { detail })
  );
}

export const RichTableGrips = Extension.create({
  name: 'richTableGrips',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: richTableGripsPluginKey,
        props: {
          decorations(state: EditorState) {
            return buildRichTableGripDecorations(state.doc);
          },
          handleDOMEvents: {
            mousedown(view, event) {
              const target = (event.target as HTMLElement | null)?.closest<HTMLElement>(
                '[data-table-grip]'
              );
              if (!target) return false;
              event.preventDefault();
              event.stopPropagation();
              dispatchGripClick(view.dom, target);
              return true;
            }
          }
        }
      })
    ];
  }
});
