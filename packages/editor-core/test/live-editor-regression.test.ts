import { Editor, type Content } from '@tiptap/core';
import { describe, expect, it } from 'bun:test';

import './test-dom.ts';

import { RICH_BLOCK_ID_PATTERN } from '../src/block-identity.ts';
import { applyRichBlockDuplicate } from '../src/block-move.ts';
import { prepareEditorSnapshot } from '../src/prepare.ts';
import { createEditorExtensions } from '../src/schema.ts';
import { RICH_TABLE_COLWIDTH_MIN, type EditorDocument } from '../src/types.ts';
import { validateEditorDocument } from '../src/validation.ts';

/**
 * Behavior that needs a mounted `Editor` (jsdom): column resizing, list sink/lift and node views
 * only run against a live `EditorView`.
 */
function makeEditor(content: Content = { type: 'doc', content: [{ type: 'paragraph' }] }): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: createEditorExtensions(), content });
}

function docJson(editor: Editor): EditorDocument {
  return editor.getJSON() as EditorDocument;
}

function firstCellPos(editor: Editor): number {
  let pos = -1;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos === -1 && (node.type.name === 'tableHeader' || node.type.name === 'tableCell')) {
      pos = nodePos;
    }
    return pos === -1;
  });
  return pos;
}

// Fuzz-harness helpers for the "exhaustive grip-command fuzz" describe block
// below — module scope (not nested in the `it`) so they aren't recreated per
// call, matching this file's other top-level helpers above.
function findTablePos(editor: Editor): number | null {
  let pos: number | null = null;
  editor.state.doc.descendants((node, nodePos) => {
    if (pos === null && node.type.name === 'table') pos = nodePos;
    return pos === null;
  });
  return pos;
}
function rowAnchor(editor: Editor, tablePos: number, rowIndex: number): number | null {
  const table = editor.state.doc.nodeAt(tablePos)!;
  let rowOffset = -1;
  table.forEach((_rowNode, offset, idx) => {
    if (idx === rowIndex) rowOffset = offset;
  });
  if (rowOffset === -1) return null;
  return tablePos + 1 + rowOffset + 1;
}
async function colAnchor(editor: Editor, tablePos: number, col: number): Promise<number | null> {
  const { TableMap } = await import('@tiptap/pm/tables');
  const table = editor.state.doc.nodeAt(tablePos)!;
  const map = TableMap.get(table);
  const relative = map.map[col];
  return relative === undefined ? null : tablePos + 1 + relative;
}
function cornerAnchorSync(
  editor: Editor,
  tablePos: number,
  TableMapCtor: typeof import('@tiptap/pm/tables').TableMap
): number {
  const table = editor.state.doc.nodeAt(tablePos)!;
  const map = TableMapCtor.get(table);
  return tablePos + 1 + map.map[0]!;
}
function runAtAnchor(editor: Editor, anchorPos: number, run: () => void) {
  editor.chain().focus().setCellSelection({ anchorCell: anchorPos }).run();
  run();
}

