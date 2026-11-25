import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Transform } from '@tiptap/pm/transform';

import { generateRichBlockId, RICH_BLOCK_IDENTITY_NODE_TYPES } from './block-identity.ts';
import type { EditorNode } from './types.ts';

const BLOCK_ID_NODE_TYPE_SET: ReadonlySet<string> = new Set(RICH_BLOCK_IDENTITY_NODE_TYPES);

/**
 * Moves the top-level node at `sourcePos` to just before `targetPos` (both positions in the
 * pre-move document). Works on any `Transform`, live or headless.
 *
 * It deletes and inserts the same immutable `Node`, so every attribute, including descendants'
 * `blockId`, is preserved. Returns `false` for a no-op drop.
 */
export function applyRichBlockMove<T extends Transform>(
  tr: T,
  sourcePos: number,
  targetPos: number
): boolean {
  if (sourcePos < 0 || sourcePos >= tr.doc.content.size) return false;
  const sourceNode: ProseMirrorNode | null = tr.doc.nodeAt(sourcePos);
  if (!sourceNode) return false;

  const sourceSize = sourceNode.nodeSize;
  if (targetPos === sourcePos || targetPos === sourcePos + sourceSize) return false;
  // A target strictly inside the source's own range is not a meaningful
  // move (and would corrupt the delete/insert below) — defensive guard,
  // not expected to be reachable from the view layer's own position math.
  if (targetPos > sourcePos && targetPos < sourcePos + sourceSize) return false;

  tr.delete(sourcePos, sourcePos + sourceSize);
  const mappedTargetPos = tr.mapping.map(targetPos);
  tr.insert(mappedTargetPos, sourceNode);
  return true;
}

/**
 * Deletes the top-level block at `pos`. A bare `tr.delete` down to zero
 * top-level children would leave the `doc` node empty, which fails the
 * schema's `content: 'block+'` requirement the moment this transaction is
 * dispatched through a live `EditorState` (`schema.ts`'s `Document`, via
 * `@tiptap/extension-document`'s default) — so deleting the document's last
 * remaining block replaces it with an empty paragraph instead, the same
 * floor every block editor enforces (clear a block's content, never delete
 * down to nothing).
 */
export function applyRichBlockDelete<T extends Transform>(tr: T, pos: number): boolean {
  if (pos < 0 || pos >= tr.doc.content.size) return false;
  const node: ProseMirrorNode | null = tr.doc.nodeAt(pos);
  if (!node) return false;

  const size = node.nodeSize;
  if (tr.doc.childCount <= 1) {
    const paragraphType = tr.doc.type.schema.nodes.paragraph;
    if (!paragraphType) return false;
    tr.replaceWith(pos, pos + size, paragraphType.create());
    return true;
  }
  tr.delete(pos, pos + size);
  return true;
}

/**
 * Replaces every `blockId` (`block-identity.ts`) in `node`'s own subtree with
 * a freshly generated one — depth-first, so a duplicated container (e.g. a
 * table) gets new ids on every row/cell too, not just the top node. JSON
 * round-trip (`toJSON()` → walk → `nodeFromJSON()`) rather than
 * `node.type.create()` recursion: block-identity nodes carry heterogeneous
 * content models (inline text, block children, or atoms), and JSON is the
 * one shape that already flows uniformly through all of them elsewhere in
 * this module set (`save-state.ts`, `importer.ts`).
 *
 * A duplicate command dispatched through the LIVE editor would get this for
 * free from `RichBlockIdentity`'s own `appendTransaction` (it reassigns
 * any later-in-document-order duplicate id automatically — see that file's
 * doc comment). This helper makes `applyRichBlockDuplicate` independently
 * correct even off that live pipeline, matching `block-move.test.ts`'s
 * headless `Transform`-only harness (`appendTransaction` never runs against a
 * bare `Transform`, only a live `EditorView` — see `block-identity.test.ts`).
 */
function withFreshRichBlockIds(node: ProseMirrorNode): ProseMirrorNode {
  const schema = node.type.schema;
  const json = node.toJSON() as EditorNode;

  const assignFresh = (source: EditorNode): EditorNode => {
    const next: EditorNode = { ...source };
    if (BLOCK_ID_NODE_TYPE_SET.has(source.type) && typeof source.attrs?.blockId === 'string') {
      next.attrs = { ...source.attrs, blockId: generateRichBlockId() };
    }
    if (source.content) next.content = source.content.map(assignFresh);
    return next;
  };

  return schema.nodeFromJSON(assignFresh(json));
}

/**
 * Inserts a copy of the top-level block at `pos` immediately after itself,
 * with fresh `blockId`s throughout the copy (see `withFreshRichBlockIds`)
 * so the duplicate is a distinct block, not a second reference to the same
 * identity.
 */
export function applyRichBlockDuplicate<T extends Transform>(tr: T, pos: number): boolean {
  if (pos < 0 || pos >= tr.doc.content.size) return false;
  const node: ProseMirrorNode | null = tr.doc.nodeAt(pos);
  if (!node) return false;

  tr.insert(pos + node.nodeSize, withFreshRichBlockIds(node));
  return true;
}

/**
 * Strips inline marks from the block at `pos` and its descendants. The block type is kept: several
 * types have content that cannot become a paragraph.
 */
export function applyRichBlockResetFormatting<T extends Transform>(tr: T, pos: number): boolean {
  if (pos < 0 || pos >= tr.doc.content.size) return false;
  const node: ProseMirrorNode | null = tr.doc.nodeAt(pos);
  if (!node) return false;

  const from = pos + 1;
  const to = pos + node.nodeSize - 1;
  if (to <= from) return false; // Atom (e.g. image) or empty node — nothing to clear.

  tr.removeMark(from, to, null);
  return true;
}
