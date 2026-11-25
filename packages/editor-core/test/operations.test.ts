import { describe, expect, it } from 'bun:test';

import {
  applyDocumentOperations,
  createDocumentService,
  DocumentConflictError,
  DocumentOperationError,
  DocumentReadOnlyError,
  DocumentValidationError,
  ensureBlockIds,
  findBlock,
  getDocumentOutline,
  listBlocks,
  MemoryDocumentStore,
  nodeText,
  type EditorDocument,
  type EditorNode
} from '../src/index.ts';
import { doc, li, p, text, ul } from './fixtures.ts';

const heading = (level: number, value: string): EditorNode => ({
  type: 'heading',
  attrs: { level },
  content: [text(value)]
});

function sample(): EditorDocument {
  return ensureBlockIds(
    doc(
      heading(1, 'Title'),
      p('intro ', text('bold', { type: 'bold' }), ' text'),
      heading(2, 'One'),
      p('one'),
      ul(li(p('item'))),
      heading(2, 'Two'),
      p('two')
    )
  );
}
const idAt = (document: EditorDocument, index: number): string =>
  document.content![index]!.attrs!.blockId as string;
const texts = (document: EditorDocument): string[] => document.content!.map(nodeText);

describe('block ids', () => {
  it('are assigned once, kept, and deduplicated', () => {
    const first = sample();
    expect(ensureBlockIds(first)).toEqual(first);
    const duplicated = doc(first.content![1]!, first.content![1]!);
    const fixed = ensureBlockIds(duplicated);
    expect(idAt(fixed, 0)).toBe(idAt(first, 1));
    expect(idAt(fixed, 1)).not.toBe(idAt(fixed, 0));
  });
  it('drive listing, outline and lookup', () => {
    const document = sample();
    expect(listBlocks(document).map((block) => `${block.depth}:${block.type}`)).toContain('2:paragraph');
    expect(getDocumentOutline(document).map(({ level, text: label }) => [level, label])).toEqual([
      [1, 'Title'],
      [2, 'One'],
      [2, 'Two']
    ]);
    expect(nodeText(findBlock(document, idAt(document, 3))!)).toBe('one');
  });
});