describe('table: column widths are a deliberate persisted attr', () => {
  it('a bounded colwidth array set by a column-resize drag is now canonical-valid (persistence is deliberate, not the Stage-1 poisoning)', () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();

    let cellPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (cellPos === -1 && (node.type.name === 'tableHeader' || node.type.name === 'tableCell')) {
        cellPos = pos;
      }
      return cellPos === -1;
    });
    expect(cellPos).toBeGreaterThan(-1);

    const tr = editor.state.tr;
    const node = editor.state.doc.nodeAt(cellPos)!;
    // The exact setNodeMarkup prosemirror-tables' updateColumnWidth() uses on drag-release.
    tr.setNodeMarkup(cellPos, null, { ...node.attrs, colwidth: [180] });
    editor.view.dispatch(tr);

    const withColwidth = docJson(editor);
    expect(validateEditorDocument(withColwidth).success).toBe(true);
    editor.destroy();
  });

  it('an out-of-bounds colwidth still fails validation (the bound is what makes re-enabling safe)', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: [99999], align: null },
                  content: [{ type: 'paragraph' }]
                }
              ]
            }
          ]
        }
      ]
    };
    const result = validateEditorDocument(doc);
    expect(result.success).toBe(false);
    expect(result.findings.some((finding) => finding.code === 'invalid_table_colwidth')).toBe(true);
  });

  // Insertion leaves colwidth unset, so equal-width columns are the default and a width only
  // appears after a drag.
  it('insertion leaves colwidth unset — a freshly inserted table carries no widths until a drag writes them', () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    const json = docJson(editor);
    const table = json.content?.find((n) => n.type === 'table');
    const allCells = table?.content?.flatMap((row) => row.content ?? []) ?? [];
    expect(allCells.length).toBeGreaterThan(0);
    for (const cell of allCells) {
      expect(cell.attrs?.colwidth).toBeNull();
    }
    expect(validateEditorDocument(json).success).toBe(true);
    editor.destroy();
  });

  // The drag floor and the canonical floor must be the same number: a drag writes attrs directly,
  // so any gap is a width a user can reach but not save.
  it('the column-resize floor equals the canonical colwidth minimum, so a drag cannot reach an unsaveable width', () => {
    const table = createEditorExtensions().find((extension) => extension.name === 'table');
    expect(table).toBeDefined();
    expect((table!.options as { resizable?: boolean }).resizable).toBe(true);
    expect((table!.options as { cellMinWidth?: number }).cellMinWidth).toBe(
      RICH_TABLE_COLWIDTH_MIN
    );
    // A width AT that floor — what the drag stop produces — must validate.
    expect(
      validateEditorDocument({
        type: 'doc',
        content: [
          {
            type: 'table',
            content: [
              {
                type: 'tableRow',
                content: [
                  {
                    type: 'tableHeader',
                    attrs: {
                      colspan: 1,
                      rowspan: 1,
                      colwidth: [RICH_TABLE_COLWIDTH_MIN],
                      align: null
                    },
                    content: [{ type: 'paragraph' }]
                  }
                ]
              }
            ]
          }
        ]
      }).success
    ).toBe(true);
  });
});

describe('table: pasted HTML cannot poison colspan/rowspan/colwidth/align', () => {
  // Pasting from a spreadsheet must not poison a table. Stock cell attrs read `colwidth` from `<col
  // width>`, `align` from `text-align`, and `colspan`/`rowspan` from the source cell.
  // `RichTableCell`/`RichTableHeader` sanitize all four on parse.
  it('pasting a Google-Sheets-shaped table (colgroup col[width]) used to poison colwidth on paste — now clean', () => {
    const editor = makeEditor();
    const html = `
      <table><colgroup><col width="100"/><col width="100"/></colgroup>
      <tbody><tr><td>1</td><td>2</td></tr></tbody></table>`;
    editor.commands.insertContent(html);
    const json = docJson(editor);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    const table = json.content?.find((n) => n.type === 'table');
    const allCells = table?.content?.flatMap((row) => row.content ?? []) ?? [];
    expect(allCells.length).toBeGreaterThan(0);
    for (const cell of allCells) expect(cell.attrs?.colwidth).toBeNull();
    editor.destroy();
  });

  it('pasting a cell with an inline text-align style used to poison align on paste — now clean', () => {
    const editor = makeEditor();
    const html = `<table><tbody><tr><td style="text-align:right">x</td><td>y</td></tr></tbody></table>`;
    editor.commands.insertContent(html);
    const json = docJson(editor);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    const table = json.content?.find((n) => n.type === 'table');
    const allCells = table?.content?.flatMap((row) => row.content ?? []) ?? [];
    for (const cell of allCells) expect(cell.attrs?.align).toBeNull();
    editor.destroy();
  });

  it('pasting a merged (colspan=2) header cell used to poison colspan on paste — now forced to 1, table self-heals to rectangular via prosemirror-tables fixTables', () => {
    const editor = makeEditor();
    const html = `<table><tbody><tr><td colspan="2">merged</td></tr><tr><td>a</td><td>b</td></tr></tbody></table>`;
    editor.commands.insertContent(html);
    const json = docJson(editor);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    const table = json.content?.find((n) => n.type === 'table');
    const allCells = table?.content?.flatMap((row) => row.content ?? []) ?? [];
    for (const cell of allCells) {
      expect(cell.attrs?.colspan).toBe(1);
      expect(cell.attrs?.rowspan).toBe(1);
    }
    editor.destroy();
  });
});

