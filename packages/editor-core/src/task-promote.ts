/**
 * Turns a checklist item into a task reference. `resolveRichTaskItemPromoteTarget` finds the
 * enclosing item and its text; `applyRichTaskItemPromote` swaps the node once the host has created
 * the task.
 *
 * `taskReference` is a block and cannot live inside `taskList`, so the list is split around it.
 */

import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { Fragment } from '@tiptap/pm/model';
import type { Transform } from '@tiptap/pm/transform';

export interface RichTaskItemPromoteTarget {
  /** Doc position immediately before the enclosing `taskList` node. */
  listPos: number;
  /** The target `taskItem`'s index among `taskList`'s children. */
  itemIndex: number;
  /** Plain text of the item's own content, EXCLUDING any nested checklist. */
  itemText: string;
  /**
   * True when the item has its own nested `taskList` (subtasks). Promoting
   * would silently discard those child items, so callers should disable the
   * affordance rather than promote in this case.
   */
  hasNestedChecklist: boolean;
  /**
   * The item's `blockId`, which the host can store as its anchor. `null` only before identity has
   * run; treat that as not ready.
   */
  editorNodeId: string | null;
}

/**
 * Resolve `$pos` (typically `editor.state.selection.$from`) to its enclosing
 * `taskItem`/`taskList` pair, or `null` when the selection is not inside a
 * (nested-only-one-level) task item. Nested task items — `TaskItem.configure({
 * nested: true })`'s subtask support — resolve to their OWN immediate
 * `taskList` parent, so promoting a subtask only ever affects its own
 * sibling subtasks, never the parent item's list.
 */
export function resolveRichTaskItemPromoteTarget(
  $pos: ResolvedPos
): RichTaskItemPromoteTarget | null {
  let itemDepth = -1;
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    if ($pos.node(depth).type.name === 'taskItem') {
      itemDepth = depth;
      break;
    }
  }
  if (itemDepth === -1) return null;

  const listDepth = itemDepth - 1;
  if (listDepth < 0 || $pos.node(listDepth).type.name !== 'taskList') return null;

  const itemNode = $pos.node(itemDepth);
  let hasNestedChecklist = false;
  const textParts: string[] = [];
  itemNode.forEach((child) => {
    if (child.type.name === 'taskList') {
      hasNestedChecklist = true;
      return;
    }
    textParts.push(child.textContent);
  });

  const blockId = itemNode.attrs.blockId;

  return {
    listPos: $pos.before(listDepth),
    itemIndex: $pos.index(listDepth),
    editorNodeId: typeof blockId === 'string' && blockId.length > 0 ? blockId : null,
    itemText: textParts.join(' ').replace(/\s+/g, ' ').trim(),
    hasNestedChecklist
  };
}

/**
 * Replace the `taskItem` at `itemIndex` within the `taskList` at `listPos`
 * with a `taskReference` node carrying `attrs`, splitting the list around it
 * (see this module's header comment). Returns `false` (transform untouched)
 * for an out-of-range/stale position — same "chain commands return false
 * without throwing on a stale position" contract `block-move.ts` documents.
 */
export function applyRichTaskItemPromote<T extends Transform>(
  tr: T,
  listPos: number,
  itemIndex: number,
  attrs: { taskId: string; fallbackTitle: string }
): boolean {
  if (listPos < 0 || listPos >= tr.doc.content.size) return false;
  const listNode: ProseMirrorNode | null = tr.doc.nodeAt(listPos);
  if (!listNode || listNode.type.name !== 'taskList') return false;
  if (itemIndex < 0 || itemIndex >= listNode.childCount) return false;

  const schema = listNode.type.schema;
  const taskReferenceType = schema.nodes.taskReference;
  if (!taskReferenceType) return false;

  const children: ProseMirrorNode[] = [];
  listNode.forEach((child) => children.push(child));
  const before = children.slice(0, itemIndex);
  const after = children.slice(itemIndex + 1);

  const pieces: ProseMirrorNode[] = [];
  if (before.length > 0) pieces.push(listNode.type.create(listNode.attrs, Fragment.from(before)));
  pieces.push(taskReferenceType.create(attrs));
  if (after.length > 0) pieces.push(listNode.type.create(listNode.attrs, Fragment.from(after)));

  tr.replaceWith(listPos, listPos + listNode.nodeSize, Fragment.from(pieces));
  return true;
}
