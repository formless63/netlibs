import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'bun:test';

import './test-dom.ts';

import { createEditorExtensions } from '@formless63/editor-core';
import type { EditorDocument } from '@formless63/editor-core';
import {
  convertRichResourceCardToChip,
  convertRichResourceChipToCard,
  insertRichResourceCard,
  insertRichResourceChip,
  insertRichResourcePick,
  type RichResourcePickResult
} from '../src/resource-picker.ts';
import { validateEditorDocument } from '@formless63/editor-core';

/**
 * Mirrors `upload-drop.test.ts`'s coverage shape
 * for the resource-picker's pure insertion half: a real headless Editor, no
 * network/DB, exercising exactly the code path the picker dialog's
 * `onSelect` calls.
 */
function makeEditor(): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph' }] }
  });
}

function docJson(editor: Editor): EditorDocument {
  return editor.getJSON() as EditorDocument;
}

function selectNodeOfType(editor: Editor, typeName: string): boolean {
  let selected = false;
  editor.state.doc.descendants((node, pos) => {
    if (!selected && node.type.name === typeName) {
      editor.commands.setNodeSelection(pos);
      selected = true;
    }
    return !selected;
  });
  return selected;
}

function pickedResource(
  overrides: Partial<RichResourcePickResult> = {}
): RichResourcePickResult {
  return {
    resourceId: '11111111-1111-4111-8111-111111111111',
    title: 'Vendor datasheet',
    description: null,
    kind: 'file',
    selector: 'latest-approved',
    ...overrides
  };
}

describe('insertRichResourceCard', () => {
  it('inserts a canonical resourceCard node carrying only the node-attr subset (never provider/fallbackUrl)', () => {
    const editor = makeEditor();
    const picked = pickedResource();
    const inserted = insertRichResourceCard(editor, editor.state.doc.content.size, picked);
    expect(inserted).toBe(true);

    const json = docJson(editor);
    const node = json.content?.find((candidate) => candidate.type === 'resourceCard');
    expect(node).toMatchObject({
      type: 'resourceCard',
      attrs: {
        resourceId: picked.resourceId,
        title: picked.title,
        description: picked.description,
        kind: picked.kind,
        selector: picked.selector
      }
    });
    // provider/fallbackUrl are picker-result-only fields, never persisted on
    // the node — see resource-read-service.ts's render-meta doc comment.
    expect(node?.attrs).not.toHaveProperty('provider');
    expect(node?.attrs).not.toHaveProperty('fallbackUrl');
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('inserts a url-provider pick with a live selector (no approval authority for that provider)', () => {
    const editor = makeEditor();
    const picked = pickedResource({
      resourceId: '22222222-2222-4222-8222-222222222222',
      title: 'Vendor page',
      kind: 'link',
      selector: 'live'
    });
    insertRichResourceCard(editor, editor.state.doc.content.size, picked);

    const json = docJson(editor);
    const node = json.content?.find((candidate) => candidate.type === 'resourceCard');
    expect(node?.attrs).toMatchObject({ selector: 'live', kind: 'link' });
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });
});

describe('insertRichResourceChip / insertRichResourcePick', () => {
  it('inserts an inline resourceChip carrying the identity subset only (no description/presentation)', () => {
    const editor = makeEditor();
    const picked = pickedResource({ kind: 'app_product', selector: 'live' });
    const inserted = insertRichResourceChip(editor, 1, picked);
    expect(inserted).toBe(true);

    const json = docJson(editor);
    const paragraph = json.content?.find((candidate) => candidate.type === 'paragraph');
    const chip = paragraph?.content?.find((candidate) => candidate.type === 'resourceChip');
    expect(chip).toMatchObject({
      type: 'resourceChip',
      attrs: {
        resourceId: picked.resourceId,
        title: picked.title,
        kind: 'app_product',
        selector: 'live'
      }
    });
    expect(chip?.attrs).not.toHaveProperty('description');
    expect(chip?.attrs).not.toHaveProperty('presentation');
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('routes app kinds to a chip and file/url kinds to a card', () => {
    for (const [kind, expectedType] of [
      ['app_page', 'resourceChip'],
      ['app_product', 'resourceChip'],
      ['app_part', 'resourceChip'],
      ['file', 'resourceCard'],
      ['link', 'resourceCard']
    ] as const) {
      const editor = makeEditor();
      insertRichResourcePick(editor, 1, pickedResource({ kind, selector: 'live' }));
      const json = JSON.stringify(docJson(editor));
      expect(json.includes(`"${expectedType}"`), `${kind} -> ${expectedType}`).toBe(true);
      editor.destroy();
    }
  });
});

describe('card<->chip conversion', () => {
  it('card -> chip: replaces the block with a new paragraph holding the chip; presentation attrs drop', () => {
    const editor = makeEditor();
    editor.commands.insertContentAt(1, {
      type: 'resourceCard',
      attrs: {
        resourceId: '33333333-3333-4333-8333-333333333333',
        title: 'schematic.pdf',
        description: 'Main board',
        kind: 'file',
        selector: 'live',
        presentation: 'preview',
        width: 480,
        height: 360
      }
    });
    expect(selectNodeOfType(editor, 'resourceCard')).toBe(true);
    expect(convertRichResourceCardToChip(editor)).toBe(true);

    const json = docJson(editor);
    expect(JSON.stringify(json)).not.toContain('resourceCard');
    const paragraph = json.content?.find((candidate) =>
      candidate.content?.some((child) => child.type === 'resourceChip')
    );
    const chip = paragraph?.content?.find((child) => child.type === 'resourceChip');
    expect(chip?.attrs).toMatchObject({
      resourceId: '33333333-3333-4333-8333-333333333333',
      title: 'schematic.pdf',
      kind: 'file',
      selector: 'live'
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('chip -> card: inserts the card block after the current block and removes the chip from the text', () => {
    const editor = makeEditor();
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            {
              type: 'resourceChip',
              attrs: {
                resourceId: '55555555-5555-4555-8555-555555555555',
                title: 'Example cable',
                kind: 'app_product',
                selector: 'live'
              }
            },
            { type: 'text', text: ' here.' }
          ]
        }
      ]
    });
    expect(selectNodeOfType(editor, 'resourceChip')).toBe(true);
    expect(convertRichResourceChipToCard(editor)).toBe(true);

    const json = docJson(editor);
    expect(JSON.stringify(json)).not.toContain('resourceChip');
    const paragraphIndex = json.content?.findIndex((node) => node.type === 'paragraph') ?? -1;
    const cardIndex = json.content?.findIndex((node) => node.type === 'resourceCard') ?? -1;
    expect(cardIndex).toBe(paragraphIndex + 1);
    expect(json.content?.[cardIndex]?.attrs).toMatchObject({
      resourceId: '55555555-5555-4555-8555-555555555555',
      title: 'Example cable',
      description: null,
      kind: 'app_product',
      selector: 'live'
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('conversion commands fail soft (return false) when the selection is not the expected node', () => {
    const editor = makeEditor();
    expect(convertRichResourceCardToChip(editor)).toBe(false);
    expect(convertRichResourceChipToCard(editor)).toBe(false);
    editor.destroy();
  });
});