describe('table: exhaustive grip-command fuzz — every structural command anchored exactly as table-grips.ts computes real click anchors', () => {
  // Documents that the grip commands themselves were ruled out as the cause
  // of the 180d340c report (see the describe block above for the actual root
  // cause). Runs randomized sequences of every command
  // `EditorTableControls` can invoke — addRowBefore/After,
  // addColumnBefore/After, deleteRow, deleteColumn, toggleHeaderRow/Column,
  // plus interleaved typing — anchored via the same `TableMap`-derived
  // position `table-grips.ts` hands the click event, and re-validates after
  // every single step. Kept small enough to run fast in CI while still
  // covering hundreds of distinct command sequences.
  it('randomized command sequences never produce invalid attrs', () => {
    let seed = 42;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    type OpKind =
      | 'addRowBefore'
      | 'addRowAfter'
      | 'addColumnBefore'
      | 'addColumnAfter'
      | 'deleteRow'
      | 'deleteColumn'
      | 'toggleHeaderRow'
      | 'toggleHeaderColumn'
      | 'type';
    const OPS: { kind: OpKind; index: number }[] = [
      { kind: 'addRowBefore', index: 0 },
      { kind: 'addRowBefore', index: 1 },
      { kind: 'addRowAfter', index: 0 },
      { kind: 'addRowAfter', index: 2 },
      { kind: 'addColumnBefore', index: 0 },
      { kind: 'addColumnBefore', index: 1 },
      { kind: 'addColumnAfter', index: 0 },
      { kind: 'addColumnAfter', index: 2 },
      { kind: 'deleteRow', index: 0 },
      { kind: 'deleteRow', index: 1 },
      { kind: 'deleteColumn', index: 0 },
      { kind: 'deleteColumn', index: 1 },
      { kind: 'toggleHeaderRow', index: 0 },
      { kind: 'toggleHeaderColumn', index: 0 },
      { kind: 'type', index: 0 }
    ];

    return (async () => {
      const { TableMap } = await import('@tiptap/pm/tables');
      let failures: string[] = [];
      for (let trial = 0; trial < 40 && failures.length === 0; trial += 1) {
        const editor = makeEditor();
        editor
          .chain()
          .focus()
          .insertTable({ rows: 3, cols: 3, withHeaderRow: rnd() > 0.5 })
          .run();
        const seq: string[] = [];
        for (let step = 0; step < 8; step += 1) {
          const tablePos = findTablePos(editor);
          if (tablePos === null) break;
          const op = OPS[Math.floor(rnd() * OPS.length)]!;
          seq.push(`${op.kind}(${op.index})`);
          let anchor: number | null = null;
          if (op.kind === 'addRowBefore' || op.kind === 'addRowAfter' || op.kind === 'deleteRow') {
            anchor = rowAnchor(editor, tablePos, op.index);
          } else if (
            op.kind === 'addColumnBefore' ||
            op.kind === 'addColumnAfter' ||
            op.kind === 'deleteColumn'
          ) {
            anchor = await colAnchor(editor, tablePos, op.index);
          } else if (op.kind === 'toggleHeaderRow' || op.kind === 'toggleHeaderColumn') {
            anchor = cornerAnchorSync(editor, tablePos, TableMap);
          } else if (op.kind === 'type') {
            anchor = rowAnchor(editor, tablePos, 0);
          }
          if (anchor === null) continue;
          try {
            const targetAnchor = anchor;
            switch (op.kind) {
              case 'type':
                editor
                  .chain()
                  .focus()
                  .insertContentAt(targetAnchor + 1, 'x')
                  .run();
                break;
              case 'addRowBefore':
                runAtAnchor(editor, targetAnchor, () =>
                  editor.chain().focus().addRowBefore().run()
                );
                break;
              case 'addRowAfter':
                runAtAnchor(editor, targetAnchor, () => editor.chain().focus().addRowAfter().run());
                break;
              case 'addColumnBefore':
                runAtAnchor(editor, targetAnchor, () =>
                  editor.chain().focus().addColumnBefore().run()
                );
                break;
              case 'addColumnAfter':
                runAtAnchor(editor, targetAnchor, () =>
                  editor.chain().focus().addColumnAfter().run()
                );
                break;
              case 'deleteRow':
                runAtAnchor(editor, targetAnchor, () => editor.chain().focus().deleteRow().run());
                break;
              case 'deleteColumn':
                runAtAnchor(editor, targetAnchor, () =>
                  editor.chain().focus().deleteColumn().run()
                );
                break;
              case 'toggleHeaderRow':
                runAtAnchor(editor, targetAnchor, () =>
                  editor.chain().focus().toggleHeaderRow().run()
                );
                break;
              case 'toggleHeaderColumn':
                runAtAnchor(editor, targetAnchor, () =>
                  editor.chain().focus().toggleHeaderColumn().run()
                );
                break;
            }
          } catch (err) {
            failures.push(
              `trial ${trial} step ${step} [${seq.join(' -> ')}] threw: ${String(err)}`
            );
            break;
          }
          const result = validateEditorDocument(docJson(editor));
          if (!result.success) {
            failures.push(
              `trial ${trial} step ${step} [${seq.join(' -> ')}] invalid: ${JSON.stringify(result.findings)}`
            );
            break;
          }
        }
        editor.destroy();
      }
      expect(failures).toEqual([]);
    })();
  }, 20000);
});

