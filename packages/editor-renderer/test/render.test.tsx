import { describe, expect, it } from 'bun:test';

import type { EditorNode, EditorResolver } from '@formless63/editor-core';

import { sampleDocument, RESOURCE_ID } from '../../editor-core/test/fixtures.ts';
import { getTableOfContents, RenderDocument, slugifyHeading } from '../src/index.ts';
import { renderDocumentToHtml } from '../src/html.tsx';

const resolver: EditorResolver = {
  documentHref: ({ documentId, anchor }) => `/docs/${documentId}${anchor ? `#${anchor}` : ''}`,
  resourceHref: (id, purpose) => `/media/${id}?for=${purpose}`,
  taskHref: (id) => `/tasks/${id}`
};
const t = (text: string, ...marks: NonNullable<EditorNode['marks']>): EditorNode => ({
  type: 'text',
  text,
  ...(marks.length ? { marks } : {})
});
const p = (...content: EditorNode[]): EditorNode => ({ type: 'paragraph', content });
const html = (
  nodes: EditorNode[],
  props: Partial<Parameters<typeof RenderDocument>[0]> = {}
): string => renderDocumentToHtml({ document: { type: 'doc', content: nodes }, resolver, ...props });

describe('blocks and marks', () => {
  it('renders every mark and nests them deterministically', () => {
    expect(
      html([p(t('x', { type: 'italic' }, { type: 'bold' }, { type: 'strike' }), t('2', { type: 'superscript' }))])
    ).toBe('<div class="rich-content"><p><s><em><strong>x</strong></em></s><sup>2</sup></p></div>');
  });

  it('renders lists, tasks, tables, details and callouts semantically', () => {
    const cell = (type: string, text: string): EditorNode => ({ type, content: [p(t(text))] });
    const out = html([
      { type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [p(t('a'))] }] },
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: true }, content: [p(t('done'))] }]
      },
      {
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', 'h')] },
          { type: 'tableRow', content: [cell('tableCell', 'c')] }
        ]
      },
      {
        type: 'details',
        attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [t('sum')] },
          { type: 'detailsContent', content: [p(t('body'))] }
        ]
      },
      { type: 'callout', attrs: { kind: 'tip', title: 'T', color: 'red' }, content: [p(t('c'))] }
    ]);
    expect(out).toContain('<ol start="3"><li><p>a</p></li></ol>');
    expect(out).toContain('data-checked="true"');
    expect(out).toMatch(/<thead><tr><th scope="col">.*<\/thead><tbody>/);
    expect(out).toContain('<details class="rich-details" open=""><summary>sum</summary>');
    expect(out).toContain('data-callout-color="red"');
    expect(out).toContain('Tip: T');
  });

  it('highlights known languages and leaves others as text', () => {
    const block = (language: string | null): EditorNode => ({
      type: 'codeBlock',
      attrs: { language },
      content: [t('const a = "<b>";')]
    });
    expect(html([block('ts')])).toContain('hljs-keyword');
    const plain = html([block('cobol')]);
    expect(plain).not.toContain('hljs');
    expect(plain).toContain('&lt;b&gt;');
  });

  it('renders math, and survives invalid LaTeX', () => {
    expect(html([p({ type: 'inlineMath', attrs: { latex: 'x^2' } })])).toContain('class="katex"');
    expect(html([{ type: 'blockMath', attrs: { latex: '\\frac{' } }])).toContain('rich-math-block');
  });

  it('degrades unknown nodes to their content', () => {
    expect(html([{ type: 'futureBlock', content: [p(t('kept'))] }])).toContain('<p>kept</p>');
  });
});

describe('references', () => {
  it('renders a pre-extraction document through the resolver', () => {
    const out = renderDocumentToHtml({ document: sampleDocument(), resolver });
    expect(out).toContain('href="/docs/abc#top"');
    expect(out).toContain(`src="/media/${RESOURCE_ID}?for=content"`);
    expect(out).toContain('href="/tasks/t1"');
    expect(out).toContain(`href="/media/${RESOURCE_ID}?for=download"`);
    expect(out).not.toMatch(/rich-(doc|resource|task):/);
  });

  it('never emits internal schemes when nothing resolves', () => {
    const out = renderDocumentToHtml({ document: sampleDocument() });
    expect(out).not.toMatch(/rich-(doc|resource|task):/);
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<img');
    expect(out).toContain('aria-label="Rack"');
  });

  it('previews media and allows per-node overrides', () => {
    const card = (title: string): EditorNode => ({
      type: 'resourceCard',
      attrs: { resourceId: 'r', title, kind: 'file', selector: 'live', presentation: 'preview' }
    });
    expect(html([card('a.mp4')])).toContain('<video controls');
    expect(html([card('a.pdf')])).not.toContain('<iframe');
    expect(html([card('a.pdf')], { resourceSizes: { r: 2048 } })).toContain('2 KB');
    expect(
      html([card('a.pdf')], {
        components: { resourceCard: ({ node }) => <b>{String(node.attrs?.title)}</b> }
      })
    ).toContain('<b>a.pdf</b>');
  });

  it('renders a children index only when rows are supplied', () => {
    const node: EditorNode = { type: 'childrenIndex' };
    expect(html([node])).toBe('<div class="rich-content"></div>');
    const row = { id: '1', documentType: 'doc', title: 'Kid', href: '/docs/1', childCount: 2 };
    const rows = [{ ...row, updatedAt: '2026-01-02T23:30:00Z', publishedAt: 'bad' }];
    const out = html([node], { childrenIndexRows: rows });
    expect(out).toContain('<a href="/docs/1">Kid</a>');
    expect(out).toContain('Jan 2, 2026');
    expect(out).toContain('2 child pages');
  });
});

