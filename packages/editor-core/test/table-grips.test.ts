import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'bun:test';

import './test-dom.ts';

import { createEditorExtensions } from '../src/schema.ts';
import { buildRichTableGripDecorations } from '../src/table-grips.ts';

/**
 * The grip-decoration builder. `TableMap.get()` and widget factories need a real `ProseMirrorNode`,
 * so these use a jsdom editor.
 */
function makeTableEditor(rows = 3, cols = 3): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph' }] }
  });
  editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
  return editor;
}

describe('buildRichTableGripDecorations', () => {
  it('emits one row grip per row, one column grip per column, and exactly one corner grip for a 3x3 table', () => {
    const editor = makeTableEditor(3, 3);
    const decorations = buildRichTableGripDecorations(editor.state.doc);
    const all = decorations.find();

    const rowGrips = all.filter((d) => String(d.spec.key ?? '').startsWith('row-grip-'));
    const colGrips = all.filter((d) => String(d.spec.key ?? '').startsWith('col-grip-'));
    const cornerGrips = all.filter((d) => String(d.spec.key ?? '').startsWith('corner-grip-'));

    expect(rowGrips).toHaveLength(3);
    expect(colGrips).toHaveLength(3);
    expect(cornerGrips).toHaveLength(1);
    editor.destroy();
  });

  it("positions each row grip at that row's first cell and each column grip at row 0's cell for that column", () => {
    const editor = makeTableEditor(2, 2);
    const decorations = buildRichTableGripDecorations(editor.state.doc);
    const all = decorations.find();

    const cellPositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableHeader' || node.type.name === 'tableCell') {
        cellPositions.push(pos);
      }
    });
    // 2x2 table: [topLeft, topRight, bottomLeft, bottomRight] in doc order.
    expect(cellPositions).toHaveLength(4);
    const [topLeft, topRight, bottomLeft] = cellPositions;

    const byKeySuffix = (prefix: string, suffix: string) =>
      all.find((d) => {
        const key = String(d.spec.key ?? '');
        return key.startsWith(prefix) && key.endsWith(`-${suffix}`);
      });
    const rowGrip0 = byKeySuffix('row-grip-', '0');
    const rowGrip1 = byKeySuffix('row-grip-', '1');
    const colGrip0 = byKeySuffix('col-grip-', '0');
    const colGrip1 = byKeySuffix('col-grip-', '1');
    const cornerGrip = all.find((d) => String(d.spec.key ?? '').startsWith('corner-grip-'));

    // Widgets render at `cellPos + 1` (the start of that cell's content).
    expect(rowGrip0?.from).toBe(topLeft + 1);
    expect(rowGrip1?.from).toBe(bottomLeft + 1);
    expect(colGrip0?.from).toBe(topLeft + 1);
    expect(colGrip1?.from).toBe(topRight + 1);
    expect(cornerGrip?.from).toBe(topLeft + 1);
    editor.destroy();
  });

  it('returns an empty set for a document with no table', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const editor = new Editor({
      element: el,
      extensions: createEditorExtensions(),
      content: { type: 'doc', content: [{ type: 'paragraph' }] }
    });
    const decorations = buildRichTableGripDecorations(editor.state.doc);
    expect(decorations.find()).toHaveLength(0);
    editor.destroy();
  });

  it('renders real grip buttons into the live view with the data attributes the click bridge relies on', () => {
    // Integration-level, through the actual mounted `EditorView` — the
    // extension is wired in via `createEditorExtensions()`, so this
    // exercises the same decoration path a real table in the live editor
    // uses, not just the pure builder.
    const editor = makeTableEditor(2, 2);
    const dom = editor.view.dom as HTMLElement;

    const rowGrips = dom.querySelectorAll<HTMLElement>('[data-table-grip="row"]');
    const colGrips = dom.querySelectorAll<HTMLElement>('[data-table-grip="column"]');
    const cornerGrips = dom.querySelectorAll<HTMLElement>('[data-table-grip="corner"]');
    expect(rowGrips).toHaveLength(2);
    expect(colGrips).toHaveLength(2);
    expect(cornerGrips).toHaveLength(1);

    const firstRowGrip = rowGrips[0]!;
    expect(firstRowGrip.dataset.gripIndex).toBe('0');
    expect(firstRowGrip.getAttribute('aria-label')).toBe('Row options');
    expect(firstRowGrip.contentEditable).toBe('false');
    expect(Number.isInteger(Number(firstRowGrip.dataset.anchorPos))).toBe(true);
    editor.destroy();
  });
});