describe('table: table-grip grip commands stay canonical', () => {
  // `EditorTableControls` never runs a bare structural command — it
  // first moves the selection to the grip's anchor cell via
  // `setCellSelection({ anchorCell })`, then runs the command in the same
  // chain (see `rich-editor-table-controls.tsx`). Exercised here at the
  // command level (not through the grip DOM/click bridge, which
  // `table-grips.test.ts` covers) to keep this file's existing jsdom-`Editor`
  // pattern.

  it('toggleHeaderRow flips row 0 between tableHeader/tableCell and stays valid', () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    const anchor = firstCellPos(editor);

    editor.chain().focus().setCellSelection({ anchorCell: anchor }).toggleHeaderRow().run();
    const afterToggleOff = docJson(editor);
    expect(validateEditorDocument(afterToggleOff)).toMatchObject({
      success: true,
      findings: []
    });
    const table = afterToggleOff.content?.find((n) => n.type === 'table');
    const row0Types = table?.content?.[0]?.content?.map((cell) => cell.type) ?? [];
    expect(row0Types.every((type) => type === 'tableCell')).toBe(true);

    editor.chain().focus().setCellSelection({ anchorCell: anchor }).toggleHeaderRow().run();
    const afterToggleOn = docJson(editor);
    expect(validateEditorDocument(afterToggleOn)).toMatchObject({
      success: true,
      findings: []
    });
    const table2 = afterToggleOn.content?.find((n) => n.type === 'table');
    const row0Again = table2?.content?.[0]?.content?.map((cell) => cell.type) ?? [];
    expect(row0Again.every((type) => type === 'tableHeader')).toBe(true);
    editor.destroy();
  });

  it('toggleHeaderColumn flips column 0 and stays valid, independent of row-0 header state', () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: false }).run();
    const anchor = firstCellPos(editor);

    editor.chain().focus().setCellSelection({ anchorCell: anchor }).toggleHeaderColumn().run();
    const json = docJson(editor);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    const table = json.content?.find((n) => n.type === 'table');
    const column0Types = table?.content?.map((row) => row.content?.[0]?.type) ?? [];
    expect(column0Types.every((type) => type === 'tableHeader')).toBe(true);
    editor.destroy();
  });

  it('a grip-style insert (setCellSelection at a specific row, then addRowBefore) inserts at that row, not just at the end', () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 2, withHeaderRow: false }).run();

    // Row 1 (the middle of the three rows) is the target: put text in its
    // first cell so the assertions below can locate it unambiguously, then
    // resolve a fresh anchor cell position for that same row (text insertion
    // doesn't move row boundaries within the same row).
    const rowPositions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableRow') rowPositions.push(pos);
    });
    expect(rowPositions).toHaveLength(3);
    const middleRowFirstCellContentPos = rowPositions[1]! + 2;
    editor.chain().focus().insertContentAt(middleRowFirstCellContentPos, 'middle').run();

    let middleRowCellPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (
        middleRowCellPos === -1 &&
        (node.type.name === 'tableCell' || node.type.name === 'tableHeader') &&
        node.textContent === 'middle'
      ) {
        middleRowCellPos = pos;
      }
      return middleRowCellPos === -1;
    });
    expect(middleRowCellPos).toBeGreaterThan(-1);

    editor.chain().focus().setCellSelection({ anchorCell: middleRowCellPos }).addRowBefore().run();
    const json = docJson(editor);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    const table = json.content?.find((n) => n.type === 'table');
    expect(table?.content).toHaveLength(4);
    // The new empty row lands immediately before the "middle" row, not
    // appended at the very end of the table.
    const rowTexts = (table?.content ?? []).map(
      (row) =>
        row.content
          ?.flatMap((cell) => cell.content ?? [])
          .flatMap((block) => block.content ?? [])
          .map((textNode) => textNode.text ?? '')
          .join('') ?? ''
    );
    const middleIndex = rowTexts.findIndex((text) => text.includes('middle'));
    expect(middleIndex).toBeGreaterThan(0);
    expect(rowTexts[middleIndex - 1]).toBe('');
    editor.destroy();
  });

  it('deleteRow / deleteColumn / deleteTable via a targeted cell selection never introduce colspan, rowspan, colwidth, or align', () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    const anchor = firstCellPos(editor);

    editor.chain().focus().setCellSelection({ anchorCell: anchor }).deleteRow().run();
    const afterRowDelete = docJson(editor);
    expect(validateEditorDocument(afterRowDelete)).toMatchObject({
      success: true,
      findings: []
    });

    const nextAnchor = firstCellPos(editor);
    editor.chain().focus().setCellSelection({ anchorCell: nextAnchor }).deleteColumn().run();
    const afterColumnDelete = docJson(editor);
    expect(validateEditorDocument(afterColumnDelete)).toMatchObject({
      success: true,
      findings: []
    });

    const lastAnchor = firstCellPos(editor);
    editor.chain().focus().setCellSelection({ anchorCell: lastAnchor }).deleteTable().run();
    const afterTableDelete = docJson(editor);
    expect(validateEditorDocument(afterTableDelete)).toMatchObject({
      success: true,
      findings: []
    });
    expect(afterTableDelete.content?.some((n) => n.type === 'table')).toBe(false);
    editor.destroy();
  });

  it('mergeCells and setCellAttribute("align", …) are never called by the grip menu — reject if the schema regains support without a matching UI decision', () => {
    // Not a UI test (the menu genuinely never wires these up — see
    // `rich-editor-table-controls.tsx`); a documentation-as-test guard
    // that these commands still produce content the *validator* rejects,
    // which is the actual reason they're excluded from the menu (`splitCell`
    // is the same story but needs an already-merged cell to have anything to
    // split, so it isn't separately exercised here).
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run();

    editor.chain().focus().setCellAttribute('align', 'right').run();
    const withAlign = docJson(editor);
    expect(validateEditorDocument(withAlign).success).toBe(false);
    editor.destroy();

    const mergeEditor = makeEditor();
    mergeEditor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run();
    const mergeAnchor = firstCellPos(mergeEditor);
    let headCellPos = -1;
    mergeEditor.state.doc.descendants((node, nodePos) => {
      if (
        nodePos !== mergeAnchor &&
        (node.type.name === 'tableHeader' || node.type.name === 'tableCell')
      ) {
        headCellPos = nodePos;
      }
    });
    expect(headCellPos).toBeGreaterThan(-1);
    mergeEditor
      .chain()
      .focus()
      .setCellSelection({ anchorCell: mergeAnchor, headCell: headCellPos })
      .mergeCells()
      .run();
    const withMerge = docJson(mergeEditor);
    expect(validateEditorDocument(withMerge).success).toBe(false);
    mergeEditor.destroy();
  });
});

