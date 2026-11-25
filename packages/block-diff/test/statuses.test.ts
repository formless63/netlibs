import { describe, expect, it } from 'vitest';

import { diffBlocks, visibleBlock } from '../src/index.ts';
import { proseMirrorDiff } from '../src/prosemirror.ts';
import type { ReferenceNode } from './reference.ts';

function compare(
  from: readonly ReferenceNode[],
  to: readonly ReferenceNode[],
) {
  const options = proseMirrorDiff<ReferenceNode>();
  const keyed = [...from, ...to].some((node) => options.getId!(node) !== null);
  return diffBlocks(from, to, { ...options, pairReplacements: !keyed }).map((entry) => ({
    status: entry.status,
    blockId: entry.id,
    node: visibleBlock(entry),
    matchedBy: keyed ? 'blockId' : 'position',
  }));
}

function blockId(label: string): string {
  return `b_${label.padStart(16, '0')}`;
}
const ID_1 = blockId('1');
const ID_2 = blockId('2');
const ID_3 = blockId('3');

function paragraph(text: string, id?: string): ReferenceNode {
  return {
    type: 'paragraph',
    ...(id ? { attrs: { blockId: id } } : {}),
    content: [{ type: 'text', text }]
  };
}

describe('compare — blockId-keyed matching', () => {
  it('marks every block unchanged when nothing differs', () => {
    const from = [paragraph('Alpha', ID_1), paragraph('Beta', ID_2)];
    const to = [paragraph('Alpha', ID_1), paragraph('Beta', ID_2)];

    const diff = compare(from, to);

    expect(diff.map((entry) => entry.status)).toEqual(['unchanged', 'unchanged']);
    expect(diff.every((entry) => entry.matchedBy === 'blockId')).toBe(true);
  });

  it('detects an added block by blockId absent from the predecessor', () => {
    const from = [paragraph('Alpha', ID_1)];
    const to = [paragraph('Alpha', ID_1), paragraph('Gamma', ID_3)];

    const diff = compare(from, to);

    expect(diff).toHaveLength(2);
    expect(diff[0]).toMatchObject({ status: 'unchanged', blockId: ID_1 });
    expect(diff[1]).toMatchObject({ status: 'added', blockId: ID_3 });
  });

  it('detects a removed block by blockId absent from the successor, shown inline', () => {
    const from = [paragraph('Alpha', ID_1), paragraph('Beta', ID_2), paragraph('Gamma', ID_3)];
    const to = [paragraph('Alpha', ID_1), paragraph('Gamma', ID_3)];

    const diff = compare(from, to);

    expect(diff.map((entry) => [entry.status, entry.blockId])).toEqual([
      ['unchanged', ID_1],
      ['removed', ID_2],
      ['unchanged', ID_3]
    ]);
    expect(diff[1].node).toEqual(from[1]);
  });

  it('detects a modified block by blockId with unchanged content elsewhere', () => {
    const from = [paragraph('Alpha', ID_1), paragraph('Beta', ID_2)];
    const to = [paragraph('Alpha', ID_1), paragraph('Beta v2', ID_2)];

    const diff = compare(from, to);

    expect(diff.map((entry) => entry.status)).toEqual(['unchanged', 'modified']);
    expect(diff[1].node).toEqual(to[1]);
  });

  it('detects a moved block (same id, same content, different position) distinctly from modified', () => {
    const from = [paragraph('Alpha', ID_1), paragraph('Beta', ID_2), paragraph('Gamma', ID_3)];
    const to = [paragraph('Gamma', ID_3), paragraph('Alpha', ID_1), paragraph('Beta', ID_2)];

    const diff = compare(from, to);

    const byId = new Map(diff.map((entry) => [entry.blockId, entry.status]));
    expect(byId.get(ID_3)).toBe('moved');
    expect(byId.get(ID_1)).toBe('unchanged');
    expect(byId.get(ID_2)).toBe('unchanged');
  });

  it('classifies a moved-and-edited block as modified (content change wins over the moved label)', () => {
    const from = [paragraph('Alpha', ID_1), paragraph('Beta', ID_2), paragraph('Gamma', ID_3)];
    const to = [paragraph('Gamma v2', ID_3), paragraph('Alpha', ID_1), paragraph('Beta', ID_2)];

    const diff = compare(from, to);
    const byId = new Map(diff.map((entry) => [entry.blockId, entry.status]));
    expect(byId.get(ID_3)).toBe('modified');
    expect(byId.get(ID_1)).toBe('unchanged');
    expect(byId.get(ID_2)).toBe('unchanged');
  });

  it('treats blocks without a blockId in an otherwise-keyed document as unmatchable adds/removes', () => {
    const from = [paragraph('Alpha', ID_1), paragraph('Untracked legacy block')];
    const to = [paragraph('Alpha', ID_1), paragraph('Different untracked block')];

    const diff = compare(from, to);

    expect(diff.map((entry) => entry.status).toSorted()).toEqual(
      ['added', 'removed', 'unchanged'].toSorted()
    );
  });
});

describe('compare — documents without ids', () => {
  it('falls back to positional content diff when neither revision carries blockId', () => {
    const from = [paragraph('Alpha'), paragraph('Beta'), paragraph('Gamma')];
    const to = [paragraph('Alpha'), paragraph('Gamma'), paragraph('Delta')];

    const diff = compare(from, to);

    expect(diff.every((entry) => entry.matchedBy === 'position')).toBe(true);
    expect(diff.map((entry) => entry.status)).toEqual([
      'unchanged',
      'removed',
      'unchanged',
      'added'
    ]);
  });

  it('merges an adjacent remove+add pair into a single modified entry under positional fallback', () => {
    const from = [paragraph('Alpha'), paragraph('Beta original')];
    const to = [paragraph('Alpha'), paragraph('Beta edited')];

    const diff = compare(from, to);

    expect(diff.map((entry) => entry.status)).toEqual(['unchanged', 'modified']);
    expect(diff[1].node).toEqual(to[1]);
  });

  it('handles a purely positional insertion and deletion without blockId', () => {
    const from = [paragraph('One'), paragraph('Two')];
    const to = [paragraph('Zero'), paragraph('One'), paragraph('Two'), paragraph('Three')];

    const diff = compare(from, to);

    expect(diff.map((entry) => entry.status)).toEqual(['added', 'unchanged', 'unchanged', 'added']);
  });
});
