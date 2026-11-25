import { describe, expect, it } from 'vitest';

import { createBlockId, ensureIds, renewIds } from '../src/index.ts';
import { proseMirrorTree, type ProseMirrorNode } from '../src/prosemirror.ts';

const tree = proseMirrorTree(['paragraph', 'heading']);
const fixture = (): ProseMirrorNode => ({
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2, blockId: 'h' } },
    { type: 'paragraph' },
    {
      type: 'quote',
      attrs: { blockId: 'ignored' },
      content: [
        { type: 'paragraph', attrs: { blockId: 'p' }, content: [{ type: 'text', text: 'x' }] },
      ],
    },
  ],
});
const ids = (node: ProseMirrorNode): unknown[] => [
  ...(node.attrs && 'blockId' in node.attrs ? [node.attrs['blockId']] : []),
  ...(node.content ?? []).flatMap(ids),
];

describe('createBlockId', () => {
  it('has the documented shape and does not repeat', () => {
    const made = Array.from({ length: 1000 }, createBlockId);
    for (const id of made) expect(id).toMatch(/^b_[0-9A-HJKMNP-TV-Z]{16}$/);
    expect(new Set(made).size).toBe(1000);
  });
});

describe('ensureIds', () => {
  it('fills only what is missing, keeping other attributes', () => {
    const doc = fixture();
    expect(ensureIds([doc], tree)).toBe(1);
    expect(doc.content![0]!.attrs).toEqual({ level: 2, blockId: 'h' });
    expect(doc.content![1]!.attrs!['blockId']).toMatch(/^b_/);
    expect(doc.content![2]!.content![0]!.attrs!['blockId']).toBe('p');
    expect(doc.content![2]!.content![0]!.content![0]!.attrs).toBeUndefined();
    expect(ensureIds([doc], tree)).toBe(0);
  });

  it('lets the first of several duplicates keep the id', () => {
    const doc: ProseMirrorNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { blockId: 'a' } },
        { type: 'paragraph', attrs: { blockId: 'a' } },
      ],
    };
    ensureIds([doc], tree);
    expect(ids(doc)[0]).toBe('a');
    expect(new Set(ids(doc)).size).toBe(2);
  });

  it('never hands out an id used later in the document', () => {
    const doc: ProseMirrorNode = {
      type: 'doc',
      content: [{ type: 'paragraph' }, { type: 'paragraph', attrs: { blockId: 'taken' } }],
    };
    const supply = ['taken', 'free'];
    ensureIds([doc], tree, () => supply.shift()!);
    expect(ids(doc)).toEqual(['free', 'taken']);
  });

  it('fails rather than loops when ids run out', () => {
    const doc: ProseMirrorNode = {
      type: 'doc',
      content: [{ type: 'paragraph' }, { type: 'paragraph' }],
    };
    expect(() => ensureIds([doc], tree, () => 'same')).toThrow('in use');
  });
});

describe('renewIds', () => {
  it('replaces every id, invents none, and shares nothing with the source', () => {
    const doc = fixture();
    expect(renewIds([doc], tree)).toBe(2);
    expect(doc.content![1]!.attrs).toBeUndefined();
    const renewed = [doc.content![0]!, doc.content![2]!.content![0]!].map(
      (n) => n.attrs!['blockId'],
    );
    expect(renewed).not.toContain('h');
    expect(renewed).not.toContain('p');
    expect(new Set(renewed).size).toBe(2);
  });

  it('never reissues an id the source used', () => {
    const doc = fixture();
    const supply = ['p', 'h', 'fresh-1', 'h', 'fresh-2'];
    renewIds([doc], tree, () => supply.shift()!);
    expect(ids(doc)).toEqual(['fresh-1', 'ignored', 'fresh-2']);
  });
});