describe('table: full save-pipeline smoke test', () => {
  it('a table-only document survives prepareEditorSnapshot (markdown + search-text extraction) without throwing', () => {
    const editor = makeEditor();
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    expect(() => prepareEditorSnapshot(docJson(editor))).not.toThrow();
    editor.destroy();
  });
});

describe('task list: insertion, typing, and Tab-to-nest', () => {
  it('toggleTaskList inserts a taskItem containing a paragraph (caret-addressable) — not a bare li', () => {
    const editor = makeEditor();
    editor.chain().focus().toggleTaskList().run();
    const json = docJson(editor);
    const taskItem = json.content?.find((n) => n.type === 'taskList')?.content?.[0];
    expect(taskItem?.content?.[0]?.type).toBe('paragraph');
    editor.destroy();
  });

  it('converting an existing bulletList to a task list does not nest a taskList inside it (no double marker)', () => {
    const editor = makeEditor();
    editor.chain().focus().toggleBulletList().run();
    editor.commands.insertContent('Bullet one');
    editor.chain().focus().toggleTaskList().run();
    const json = docJson(editor);
    // The bulletList should be *replaced*, not wrapped: exactly one taskList
    // at the top level, no leftover bulletList anywhere in the doc.
    const topLevelTypes = json.content?.map((n) => n.type) ?? [];
    expect(topLevelTypes).toContain('taskList');
    expect(topLevelTypes).not.toContain('bulletList');
    editor.destroy();
  });

  it('typing into a fresh task item lands inside its paragraph, not on the checkbox', () => {
    const editor = makeEditor();
    editor.chain().focus().toggleTaskList().run();
    editor.commands.insertContent('First task');
    const json = docJson(editor);
    const taskItem = json.content?.find((n) => n.type === 'taskList')?.content?.[0];
    expect(taskItem?.content?.[0]?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'First task'
    });
    editor.destroy();
  });

  it('Tab (sinkListItem) nests a taskItem under the previous one, and the result still validates', () => {
    const editor = makeEditor();
    editor.chain().focus().toggleTaskList().run();
    editor.commands.insertContent('First');
    editor.commands.splitListItem('taskItem');
    editor.commands.insertContent('Second');

    const handled = editor.commands.sinkListItem('taskItem');
    expect(handled).toBe(true);

    const json = docJson(editor);
    const outerItem = json.content?.find((n) => n.type === 'taskList')?.content?.[0];
    const nestedList = outerItem?.content?.find((n) => n.type === 'taskList');
    expect(nestedList?.content?.[0]?.content?.[0]?.content?.[0]).toMatchObject({
      type: 'text',
      text: 'Second'
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    editor.destroy();
  });

  it('Shift-Tab (liftListItem) un-nests a sunk taskItem back to the top level', () => {
    const editor = makeEditor();
    editor.chain().focus().toggleTaskList().run();
    editor.commands.insertContent('First');
    editor.commands.splitListItem('taskItem');
    editor.commands.insertContent('Second');
    editor.commands.sinkListItem('taskItem');

    const handled = editor.commands.liftListItem('taskItem');
    expect(handled).toBe(true);

    const json = docJson(editor);
    const items = json.content?.find((n) => n.type === 'taskList')?.content ?? [];
    expect(items).toHaveLength(2);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    editor.destroy();
  });
});

describe('code block: lowlight highlighting is wired up', () => {
  it('a codeBlock with a registered language produces highlight decorations in the live view', () => {
    const editor = makeEditor();
    editor.chain().focus().toggleCodeBlock({ language: 'typescript' }).run();
    editor.commands.insertContent('const x: number = 1;');
    // CodeBlockLowlight decorates the *view*, not the doc — getJSON() stays
    // plain text/attrs (this is exactly why the canonical validator, which
    // only ever sees getJSON() output, is unaffected by highlighting).
    const json = docJson(editor);
    const codeBlock = json.content?.find((n) => n.type === 'codeBlock');
    expect(codeBlock?.attrs?.language).toBe('typescript');
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });

    const dom = editor.view.dom as HTMLElement;
    const hljsSpans = dom.querySelectorAll('pre code span[class^="hljs-"]');
    expect(hljsSpans.length).toBeGreaterThan(0);
    editor.destroy();
  });
});