describe('untrusted documents', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    ' javascript:alert(1)',
    'java\nscript:alert(1)',
    'data:text/html,<script>',
    'vbscript:x',
    '//evil.example',
    '/\\evil.example'
  ])('drops the link %j but keeps its text', (href) => {
    expect(html([p(t('label', { type: 'link', attrs: { href } }))])).toBe(
      '<div class="rich-content"><p>label</p></div>'
    );
  });

  it('checks resolver URLs too', () => {
    const image: EditorNode = { type: 'image', attrs: { resourceId: 'r', alt: 'A', title: 'a' } };
    const out = html([image], {
      resolver: { ...resolver, resourceHref: () => 'javascript:alert(1)' }
    });
    expect(out).not.toContain('javascript');
    expect(out).toContain('aria-label="A"');
  });

  it('escapes text and attributes and never emits raw HTML', () => {
    const evil = '"><script>alert(1)</script>';
    const out = html([
      p(t(evil), { type: 'inlineMath', attrs: { latex: evil } }),
      { type: 'inlineMath', attrs: { latex: '\\href{javascript:alert(1)}{x}' } },
      { type: 'heading', attrs: { level: 1, anchorId: evil }, content: [t(evil)] },
      { type: 'codeBlock', attrs: { language: evil }, content: [t(evil)] },
      { type: 'callout', attrs: { kind: evil, color: evil, title: evil }, content: [p(t(evil))] },
      { type: 'image', attrs: { resourceId: evil, alt: evil, align: evil, width: evil, description: evil } },
      { type: 'customEmoji', attrs: { name: evil } }
    ]);
    expect(out).not.toContain('<script');
    expect(out).not.toMatch(/href="javascript/);
    expect(out).toContain('data-callout-kind="note"');
  });

  it('does not leak comment anchors or block ids', () => {
    const out = html([
      {
        type: 'paragraph',
        attrs: { blockId: 'b_0123456789ABCDEF' },
        content: [t('x', { type: 'comment', attrs: { commentId: RESOURCE_ID } })]
      }
    ]);
    expect(out).toBe('<div class="rich-content"><p>x</p></div>');
  });

  it('rejects things that are not documents', () => {
    expect(() => renderDocumentToHtml({ document: '<p>hi</p>' })).toThrow();
  });
});

describe('headings', () => {
  const h = (level: number, text: string, anchorId?: string): EditorNode => ({
    type: 'heading',
    attrs: { level, anchorId: anchorId ?? null },
    content: [t(text)]
  });

  it('keeps authored anchors, makes slugs unique, and matches the table of contents', () => {
    const nodes = [h(1, 'Intro'), h(2, 'Intro'), h(2, 'Other', 'intro-2'), h(3, '2026 plan')];
    const toc = getTableOfContents({ type: 'doc', content: nodes });
    expect(toc.map((entry) => entry.id)).toEqual(['intro', 'intro-3', 'intro-2', 'section-2026-plan']);
    expect([...html(nodes).matchAll(/<h\d id="([^"]+)"/g)].map((match) => match[1])).toEqual(
      toc.map((entry) => entry.id)
    );
    expect(slugifyHeading('Café & Bar')).toBe('cafe-bar');
  });

  it('offsets levels and can emit block anchors', () => {
    expect(html([h(6, 'x')], { headingOffset: 1 })).toContain('<h6');
    const block = { ...p(t('x')), attrs: { blockId: 'b_0123456789ABCDEF' } };
    expect(html([block], { blockAnchors: true })).toContain('<p id="b_0123456789ABCDEF">');
  });
});

describe('isolation', () => {
  it('bundles without Tiptap, ProseMirror or any DOM access', async () => {
    const build = await Bun.build({
      entrypoints: [new URL('../src/html.tsx', import.meta.url).pathname],
      target: 'node',
      external: ['react', 'react-dom', 'react-dom/server', 'react/jsx-runtime', 'react/jsx-dev-runtime']
    });
    expect(build.success).toBe(true);
    const source = await build.outputs[0]!.text();
    expect(source).not.toMatch(/prosemirror|@tiptap|codemirror/i);
  });
});
