import { getSchema } from '@tiptap/core';
import { Transform } from '@tiptap/pm/transform';
import { describe, expect, it } from 'bun:test';

import { generateRichBlockId, RICH_BLOCK_ID_PATTERN } from '../src/block-identity.ts';
import {
  applyRichBlockDelete,
  applyRichBlockDuplicate,
  applyRichBlockMove,
  applyRichBlockResetFormatting
} from '../src/block-move.ts';
import { createEditorExtensions } from '../src/schema.ts';
import type { EditorDocument, EditorNode } from '../src/types.ts';
import { validateEditorDocument } from '../src/validation.ts';

/**
 * Headless coverage (no jsdom, no live `EditorView`) for the block-move
 * transform primitive that backs `editor/drag-handle.ts`'s reorder gesture —
 * `getSchema()` + `schema.nodeFromJSON()` + a bare `Transform` is enough,
 * matching `editor-contract.test.ts`'s pattern for exercising the schema
 * without mounting a browser DOM.
 */
const schema = getSchema(createEditorExtensions());

function paragraph(blockId: string, text: string): EditorNode {
  return { type: 'paragraph', attrs: { blockId }, content: [{ type: 'text', text }] };
}

function threeParagraphDoc(): { doc: EditorDocument; ids: [string, string, string] } {
  const ids: [string, string, string] = [
    generateRichBlockId(),
    generateRichBlockId(),
    generateRichBlockId()
  ];
  return {
    doc: {
      type: 'doc',
      content: [paragraph(ids[0], 'first'), paragraph(ids[1], 'second'), paragraph(ids[2], 'third')]
    },
    ids
  };
}

function paragraphTexts(json: EditorDocument): string[] {
  return (json.content ?? []).map((node) => node.content?.[0]?.text ?? '');
}

function paragraphBlockIds(json: EditorDocument): (string | undefined)[] {
  return (json.content ?? []).map((node) => node.attrs?.blockId as string | undefined);
}

function collectBlockIds(node: EditorNode, out: string[] = []): string[] {
  if (typeof node.attrs?.blockId === 'string') out.push(node.attrs.blockId);
  for (const child of node.content ?? []) collectBlockIds(child, out);
  return out;
}

describe('applyRichBlockMove', () => {
  it('moves the first block to the end, preserving its blockId', () => {
    const { doc, ids } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    // Source: the first paragraph, at pos 0. Target: past the end of the doc.
    const moved = applyRichBlockMove(tr, 0, pmDoc.content.size);
    expect(moved).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(paragraphTexts(json)).toEqual(['second', 'third', 'first']);
    expect(paragraphBlockIds(json)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it('moves the last block to the front, preserving its blockId', () => {
    const { doc, ids } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const thirdPos = pmDoc.content.firstChild!.nodeSize + pmDoc.content.child(1).nodeSize;
    const moved = applyRichBlockMove(tr, thirdPos, 0);
    expect(moved).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(paragraphTexts(json)).toEqual(['third', 'first', 'second']);
    expect(paragraphBlockIds(json)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it('moves the middle block to the front', () => {
    const { doc, ids } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const secondPos = pmDoc.content.firstChild!.nodeSize;
    const moved = applyRichBlockMove(tr, secondPos, 0);
    expect(moved).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(paragraphTexts(json)).toEqual(['second', 'first', 'third']);
    expect(paragraphBlockIds(json)).toEqual([ids[1], ids[0], ids[2]]);
  });

  it('is a no-op when the target is immediately before the source (dropping onto its own gap)', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const moved = applyRichBlockMove(tr, 0, 0);
    expect(moved).toBe(false);
    expect(tr.doc.eq(pmDoc)).toBe(true);
  });

  it('is a no-op when the target is immediately after the source (dropping onto its own trailing gap)', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const firstSize = pmDoc.content.firstChild!.nodeSize;
    const moved = applyRichBlockMove(tr, 0, firstSize);
    expect(moved).toBe(false);
    expect(tr.doc.eq(pmDoc)).toBe(true);
  });

  it('returns false for a source position with no node', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const moved = applyRichBlockMove(tr, pmDoc.content.size + 50, 0);
    expect(moved).toBe(false);
  });

  it('preserves every descendant blockId when moving a multi-cell table (not just the table node itself)', () => {
    const paragraphId = generateRichBlockId();
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        paragraph(paragraphId, 'lead paragraph'),
        {
          type: 'table',
          attrs: { blockId: generateRichBlockId() },
          content: [
            {
              type: 'tableRow',
              attrs: { blockId: generateRichBlockId() },
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h1' }] }]
                },
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h2' }] }]
                }
              ]
            }
          ]
        }
      ]
    };
    const pmDoc = schema.nodeFromJSON(doc);
    const idsBefore = collectBlockIds(pmDoc.toJSON() as EditorNode).toSorted();

    const tr = new Transform(pmDoc);
    const tablePos = pmDoc.content.firstChild!.nodeSize;
    const moved = applyRichBlockMove(tr, tablePos, 0);
    expect(moved).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(json.content?.[0]?.type).toBe('table');
    expect(json.content?.[1]?.type).toBe('paragraph');
    const idsAfter = collectBlockIds(json).toSorted();
    expect(idsAfter).toEqual(idsBefore);
    for (const id of idsAfter) expect(id).toMatch(RICH_BLOCK_ID_PATTERN);
  });

  it('the resulting document always passes canonical validation after a move', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);
    applyRichBlockMove(tr, 0, pmDoc.content.size);

    const json = tr.doc.toJSON() as EditorDocument;
    const result = validateEditorDocument(json);
    expect(result).toMatchObject({ success: true, findings: [] });
  });
});

