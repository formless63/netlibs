import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  diffBlocks,
  stableJson,
  summarizeBlockDiff,
  visibleBlock,
  type BlockDiffEntry,
} from '../src/index.ts';
import { proseMirrorDiff, type ProseMirrorNode } from '../src/prosemirror.ts';
import { referenceDiff, type ReferenceNode } from './reference.ts';

interface Block {
  id: string | null;
  text: string;
}
const b = (id: string | null, text = id ?? ''): Block => ({ id, text });
const options = { getId: (x: Block) => x.id, getContent: (x: Block) => x.text };
const diff = (before: Block[], after: Block[]) => diffBlocks(before, after, options);
const brief = (entries: BlockDiffEntry<Block>[]) =>
  entries.map((e) => `${e.status}:${visibleBlock(e).text}`);

describe('identity', () => {
  it('reports a block that both moved and changed as modified, with the move flagged', () => {
    const [first] = diff([b('a'), b('b'), b('c')], [b('c', 'c2'), b('a'), b('b')]);
    expect(first).toMatchObject({ status: 'modified', moved: true, beforeIndex: 2, afterIndex: 0 });
  });

  it('moves as few blocks as possible', () => {
    const before = ['a', 'b', 'c', 'd', 'e'].map((x) => b(x));
    const after = ['b', 'c', 'd', 'e', 'a'].map((x) => b(x));
    expect(summarizeBlockDiff(diff(before, after))).toMatchObject({ moved: 1, unchanged: 4 });
  });

  it('keeps a duplicated id with its first block', () => {
    expect(brief(diff([b('a'), b('b')], [b('a'), b('a', 'copy'), b('b')]))).toEqual([
      'unchanged:a',
      'added:copy',
      'unchanged:b',
    ]);
  });

  it('places a removed block after what it followed, even when that context moved', () => {
    // `x` followed `b`; `b` moved to the front, so `x` stays after `a`, which stayed.
    expect(brief(diff([b('a'), b('b'), b('x'), b('c')], [b('b'), b('a'), b('c')]))).toContain(
      'removed:x',
    );
    expect(brief(diff([b('a'), b('x'), b('c')], [b('c'), b('a')]))).toEqual(
      expect.arrayContaining(['removed:x']),
    );
    expect(brief(diff([b('x'), b('a')], [b('a')]))).toEqual(['removed:x', 'unchanged:a']);
    expect(brief(diff([b('a'), b('x')], [b('a')]))).toEqual(['unchanged:a', 'removed:x']);
  });
});

describe('documents whose ids arrived between the two revisions', () => {
  const before = [b(null, 'A'), b(null, 'B'), b(null, 'C')];
  const after = [b('1', 'A'), b('2', 'B edited'), b('3', 'C')];

  it('still matches content, where a plain id diff reports everything replaced', () => {
    expect(brief(diff(before, after))).toEqual(['unchanged:A', 'modified:B edited', 'unchanged:C']);
    const node = (x: Block): ReferenceNode => ({
      type: 'p',
      ...(x.id ? { attrs: { blockId: `b_${x.id.padStart(16, '0')}` } } : {}),
      content: [{ type: 'text', text: x.text }],
    });
    const reference = referenceDiff(before.map(node), after.map(node));
    expect(reference.map((e) => e.status).filter((s) => s === 'unchanged')).toEqual([]);
  });

  it('never matches equal content under two different ids', () => {
    expect(brief(diff([b('1', 'same')], [b('2', 'same')]))).toEqual(['removed:same', 'added:same']);
  });
});

