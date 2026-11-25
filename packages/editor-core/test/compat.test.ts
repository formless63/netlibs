import { describe, expect, it } from 'bun:test';

import './test-dom.ts';

import { Editor } from '@tiptap/core';

import {
  collectDocumentReferences,
  createEditorExtensions,
  createVersionedDocument,
  EDITOR_SCHEMA_VERSION,
  migrateDocument,
  openDocument,
  rewriteReferenceSchemes,
  UnsupportedSchemaVersionError,
  validateEditorDocument,
  type EditorDocument
} from '../src/index.ts';
import { doc, sampleDocument, p, RESOURCE_ID, text } from './fixtures.ts';
import { testResolver } from './resolver.ts';

describe('stored documents', () => {
  const SCHEMES = { 'old-doc:': 'rich-doc:', 'old-resource:': 'rich-resource:', 'old-task:': 'rich-task:' };
  const BACK = Object.fromEntries(Object.entries(SCHEMES).map(([from, to]) => [to, from]));

  it('validate and migrate without being mutated', () => {
    const before = sampleDocument();
    const snapshot = structuredClone(before);
    const opened = openDocument(before);
    expect(before).toEqual(snapshot);
    expect(validateEditorDocument(opened).findings).toEqual([]);
    expect(migrateDocument(opened, EDITOR_SCHEMA_VERSION)).toBe(opened);
  });

  it("can come from another application's reference schemes, and convert back exactly", () => {
    const foreign = rewriteReferenceSchemes(sampleDocument(), BACK);
    expect(JSON.stringify(foreign)).not.toContain('rich-');
    expect(validateEditorDocument(foreign).success).toBe(false);
    expect(rewriteReferenceSchemes(foreign, SCHEMES)).toEqual(sampleDocument());
  });

  it('load into a live editor without losing anything', () => {
    const upgraded = openDocument(sampleDocument());
    const editor = new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions({ resolver: testResolver }),
      content: upgraded
    });
    const loaded = JSON.parse(JSON.stringify(editor.getJSON())) as EditorDocument;
    expect(validateEditorDocument(loaded).findings).toEqual([]);
    expect(loaded.content?.map((node) => node.type).slice(0, 5)).toEqual(
      upgraded.content!.map((node) => node.type)
    );
    expect(loaded.content?.[3]?.attrs).toMatchObject(upgraded.content![3]!.attrs!);
    editor.destroy();
  });
});

describe('versioned envelope', () => {
  it('round-trips and accepts bare documents', () => {
    const document = doc(p('hi'));
    const envelope = createVersionedDocument(document);
    expect(envelope.schemaVersion).toBe(EDITOR_SCHEMA_VERSION);
    expect(openDocument(JSON.parse(JSON.stringify(envelope)))).toEqual(document);
    expect(openDocument(document)).toEqual(document);
  });

  it('refuses content from a newer schema instead of guessing', () => {
    expect(() =>
      openDocument({ ...createVersionedDocument(doc(p('x'))), schemaVersion: EDITOR_SCHEMA_VERSION + 1 })
    ).toThrow(UnsupportedSchemaVersionError);
  });

  it.each([[null], ['x'], [[]], [{}], [{ type: 'paragraph' }], [{ format: 'rich-document' }]])(
    'rejects %p',
    (value) => {
      expect(() => openDocument(value)).toThrow();
    }
  );
});

describe('collectDocumentReferences', () => {
  it('finds every referenced id once', () => {
    expect(collectDocumentReferences(sampleDocument())).toEqual({
      resourceIds: [RESOURCE_ID],
      documentIds: ['abc'],
      taskIds: ['t1'],
      hasChildrenIndex: false
    });
  });
});

describe('pasted HTML always yields a document that can be saved', () => {
  const cases: Record<string, string> = {
    'foreign link attributes': '<p><a href="https://example.com" class="q" rel="x" target="_self">z</a></p>',
    'script link': '<p><a href="javascript:alert(1)">z</a></p>',
    'foreign image': '<p>a<img src="https://example.com/a.png">b</p>',
    'styled ordered list': '<ol type="a" start="0"><li>x</li></ol>',
    'foreign heading id': '<h2 id="1.bad id">x</h2>',
    'merged cells': '<table><tr><td colspan="2" style="text-align:center">a</td></tr></table>',
    'unsupported marks': '<p><u>u</u><mark>m</mark></p>',
    'nested code marks': '<p><strong><code>x</code></strong></p>',
    details: '<details open><summary>s</summary><div data-type="detailsContent"><p>x</p></div></details>',
    'resource card': `<div data-rich-resource-card="" resourceid="${RESOURCE_ID}" title="a.pdf" kind="file" selector="live"></div>`
  };
  const open = (content: string | EditorDocument): Editor =>
    new Editor({
      element: document.createElement('div'),
      extensions: createEditorExtensions({ resolver: testResolver }),
      content
    });

  it.each(Object.keys(cases))('%s', (name) => {
    const editor = open('<p></p>');
    editor.commands.setContent(cases[name]!);
    const json = JSON.parse(JSON.stringify(editor.getJSON()));
    expect(validateEditorDocument(json).findings).toEqual([]);
    editor.destroy();
  });

  it('keeps external and internal links through a copy/paste round trip', () => {
    const source = doc(
      p(
        text('out', { type: 'link', attrs: { href: 'https://example.com/a' } }),
        text('in', {
          type: 'link',
          attrs: { href: 'rich-doc:abc#top', targetDocumentId: 'abc', targetAnchor: 'top' }
        })
      )
    );
    const editor = open(source);
    const html = editor.getHTML();
    expect(html).toContain('href="/docs/abc#top"');
    editor.commands.setContent(html);
    const hrefs = editor.getJSON().content[0]!.content!.map((node: any) => node.marks[0].attrs.href);
    expect(hrefs).toEqual(['https://example.com/a', 'rich-doc:abc#top']);
    editor.destroy();
  });

  it('turns a pasted application URL back into a stable link', () => {
    const editor = open('<p></p>');
    editor.commands.setContent('<p><a href="/docs/zz#top">i</a></p>');
    expect((editor.getJSON().content[0] as any).content[0].marks[0].attrs).toMatchObject({
      href: 'rich-doc:zz#top',
      targetDocumentId: 'zz',
      targetAnchor: 'top'
    });
    editor.destroy();
  });

  it('canonicalizes a bare-domain link the way autolink writes it', () => {
    const editor = open('<p>x</p>');
    editor.commands.selectAll();
    editor.commands.setMark('link', { href: 'https://example.com' });
    const json = JSON.parse(JSON.stringify(editor.getJSON()));
    expect(json.content[0].content[0].marks[0].attrs.href).toBe('https://example.com/');
    expect(validateEditorDocument(json).findings).toEqual([]);
    editor.destroy();
  });

  it('scopes menu events to the editor that raised them', () => {
    const first = open('<p>a</p>');
    const second = open('<p>b</p>');
    let heard = 0;
    second.view.dom.addEventListener('rich-drag-handle-menu', () => (heard += 1));
    first.view.dom.dispatchEvent(new CustomEvent('rich-drag-handle-menu'));
    expect(heard).toBe(0);
    first.destroy();
    second.destroy();
  });
});