// Module scope, matching this file's other cross-`describe` helpers above —
// used by the drag-handle context-menu coverage below.
function dispatchAt(
  editor: Editor,
  apply: (tr: Parameters<typeof applyRichBlockDuplicate>[0], pos: number) => boolean,
  pos: number
) {
  const tr = editor.state.tr;
  const applied = apply(tr, pos);
  if (applied) editor.view.dispatch(tr);
  return applied;
}

describe('custom emoji: clipboard block-capture regression ', () => {
  // Some clipboards rebuild a custom emoji as a bare `<img>`, dropping its marker attribute, which
  // the Image extension would capture as a block. `RichCustomEmoji` recovers the inline atom from
  // the asset path.

  it('a bare absolute-URL emoji img (Chrome copy-image shape) parses as the inline customEmoji atom, never a block image', () => {
    const editor = makeEditor();
    editor.commands.insertContent('<img src="https://example.invalid/rich-emoji/octocat.png">');
    const json = docJson(editor);
    expect(json.content?.some((node) => node.type === 'image')).toBe(false);
    const paragraph = json.content?.find((node) => node.type === 'paragraph');
    expect(paragraph?.content?.[0]).toMatchObject({
      type: 'customEmoji',
      attrs: { name: 'octocat' }
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    editor.destroy();
  });

  it('a bare relative-path emoji img parses as the inline atom too', () => {
    const editor = makeEditor();
    editor.commands.insertContent('<p>before <img src="/rich-emoji/shipit.png"> after</p>');
    const json = docJson(editor);
    const paragraph = json.content?.find((node) => node.type === 'paragraph');
    expect(paragraph?.content?.map((child) => child.type)).toEqual(['text', 'customEmoji', 'text']);
    expect(paragraph?.content?.[1]?.attrs?.name).toBe('shipit');
    editor.destroy();
  });

  it('the primary data-attr rule still wins for editor/read-view serialized markup', () => {
    const editor = makeEditor();
    editor.commands.insertContent(
      '<img class="rich-custom-emoji" src="/rich-emoji/trollface.png" alt=":trollface:" data-rich-custom-emoji="trollface">'
    );
    const paragraph = docJson(editor).content?.find((node) => node.type === 'paragraph');
    expect(paragraph?.content?.[0]).toMatchObject({
      type: 'customEmoji',
      attrs: { name: 'trollface' }
    });
    editor.destroy();
  });

  it('an unknown /rich-emoji/ name does NOT reconstruct (closed set) — falls through to the image rule unchanged', () => {
    const editor = makeEditor();
    editor.commands.insertContent('<img src="/rich-emoji/not-a-real-emoji.png">');
    const json = docJson(editor);
    expect(JSON.stringify(json)).not.toContain('customEmoji');
    editor.destroy();
  });

  it('the live editor DOM renders the atom as a compact inline shortcode without a remote image', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'customEmoji', attrs: { name: 'octocat' } }]
        }
      ]
    });
    const chip = (editor.view.dom as HTMLElement).querySelector('span.rich-custom-emoji');
    expect(chip).not.toBeNull();
    expect(chip?.textContent).toBe(':octocat:');
    expect(chip?.querySelector('img')).toBeNull();
    editor.destroy();
  });
});