/**
 * Drag-handle menu actions: Delete, Duplicate and Reset formatting. Headless `Transform` tests;
 * each result must pass `validateEditorDocument`.
 */
describe('applyRichBlockDelete', () => {
  it('deletes a top-level block when other blocks remain', () => {
    const { doc, ids } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const secondPos = pmDoc.content.firstChild!.nodeSize;
    const deleted = applyRichBlockDelete(tr, secondPos);
    expect(deleted).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(paragraphTexts(json)).toEqual(['first', 'third']);
    expect(paragraphBlockIds(json)).toEqual([ids[0], ids[2]]);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
  });

  it('replaces the sole remaining block with an empty paragraph instead of emptying the doc', () => {
    const blockId = generateRichBlockId();
    const doc: EditorDocument = { type: 'doc', content: [paragraph(blockId, 'only one')] };
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const deleted = applyRichBlockDelete(tr, 0);
    expect(deleted).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(json.content).toHaveLength(1);
    expect(json.content?.[0]?.type).toBe('paragraph');
    expect(json.content?.[0]?.content ?? []).toEqual([]);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
  });

  it('returns false for a position with no node', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    expect(applyRichBlockDelete(tr, pmDoc.content.size + 50)).toBe(false);
  });
});

describe('applyRichBlockDuplicate', () => {
  it('inserts a copy of the block immediately after itself', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const secondPos = pmDoc.content.firstChild!.nodeSize;
    const duplicated = applyRichBlockDuplicate(tr, secondPos);
    expect(duplicated).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(paragraphTexts(json)).toEqual(['first', 'second', 'second', 'third']);
  });

  it('gives the duplicate a fresh blockId, distinct from the original, on every descendant', () => {
    const paragraphId = generateRichBlockId();
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        paragraph(paragraphId, 'lead paragraph'),
        {
          type: 'table',
          attrs: { blockId: generateRichBlockId() },
          content: [
            {
              type: 'tableRow',
              attrs: { blockId: generateRichBlockId() },
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colspan: 1, rowspan: 1, colwidth: null, align: null },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'h1' }] }]
                }
              ]
            }
          ]
        }
      ]
    };
    const pmDoc = schema.nodeFromJSON(doc);
    const idsBefore = collectBlockIds(pmDoc.toJSON() as EditorNode).toSorted();

    const tr = new Transform(pmDoc);
    const tablePos = pmDoc.content.firstChild!.nodeSize;
    const duplicated = applyRichBlockDuplicate(tr, tablePos);
    expect(duplicated).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    const idsAfter = collectBlockIds(json).toSorted();
    // Every id from before is still present exactly once (the originals are
    // untouched) plus a fresh id per block-identity node in the duplicated
    // subtree (table + tableRow, 2 more than before) — no id repeats.
    expect(idsAfter).toHaveLength(idsBefore.length + 2);
    expect(new Set(idsAfter).size).toBe(idsAfter.length);
    for (const id of idsBefore) expect(idsAfter).toContain(id);
    for (const id of idsAfter) expect(id).toMatch(RICH_BLOCK_ID_PATTERN);
  });

  it('the resulting document always passes canonical validation after a duplicate', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);
    applyRichBlockDuplicate(tr, 0);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
  });

  it('returns false for a position with no node', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    expect(applyRichBlockDuplicate(tr, pmDoc.content.size + 50)).toBe(false);
  });
});

describe('applyRichBlockResetFormatting', () => {
  it('strips inline marks from the block while leaving its text and blockId intact', () => {
    const blockId = generateRichBlockId();
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId },
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'linked',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }]
            }
          ]
        }
      ]
    };
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const reset = applyRichBlockResetFormatting(tr, 0);
    expect(reset).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    const para = json.content?.[0];
    expect(para?.attrs?.blockId).toBe(blockId);
    expect(para?.content?.map((node) => node.text).join('')).toBe('bold and linked');
    expect(para?.content?.every((node) => !node.marks || node.marks.length === 0)).toBe(true);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
  });

  it('clears marks on nested descendants too (e.g. inside a callout)', () => {
    const doc: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'callout',
          attrs: { kind: 'note', title: null },
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'strong', marks: [{ type: 'bold' }] }]
            }
          ]
        }
      ]
    };
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    expect(applyRichBlockResetFormatting(tr, 0)).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    const innerText = json.content?.[0]?.content?.[0]?.content?.[0];
    expect(innerText?.marks ?? []).toEqual([]);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
  });

  it('is a no-op on an atom node (nothing to clear)', () => {
    const doc: EditorDocument = { type: 'doc', content: [{ type: 'horizontalRule' }] };
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    expect(applyRichBlockResetFormatting(tr, 0)).toBe(false);
  });

  it('returns false for a position with no node', () => {
    const { doc } = threeParagraphDoc();
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    expect(applyRichBlockResetFormatting(tr, pmDoc.content.size + 50)).toBe(false);
  });
});