describe('applyDocumentOperations', () => {
  it('inserts Markdown relative to a block', () => {
    const document = sample();
    const next = applyDocumentOperations(document, [
      { op: 'insert', position: { after: idAt(document, 1) }, markdown: '> [!TIP]\n> New' },
      { op: 'insert', position: { at: 'end' }, content: [p('last')] }
    ]);
    expect(next.content![2]!.type).toBe('callout');
    expect(texts(next).at(-1)).toBe('last');
    expect(idAt(next, 0)).toBe(idAt(document, 0));
  });
  it('replaces a block and keeps its id when the type is unchanged', () => {
    const document = sample();
    const next = applyDocumentOperations(document, [
      { op: 'replace', blockId: idAt(document, 3), markdown: 'uno' }
    ]);
    expect(texts(next)[3]).toBe('uno');
    expect(idAt(next, 3)).toBe(idAt(document, 3));
  });
  it('replaces a section up to the next peer heading', () => {
    const document = sample();
    const next = applyDocumentOperations(document, [
      { op: 'replaceSection', headingId: idAt(document, 2), markdown: 'a\n\nb' }
    ]);
    expect(texts(next).slice(2)).toEqual(['One', 'a', 'b', 'Two', 'two']);
  });
  it('moves, deletes and updates attributes', () => {
    const document = sample();
    const next = applyDocumentOperations(document, [
      { op: 'move', blockId: idAt(document, 6), position: { before: idAt(document, 1) } },
      { op: 'delete', blockId: idAt(document, 4) },
      { op: 'setAttrs', blockId: idAt(document, 0), attrs: { anchorId: 'title' } }
    ]);
    expect(texts(next)).toEqual(['Title', 'two', 'intro bold text', 'One', 'one', 'Two']);
    expect(next.content![0]!.attrs!.anchorId).toBe('title');
  });
  it('replaces text across marks and keeps the surrounding formatting', () => {
    const document = sample();
    const next = applyDocumentOperations(document, [
      { op: 'replaceText', find: 'intro bo', replace: 'X' }
    ]);
    expect(next.content![1]!.content).toEqual([
      text('X'),
      text('ld', { type: 'bold' }),
      text(' text')
    ]);
  });
  it('refuses ambiguous or missing text', () => {
    const document = sample();
    expect(() =>
      applyDocumentOperations(document, [{ op: 'replaceText', find: 'o', replace: 'x' }])
    ).toThrow(/found/);
    expect(() =>
      applyDocumentOperations(document, [{ op: 'replaceText', find: 'absent', replace: 'x' }])
    ).toThrow(/found 0/);
    expect(
      texts(
        applyDocumentOperations(document, [
          { op: 'replaceText', find: 'one', replace: '1', blockId: idAt(document, 3) }
        ])
      )[3]
    ).toBe('1');
  });
  it('is all-or-nothing and reports the failing operation', () => {
    const document = sample();
    const before = structuredClone(document);
    let error: unknown;
    try {
      applyDocumentOperations(document, [
        { op: 'delete', blockId: idAt(document, 1) },
        { op: 'delete', blockId: 'b_0000000000000000' }
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DocumentOperationError);
    expect((error as DocumentOperationError).operationIndex).toBe(1);
    expect(document).toEqual(before);
  });
  it('rejects results that are not valid documents', () => {
    const document = sample();
    expect(() =>
      applyDocumentOperations(document, [
        { op: 'setAttrs', blockId: idAt(document, 0), attrs: { level: 9 } }
      ])
    ).toThrow(/Heading level/);
    expect(() =>
      applyDocumentOperations(document, [
        { op: 'insert', position: { at: 'end' }, markdown: '[x](javascript:alert(1))' }
      ])
    ).toThrow(DocumentOperationError);
    expect(() =>
      applyDocumentOperations(document, [
        { op: 'move', blockId: idAt(document, 4), position: { after: idAt(document, 4) } }
      ])
    ).toThrow(/relative to itself/);
  });
  it('never empties a document', () => {
    const document = ensureBlockIds(doc(p('x')));
    const next = applyDocumentOperations(document, [{ op: 'delete', blockId: idAt(document, 0) }]);
    expect(next.content).toHaveLength(1);
  });
});

describe('document service', () => {
  const setup = () => {
    let id = 0;
    return createDocumentService({
      store: new MemoryDocumentStore(),
      createId: () => `id-${(id += 1)}`,
      now: () => new Date(0)
    });
  };

  it('versions every write and restores as a new revision', async () => {
    const service = setup();
    const created = await service.create({ title: 'A', content: doc(p('v1')), actorId: 'u' });
    const saved = await service.save({
      id: created.id,
      expectedVersion: 1,
      content: doc(p('v2')),
      title: 'B',
      actorId: 'u'
    });
    expect(saved.version).toBe(2);
    const [, first] = await service.listRevisions(created.id);
    const restored = await service.restore({
      id: created.id,
      revisionId: first!.id,
      expectedVersion: 2,
      actorId: 'u'
    });
    expect(restored).toMatchObject({ version: 3, title: 'A', content: doc(p('v1')) });
    const revisions = await service.listRevisions(created.id);
    expect(revisions.map(({ version, operation }) => [version, operation])).toEqual([
      [3, 'restore'],
      [2, 'save'],
      [1, 'create']
    ]);
    expect(revisions[0]!.restoredFromRevisionId).toBe(first!.id);
    expect((await service.listRevisions(created.id, { limit: 1, offset: 1 }))[0]!.version).toBe(2);
  });

  it('rejects stale writes, including operations, without recording a revision', async () => {
    const service = setup();
    const { id } = await service.create({ title: 'A', content: doc(p('x')), actorId: 'u' });
    await service.save({ id, expectedVersion: 1, content: doc(p('y')), actorId: 'u' });
    await expect(
      service.save({ id, expectedVersion: 1, content: doc(p('z')), actorId: 'u' })
    ).rejects.toBeInstanceOf(DocumentConflictError);
    await expect(
      service.applyOperations({
        id,
        expectedVersion: 1,
        operations: [{ op: 'replaceText', find: 'y', replace: 'z' }],
        actorId: 'agent'
      })
    ).rejects.toBeInstanceOf(DocumentConflictError);
    expect(await service.listRevisions(id)).toHaveLength(2);
    const next = await service.applyOperations({
      id,
      expectedVersion: 2,
      operations: [{ op: 'replaceText', find: 'y', replace: 'z' }],
      actorId: 'agent'
    });
    expect(nodeText(next.content)).toBe('z');
    expect(next.updatedBy).toBe('agent');
  });

  it('only one of two concurrent writers wins', async () => {
    const service = setup();
    const { id } = await service.create({ title: 'A', actorId: 'u' });
    const results = await Promise.allSettled(
      ['a', 'b'].map((value) =>
        service.save({ id, expectedVersion: 1, content: doc(p(value)), actorId: 'u' })
      )
    );
    expect(results.map((result) => result.status).toSorted()).toEqual(['fulfilled', 'rejected']);
  });

  it('validates content, applies host policy and protects archived documents', async () => {
    const service = createDocumentService({
      store: new MemoryDocumentStore(),
      contentPolicy: ({ content }) => {
        if (nodeText(content).includes('secret')) throw new Error('no');
      }
    });
    await expect(
      service.create({ title: 'A', content: { type: 'doc', content: [{ type: 'nope' }] }, actorId: 'u' })
    ).rejects.toBeInstanceOf(DocumentValidationError);
    await expect(
      service.create({ title: 'A', content: doc(p('secret')), actorId: 'u' })
    ).rejects.toBeInstanceOf(DocumentValidationError);
    const { id } = await service.create({ title: 'A', actorId: 'u' });
    expect((await service.get(id)).content).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    await service.archive({ id, expectedVersion: 1, actorId: 'u' });
    await expect(
      service.save({ id, expectedVersion: 2, content: doc(p('x')), actorId: 'u' })
    ).rejects.toBeInstanceOf(DocumentReadOnlyError);
  });
});