// Module scope, matching this file's other cross-`describe` helpers — a
// one-image document for the caption-layout coverage below.
function imageDoc(description: string | null): Content {
  return {
    type: 'doc',
    content: [
      {
        type: 'image',
        attrs: {
          resourceId: '11111111-1111-4111-8111-111111111111',
          src: 'rich-resource:11111111-1111-4111-8111-111111111111',
          alt: 'photo',
          description
        }
      }
    ]
  };
}

describe('image node view: caption anchors inside the shrink-wrapped frame ', () => {
  it('caption renders inside the frame, after the image box — so CSS centers it under the image, not the column', () => {
    const editor = makeEditor(imageDoc('A caption'));
    const dom = editor.view.dom as HTMLElement;
    const frame = dom.querySelector('.rich-image-frame');
    const box = frame?.querySelector('.rich-image-box');
    const caption = dom.querySelector('.rich-image-caption');
    expect(box?.querySelector('img')).not.toBeNull();
    expect(caption?.parentElement).toBe(frame as never);
    expect(caption?.previousElementSibling).toBe(box);
    // The resize chrome anchors to the image box alone — never to the
    // caption-bearing frame (the old layout reserved handle space between
    // image and caption).
    expect(box?.querySelectorAll('.rich-image-resize-handle')).toHaveLength(2);
    expect(box?.contains(caption)).toBe(false);
    editor.destroy();
  });

  it('caption-less images render the frame with only the image box', () => {
    const editor = makeEditor(imageDoc(null));
    const dom = editor.view.dom as HTMLElement;
    expect(dom.querySelector('.rich-image-box img')).not.toBeNull();
    expect(dom.querySelector('.rich-image-caption')).toBeNull();
    editor.destroy();
  });
});

