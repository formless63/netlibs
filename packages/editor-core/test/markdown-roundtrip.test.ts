import { describe, expect, it } from 'bun:test';

import {
  importMarkdown,
  serializeMarkdown,
  validateEditorDocument,
  type EditorDocument,
  type EditorNode
} from '../src/index.ts';
import { doc, li, ol, p, text, ul } from './fixtures.ts';

function roundTrip(document: EditorDocument) {
  const markdown = serializeMarkdown(document);
  const result = importMarkdown(markdown);
  return { markdown, result };
}

function expectLossless(document: EditorDocument): void {
  const { markdown, result } = roundTrip(document);
  expect(result.findings, markdown).toEqual([]);
  expect(result.document, markdown).toEqual(document);
}

const code = (value: string, language: string | null = 'js'): EditorNode => ({
  type: 'codeBlock',
  attrs: { language },
  ...(value ? { content: [text(value)] } : {})
});

// Every case here was corrupted or rejected by the serializer/importer as it
// stood in the source application.
describe('Markdown round trips fixed during extraction', () => {
  it('keeps three-level nested lists as lists', () => {
    expectLossless(doc(ul(li(p('a'), ul(li(p('b'), ul(li(p('c')))))))));
  });
  it('keeps continuation blocks inside ordered items of any marker width', () => {
    expectLossless(doc(ol(li(p('a'), ul(li(p('b'))), p('tail')), li(p('z')))));
    expectLossless(
      doc({ type: 'orderedList', attrs: { start: 99 }, content: [li(p('a')), li(p('b'), code('x'))] })
    );
  });
  it('keeps adjacent lists separate', () => {
    expectLossless(doc(ul(li(p('a'))), ul(li(p('b'))), ul(li(p('c')))));
    expectLossless(doc(ol(li(p('a'))), ol(li(p('b')))));
  });
  it('keeps list items that open with a nested block', () => {
    expectLossless(doc(ul(li(p(), ul(li(p('b')))))));
  });
  it('imports empty code blocks, quotes, items and documents', () => {
    expectLossless(doc(code('', null)));
    for (const markdown of ['', '>', '- \n- b', '- # h', '0. z']) {
      const result = importMarkdown(markdown);
      expect(result.findings, markdown).toEqual([]);
      expect(validateEditorDocument(result.document).success).toBe(true);
    }
  });
  it('keeps hard breaks inside table cells', () => {
    const cell = (type: string, ...content: EditorNode[]): EditorNode => ({ type, content });
    expectLossless(
      doc({
        type: 'table',
        content: [
          { type: 'tableRow', content: [cell('tableHeader', p('h'))] },
          { type: 'tableRow', content: [cell('tableCell', p('x', { type: 'hardBreak' }, 'y'))] }
        ]
      })
    );
  });
  it('keeps emphasis next to whitespace and punctuation', () => {
    const bold = { type: 'bold' } as const;
    expectLossless(doc(p(text('a.', bold), 'b')));
    expectLossless(doc(p('a', text('"b"', bold), 'c')));
    const { result } = roundTrip(doc(p(text('bold ', bold), 'x')));
    expect(result.document).toEqual(doc(p(text('bold', bold), ' x')));
  });
  it('keeps literal entities, dollars, carets, tildes and colons', () => {
    for (const value of [
      '&amp; and &copy; & more',
      'literal $x$ is not math',
      'price $5 and $10',
      'x^2^ and H~2~O',
      'ratio 16:9 and :foo{bar=baz} end',
      'C# and a trailing #'
    ]) {
      expectLossless(doc(p(value)));
    }
    expectLossless(doc({ type: 'heading', attrs: { level: 2 }, content: [text('foo #')] }));
  });
  it('keeps LaTeX verbatim', () => {
    for (const latex of ['x^2', '\\frac{a}{b}', '\\{a\\}', 'a_1 * b_2 * c', 'x \\\\ y']) {
      const math: EditorNode = { type: 'inlineMath', attrs: { latex } };
      expectLossless(doc(p('see ', math, ' ok')));
      expectLossless(doc(p(math)));
    }
    expectLossless(doc(p('run ', text('echo $a$b \\^ \\~', { type: 'code' }))));
  });
  it('keeps literals inside code blocks nested in quotes and lists', () => {
    expectLossless(
      doc({ type: 'blockquote', content: [ul(li(p('a'), code('\\^ $x$ \\~\n:::')))] })
    );
  });
  it('resolves emphasis around inline code the way the editor does', () => {
    const { document, findings } = importMarkdown('**`x`** and [`y`](https://example.com/)');
    expect(findings).toEqual([]);
    expect(document.content?.[0]?.content?.[0]).toEqual(text('x', { type: 'code' }));
    expect(document.content?.[0]?.content?.[2]).toEqual(
      text('y', { type: 'link', attrs: { href: 'https://example.com/' } })
    );
  });
});