describe('content', () => {
  it('pairs replacements in order, and can be told not to', () => {
    const before = [b(null, 'a'), b(null, 'b'), b(null, 'z')];
    const after = [b(null, 'c'), b(null, 'd'), b(null, 'e'), b(null, 'z')];
    expect(brief(diff(before, after))).toEqual([
      'modified:c',
      'modified:d',
      'added:e',
      'unchanged:z',
    ]);
    expect(
      summarizeBlockDiff(diffBlocks(before, after, { ...options, pairReplacements: false })),
    ).toMatchObject({ removed: 2, added: 3, modified: 0 });
  });

  it('drops the old block first on a tie', () => {
    expect(diffBlocks(['p', 'q'], ['q', 'p']).map((e) => [e.status, visibleBlock(e)])).toEqual([
      ['removed', 'p'],
      ['unchanged', 'q'],
      ['added', 'p'],
    ]);
  });

  it('works on plain values with no options', () => {
    expect(diffBlocks(['a', 'b'], ['a', 'c', 'b']).map((e) => e.status)).toEqual([
      'unchanged',
      'added',
      'unchanged',
    ]);
  });

  it('handles empty documents', () => {
    expect(diff([], [])).toEqual([]);
    expect(brief(diff([], [b('a')]))).toEqual(['added:a']);
    expect(brief(diff([b('a')], []))).toEqual(['removed:a']);
  });
});

describe('stableJson', () => {
  it('ignores key order, prototypes and undefined members, and keeps array order', () => {
    const bare = Object.assign(Object.create(null), { b: 1, a: [1, { d: 1, c: undefined }] });
    expect(stableJson(bare)).toBe(stableJson({ a: [1, { d: 1 }], b: 1 }));
    expect(stableJson([1, 2])).not.toBe(stableJson([2, 1]));
    expect(stableJson([undefined])).toBe('[null]');
  });
});

describe('ProseMirror JSON', () => {
  const p = (text: string, attrs?: Record<string, unknown>): ProseMirrorNode => ({
    type: 'paragraph',
    ...(attrs ? { attrs } : {}),
    content: [{ type: 'text', text }],
  });

  it('does not count nested ids as content', () => {
    const list = (id: string, inner: string): ProseMirrorNode => ({
      type: 'bulletList',
      attrs: { blockId: id },
      content: [
        {
          type: 'listItem',
          attrs: { blockId: inner },
          content: [p('x', { blockId: inner + 'p' })],
        },
      ],
    });
    const [entry] = diffBlocks([list('1', 'a')], [list('1', 'b')], proseMirrorDiff());
    expect(entry!.status).toBe('unchanged');
  });

  it('compares editor JSON with importer JSON when null attrs are ignored', () => {
    const editor = [
      p('A', { blockId: '1', anchorId: null }),
      { type: 'rule', attrs: {}, content: [] },
    ];
    const imported = [p('A'), { type: 'rule' }];
    const status = (ignoreNullAttrs: boolean) =>
      diffBlocks<ProseMirrorNode>(editor, imported, proseMirrorDiff({ ignoreNullAttrs })).map(
        (e) => e.status,
      );
    expect(status(true)).toEqual(['unchanged', 'unchanged']);
    expect(status(false)).toEqual(['modified', 'unchanged']);
  });

  it('still sees an attribute change, a mark change, and a mark’s own blockId', () => {
    const changed = (x: ProseMirrorNode, y: ProseMirrorNode) =>
      diffBlocks([x], [y], proseMirrorDiff({ ignoreNullAttrs: true }))[0]!.status;
    expect(changed(p('A', { blockId: '1', level: 1 }), p('A', { blockId: '1', level: 2 }))).toBe(
      'modified',
    );
    const marked = (blockId: string): ProseMirrorNode => ({
      type: 'paragraph',
      content: [{ type: 'text', text: 'A', marks: [{ type: 'ref', attrs: { blockId } }] }],
    });
    expect(changed(marked('x'), marked('y'))).toBe('modified');
  });

  it('can reject malformed ids', () => {
    const [entry] = diffBlocks(
      [p('A', { blockId: 'bad' })],
      [p('A', { blockId: 'worse' })],
      proseMirrorDiff({ isId: (id) => id.startsWith('b_') }),
    );
    expect(entry).toMatchObject({ status: 'unchanged', id: null, matchedBy: 'content' });
  });
});