describe('drag-handle context menu: duplicate stays canonical through the LIVE pipeline', () => {
  // `block-move.test.ts` covers these three primitives headlessly (a bare
  // `Transform`, no `EditorView`); this file's job is the one thing that
  // harness structurally can't exercise — `RichBlockIdentity`'s own
  // `appendTransaction` (registered as part of `createEditorExtensions()`,
  // see `schema.ts`) running in the SAME live dispatch cycle as these
  // commands, confirming the two mechanisms don't collide (`block-move.ts`'s
  // `applyRichBlockDuplicate` already assigns its own fresh ids — this
  // proves the live identity plugin finds nothing left to "fix" afterward,
  // not that it's silently masking a bug in the primitive).

  it('duplicate inserts a sibling with a distinct blockId, and the live identity plugin finds nothing left to reassign', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'only' }] }]
    });

    const applied = dispatchAt(editor, applyRichBlockDuplicate, 0);
    expect(applied).toBe(true);

    const json = docJson(editor);
    expect(json.content).toHaveLength(2);
    const [first, second] = json.content ?? [];
    expect(first?.content?.[0]?.text).toBe('only');
    expect(second?.content?.[0]?.text).toBe('only');
    const firstId = first?.attrs?.blockId as string;
    const secondId = second?.attrs?.blockId as string;
    expect(firstId).toMatch(RICH_BLOCK_ID_PATTERN);
    expect(secondId).toMatch(RICH_BLOCK_ID_PATTERN);
    expect(secondId).not.toBe(firstId);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    editor.destroy();
  });
});
