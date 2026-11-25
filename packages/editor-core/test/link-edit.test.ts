import { Editor, type Content } from '@tiptap/core';
import { afterEach, describe, expect, it } from 'bun:test';

import './test-dom.ts';

import { createEditorExtensions } from '../src/schema.ts';
import { applyRichLinkUpdate, getRichLinkText, richLinkAttrsForHref } from '../src/index.ts';
import { validateEditorDocument } from '../src/validation.ts';

/**
 * Link display-text editing coverage : dropping a
 * bare URL keeps text = URL until the popover's Text field edits it; the
 * edit replaces the FULL mark range, keeps the href and any other marks,
 * and undoes as one step.
 */

const URL_HREF = 'https://example.com/docs';

function urlLinkContent(): Content {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Before ' },
          { type: 'text', text: URL_HREF, marks: [{ type: 'link', attrs: { href: URL_HREF } }] },
          { type: 'text', text: ' after' }
        ]
      }
    ]
  };
}

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length > 0) cleanups.pop()!();
});

function makeEditor(content: Content): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const editor = new Editor({
    element: el,
    extensions: createEditorExtensions(),
    content
  });
  cleanups.push(() => {
    editor.destroy();
    el.remove();
  });
  return editor;
}

function posInText(editor: Editor, match: (text: string) => boolean): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && match(node.text ?? '')) found = pos + 2;
    return found === -1;
  });
  expect(found).toBeGreaterThan(-1);
  return found;
}

function paragraphText(editor: Editor): string {
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, ' ');
}

function linkFacts(editor: Editor): Array<{ text: string; href: string; marks: string[] }> {
  const facts: Array<{ text: string; href: string; marks: string[] }> = [];
  editor.state.doc.descendants((node) => {
    if (!node.isText) return true;
    const link = node.marks.find((mark) => mark.type.name === 'link');
    if (link) {
      facts.push({
        text: node.text ?? '',
        href: String(link.attrs.href),
        marks: node.marks.map((mark) => mark.type.name).toSorted()
      });
    }
    return true;
  });
  return facts;
}

describe('applyRichLinkUpdate (link display text editing)', () => {
  it('drop URL -> edit text: text changes across the full mark range, href intact', () => {
    const editor = makeEditor(urlLinkContent());
    // Cursor merely inside the link (not a full-range selection) — the mark
    // range, not the selection, is what gets replaced.
    editor.commands.setTextSelection(posInText(editor, (t) => t === URL_HREF));

    expect(getRichLinkText(editor)).toBe(URL_HREF);
    const applied = applyRichLinkUpdate(editor, URL_HREF, 'Example docs');

    expect(applied).toBe(true);
    expect(paragraphText(editor)).toBe('Before Example docs after');
    expect(linkFacts(editor)).toEqual([{ text: 'Example docs', href: URL_HREF, marks: ['link'] }]);
  });

  it('undo restores the original text and href in one step', () => {
    const editor = makeEditor(urlLinkContent());
    editor.commands.setTextSelection(posInText(editor, (t) => t === URL_HREF));

    applyRichLinkUpdate(editor, URL_HREF, 'Example docs');
    expect(paragraphText(editor)).toBe('Before Example docs after');

    expect(editor.commands.undo()).toBe(true);
    expect(paragraphText(editor)).toBe(`Before ${URL_HREF} after`);
    expect(linkFacts(editor)).toEqual([{ text: URL_HREF, href: URL_HREF, marks: ['link'] }]);
  });

  it('empty/unchanged text only updates the href (bare-URL default keeps text = URL)', () => {
    const editor = makeEditor(urlLinkContent());
    editor.commands.setTextSelection(posInText(editor, (t) => t === URL_HREF));

    applyRichLinkUpdate(editor, 'https://other.example/path', '');
    expect(paragraphText(editor)).toBe(`Before ${URL_HREF} after`);
    expect(linkFacts(editor)).toEqual([
      { text: URL_HREF, href: 'https://other.example/path', marks: ['link'] }
    ]);

    applyRichLinkUpdate(editor, URL_HREF, URL_HREF);
    expect(paragraphText(editor)).toBe(`Before ${URL_HREF} after`);
    expect(linkFacts(editor)[0]?.href).toBe(URL_HREF);
  });

  it('preserves other marks on the link text through a text edit', () => {
    const editor = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'bold link',
              marks: [{ type: 'bold' }, { type: 'link', attrs: { href: URL_HREF } }]
            }
          ]
        }
      ]
    });
    editor.commands.setTextSelection(posInText(editor, (t) => t === 'bold link'));

    applyRichLinkUpdate(editor, URL_HREF, 'renamed');

    expect(linkFacts(editor)).toEqual([
      { text: 'renamed', href: URL_HREF, marks: ['bold', 'link'] }
    ]);
  });

  it('committing an INTERNAL link stamps the target attrs canonical validation requires', () => {
    // Latent pre-existing bug : `setLink({ href })` left
    // `targetDocumentId`/`targetAnchor` null on internal links, so the NEXT
    // save of the document failed canonical validation.
    const documentId = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
    const internalHref = `rich-doc:${documentId}#setup`;
    const editor = makeEditor(urlLinkContent());
    editor.commands.setTextSelection(posInText(editor, (t) => t === URL_HREF));

    applyRichLinkUpdate(editor, internalHref, 'Linked doc');

    expect(linkFacts(editor)).toEqual([
      { text: 'Linked doc', href: internalHref, marks: ['link'] }
    ]);
    const validation = validateEditorDocument(editor.getJSON());
    expect(validation.success).toBe(true);

    // Switching back to an external href clears the internal target attrs
    // (validation forbids them on external links) and still validates.
    applyRichLinkUpdate(editor, URL_HREF, '');
    expect(validateEditorDocument(editor.getJSON()).success).toBe(true);
    expect(richLinkAttrsForHref(URL_HREF)).toEqual({
      href: URL_HREF,
      targetDocumentId: null,
      targetAnchor: null
    });
  });

  it('getRichLinkText reads the whole mark range even from a partial selection', () => {
    const editor = makeEditor(urlLinkContent());
    const inside = posInText(editor, (t) => t === URL_HREF);
    editor.commands.setTextSelection({ from: inside, to: inside + 3 });

    expect(getRichLinkText(editor)).toBe(URL_HREF);
  });
});