describe('properties', () => {
  const blocks = fc.array(
    fc.record({
      id: fc.option(fc.integer({ min: 0, max: 9 }).map(String), { nil: null }),
      text: fc.constantFrom('p', 'q', 'r', 's'),
    }),
    { maxLength: 12 },
  );

  it('accounts for every block once, and both revisions can be rebuilt', () => {
    fc.assert(
      fc.property(blocks, blocks, fc.boolean(), (before, after, pairReplacements) => {
        const entries = diffBlocks(before, after, { ...options, pairReplacements });
        const olds = entries
          .flatMap((e) => (e.status === 'added' ? [] : [e]))
          .sort((x, y) => x.beforeIndex - y.beforeIndex);
        const news = entries.flatMap((e) => (e.status === 'removed' ? [] : [e]));
        expect(olds.map((e) => e.before)).toEqual(before);
        // Without sorting: entries already follow the new document's order.
        expect(news.map((e) => e.after)).toEqual(after);
      }),
      { numRuns: 2000 },
    );
  });

  it('gives the same verdicts as the reference on id-keyed documents', () => {
    const uniqueIds = fc.uniqueArray(fc.integer({ min: 0, max: 9 }), { maxLength: 10 });
    const node = (id: number, text: string): ReferenceNode => ({
      type: 'p',
      attrs: { blockId: `b_${String(id).padStart(16, '0')}` },
      content: [{ type: 'text', text }],
    });
    fc.assert(
      fc.property(
        uniqueIds,
        uniqueIds,
        fc.array(fc.boolean(), { minLength: 10, maxLength: 10 }),
        (from, to, edited) => {
          const before = from.map((id) => node(id, 'x'));
          const after = to.map((id) => node(id, edited[id] ? 'y' : 'x'));
          const key = (status: string, n: ReferenceNode) =>
            `${String(n.attrs!['blockId'])}:${status}`;
          const mine = diffBlocks(before, after, proseMirrorDiff<ReferenceNode>()).map((e) =>
            key(e.status, visibleBlock(e)),
          );
          const reference = referenceDiff(before, after).map((e) =>
            key(e.status, e.node),
          );
          expect([...mine].sort()).toEqual([...reference].sort());
        },
      ),
      { numRuns: 2000 },
    );
  });

  it('lists blocks in the reference’s exact order when nothing moved', () => {
    const node = (id: number): ReferenceNode => ({
      type: 'p',
      attrs: { blockId: `b_${String(id).padStart(16, '0')}` },
    });
    fc.assert(
      fc.property(
        fc.subarray([0, 1, 2, 3, 4, 5, 6, 7]),
        fc.subarray([0, 1, 2, 3, 4, 5, 6, 7]),
        (from, to) => {
          const before = from.map(node);
          const after = to.map(node);
          const mine = diffBlocks(before, after, proseMirrorDiff<ReferenceNode>());
          const reference = referenceDiff(before, after);
          expect(mine.map((e) => [e.status, visibleBlock(e)])).toEqual(
            reference.map((e) => [e.status, e.node]),
          );
        },
      ),
      { numRuns: 1000 },
    );
  });

  it('finds as many unchanged blocks as the reference on documents without ids', () => {
    const text = fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 10 });
    fc.assert(
      fc.property(text, text, (from, to) => {
        const node = (t: string): ReferenceNode => ({
          type: 'p',
          content: [{ type: 'text', text: t }],
        });
        const count = (statuses: string[]) => statuses.filter((s) => s === 'unchanged').length;
        const mine = diffBlocks(from.map(node), to.map(node), proseMirrorDiff<ReferenceNode>());
        const reference = referenceDiff(from.map(node), to.map(node));
        expect(count(mine.map((e) => e.status))).toBe(count(reference.map((e) => e.status)));
      }),
      { numRuns: 1000 },
    );
  });
});

describe('scale', () => {
  it('diffs 20,000 blocks without ids in bounded memory', () => {
    const before = Array.from({ length: 20_000 }, (_, i) => `block ${i}`);
    const after = before.filter((_, i) => i % 50 !== 0).map((t, i) => (i % 97 === 0 ? `${t}!` : t));
    const start = performance.now();
    const counts = summarizeBlockDiff(diffBlocks(before, after));
    expect(performance.now() - start).toBeLessThan(3000);
    expect(counts.unchanged).toBeGreaterThan(19_000);
  });

  it('degrades to a replacement when a huge region shares nothing unique', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `x${i % 2}`);
    const after = Array.from({ length: 3000 }, (_, i) => `y${i % 2}`);
    expect(summarizeBlockDiff(diffBlocks(before, after))).toMatchObject({ modified: 3000 });
  });
});