describe('legacy Markdown', () => {
  it('reads pre-extraction reference schemes', () => {
    const { document, findings } = importMarkdown('[a](rich-doc:abc#top)');
    expect(findings).toEqual([]);
    expect(document.content?.[0]?.content?.[0]?.marks?.[0]?.attrs).toEqual({
      href: 'rich-doc:abc#top',
      targetDocumentId: 'abc',
      targetAnchor: 'top'
    });
  });
});

describe('unsafe Markdown is reported, not committed', () => {
  it.each([
    '[x](javascript:alert(1))',
    '[x](//evil.example/a)',
    '<script>alert(1)</script>',
    '![x](https://example.com/a.png)',
    ':::note\nunclosed'
  ])('%s', (markdown) => {
    expect(importMarkdown(markdown).canCommit).toBe(false);
  });
});

/** Small deterministic PRNG so a failure is reproducible from its seed. */
function prng(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

describe('generated documents', () => {
  it('always re-import cleanly and reach a fixed point', () => {
    for (let seed = 1; seed <= 400; seed += 1) {
      const random = prng(seed);
      const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)]!;
      const words = ['alpha', 'b.c', 'x*y', '_u_', '[k]', '`t`', '#h', '1. n', '- d', 'a|b', '&lt;', '$z$', '<b>', '~', '^', '\\', '\\^', 'a~b', ':::', '> q'];
      const marks = [[], [], [], ['bold'], ['italic'], ['strike'], ['bold', 'italic'], ['code']] as const;
      const inline = (): EditorNode[] =>
        Array.from({ length: 1 + Math.floor(random() * 4) }, () =>
          text(pick(words), ...pick(marks).map((type) => ({ type })))
        );
      const block = (depth: number): EditorNode => {
        const kind = depth > 3 ? 'p' : pick(['p', 'p', 'h', 'ul', 'ol', 'quote', 'code', 'callout', 'hr']);
        const blocks = () => Array.from({ length: 1 + Math.floor(random() * 2) }, () => block(depth + 1));
        switch (kind) {
          case 'h':
            return { type: 'heading', attrs: { level: 1 + Math.floor(random() * 6) }, content: inline() };
          case 'ul':
            return ul(...blocks().map((child) => li(p(...inline()), child)));
          case 'ol':
            return ol(...blocks().map((child) => li(p(...inline()), child)));
          case 'quote':
            return { type: 'blockquote', content: blocks() };
          case 'code':
            return code(`${pick(words)}\n  ${pick(words)}`);
          case 'callout':
            return { type: 'callout', attrs: { kind: 'tip', title: null }, content: blocks() };
          case 'hr':
            return { type: 'horizontalRule' };
          default:
            return p(...inline());
        }
      };
      const document = doc(...Array.from({ length: 3 }, () => block(0)));
      const first = roundTrip(document);
      expect(first.result.findings, `seed ${seed}\n${first.markdown}`).toEqual([]);
      const plain = (node: EditorNode): string =>
        node.type === 'text' ? (node.text ?? '') : (node.content ?? []).map(plain).join('');
      expect(plain(first.result.document), `seed ${seed}\n${first.markdown}`).toBe(plain(document));
      const types = (node: EditorNode): unknown =>
        node.type === 'text' ? 't' : [node.type, (node.content ?? []).filter((n) => n.type !== 'text').map(types)];
      expect(types(first.result.document), `seed ${seed}\n${first.markdown}`).toEqual(types(document));
      const second = roundTrip(first.result.document);
      expect(second.result.document, `seed ${seed}`).toEqual(first.result.document);
    }
  });
});
