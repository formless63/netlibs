import { getSchema } from '@tiptap/core';
import { Transform } from '@tiptap/pm/transform';
import { describe, expect, it } from 'bun:test';

import { generateRichBlockId } from '../src/block-identity.ts';
import { createEditorExtensions } from '../src/schema.ts';
import { applyRichTaskItemPromote, resolveRichTaskItemPromoteTarget } from '../src/task-promote.ts';
import type { EditorDocument, EditorNode } from '../src/types.ts';
import { validateEditorDocument } from '../src/validation.ts';

/**
 * Headless coverage (no jsdom, no live `EditorView`) for the promote
 * transform primitive that backs `RichTaskItemPromoteMenu` — same
 * `getSchema()` + `schema.nodeFromJSON()` + bare `Transform`/`ResolvedPos`
 * harness `block-move.test.ts` uses for `applyRichBlockMove`.
 */
const schema = getSchema(createEditorExtensions());

function taskItem(
  blockId: string,
  text: string,
  content: EditorNode[] = []
): EditorNode {
  return {
    type: 'taskItem',
    attrs: { blockId, checked: false, authority: 'document_local' },
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }, ...content]
  };
}

function taskListDoc(items: EditorNode[]): EditorDocument {
  return { type: 'doc', content: [{ type: 'taskList', content: items }] };
}

/** Doc position immediately inside the first text node whose text equals `text` — robust against manual nodeSize/offset arithmetic. */
function positionInsideText(pmDoc: ReturnType<typeof schema.nodeFromJSON>, text: string): number {
  let found = -1;
  pmDoc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos + 1;
  });
  if (found === -1) throw new Error(`No text node "${text}" found`);
  return found;
}

describe('resolveRichTaskItemPromoteTarget', () => {
  it('resolves the enclosing taskItem/taskList pair, index, text, and blockId', () => {
    const ids = [generateRichBlockId(), generateRichBlockId(), generateRichBlockId()];
    const doc = taskListDoc([
      taskItem(ids[0]!, 'first'),
      taskItem(ids[1]!, 'second'),
      taskItem(ids[2]!, 'third')
    ]);
    const pmDoc = schema.nodeFromJSON(doc);
    const $pos = pmDoc.resolve(positionInsideText(pmDoc, 'second'));

    const target = resolveRichTaskItemPromoteTarget($pos);
    expect(target).not.toBeNull();
    expect(target!.itemIndex).toBe(1);
    expect(target!.itemText).toBe('second');
    expect(target!.editorNodeId).toBe(ids[1]);
    expect(target!.hasNestedChecklist).toBe(false);
    expect(target!.listPos).toBe(0);
  });

  it('detects a nested checklist and excludes its text from itemText', () => {
    const parentId = generateRichBlockId();
    const childId = generateRichBlockId();
    const doc = taskListDoc([
      taskItem(parentId, 'parent item', [
        { type: 'taskList', content: [taskItem(childId, 'child item')] }
      ])
    ]);
    const pmDoc = schema.nodeFromJSON(doc);
    const $pos = pmDoc.resolve(positionInsideText(pmDoc, 'parent item'));

    const target = resolveRichTaskItemPromoteTarget($pos);
    expect(target).not.toBeNull();
    expect(target!.hasNestedChecklist).toBe(true);
    expect(target!.itemText).toBe('parent item');
  });

  it('returns null outside a taskItem', () => {
    const pmDoc = schema.nodeFromJSON({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }]
    });
    expect(resolveRichTaskItemPromoteTarget(pmDoc.resolve(1))).toBeNull();
  });
});

describe('applyRichTaskItemPromote', () => {
  it('promotes the only item in a list: the taskList is replaced entirely by the taskReference', () => {
    const id = generateRichBlockId();
    const doc = taskListDoc([taskItem(id, 'only item')]);
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const applied = applyRichTaskItemPromote(tr, 0, 0, {
      taskId: 'task-1',
      fallbackTitle: 'only item'
    });
    expect(applied).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(json.content).toEqual([
      {
        type: 'taskReference',
        attrs: { taskId: 'task-1', fallbackTitle: 'only item', blockId: null }
      }
    ]);
    expect(validateEditorDocument(json).success).toBe(true);
  });

  it('promotes the first item: splits into [taskReference][taskList(rest)]', () => {
    const ids = [generateRichBlockId(), generateRichBlockId(), generateRichBlockId()];
    const doc = taskListDoc([
      taskItem(ids[0]!, 'first'),
      taskItem(ids[1]!, 'second'),
      taskItem(ids[2]!, 'third')
    ]);
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const applied = applyRichTaskItemPromote(tr, 0, 0, {
      taskId: 'task-1',
      fallbackTitle: 'first'
    });
    expect(applied).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(json.content?.map((node) => node.type)).toEqual(['taskReference', 'taskList']);
    expect(json.content?.[1]?.content?.map((item) => item.attrs?.blockId)).toEqual([
      ids[1],
      ids[2]
    ]);
    expect(validateEditorDocument(json).success).toBe(true);
  });

  it('promotes the middle item: splits into [taskList(before)][taskReference][taskList(after)]', () => {
    const ids = [generateRichBlockId(), generateRichBlockId(), generateRichBlockId()];
    const doc = taskListDoc([
      taskItem(ids[0]!, 'first'),
      taskItem(ids[1]!, 'second'),
      taskItem(ids[2]!, 'third')
    ]);
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const applied = applyRichTaskItemPromote(tr, 0, 1, {
      taskId: 'task-2',
      fallbackTitle: 'second'
    });
    expect(applied).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(json.content?.map((node) => node.type)).toEqual([
      'taskList',
      'taskReference',
      'taskList'
    ]);
    expect(json.content?.[0]?.content?.map((item) => item.attrs?.blockId)).toEqual([ids[0]]);
    expect(json.content?.[2]?.content?.map((item) => item.attrs?.blockId)).toEqual([ids[2]]);
    expect(validateEditorDocument(json).success).toBe(true);
  });

  it('promotes the last item: splits into [taskList(before)][taskReference]', () => {
    const ids = [generateRichBlockId(), generateRichBlockId()];
    const doc = taskListDoc([taskItem(ids[0]!, 'first'), taskItem(ids[1]!, 'second')]);
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    const applied = applyRichTaskItemPromote(tr, 0, 1, {
      taskId: 'task-2',
      fallbackTitle: 'second'
    });
    expect(applied).toBe(true);

    const json = tr.doc.toJSON() as EditorDocument;
    expect(json.content?.map((node) => node.type)).toEqual(['taskList', 'taskReference']);
    expect(validateEditorDocument(json).success).toBe(true);
  });

  it('returns false for a stale/out-of-range list position', () => {
    const id = generateRichBlockId();
    const doc = taskListDoc([taskItem(id, 'only item')]);
    const pmDoc = schema.nodeFromJSON(doc);
    const tr = new Transform(pmDoc);

    expect(applyRichTaskItemPromote(tr, 999, 0, { taskId: 'x', fallbackTitle: 'x' })).toBe(
      false
    );
    expect(applyRichTaskItemPromote(tr, 0, 5, { taskId: 'x', fallbackTitle: 'x' })).toBe(false);
  });
});
