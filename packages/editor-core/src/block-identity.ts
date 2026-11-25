import { Extension } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

import { RICH_BLOCK_IDENTITY_NODE_TYPES, generateRichBlockId } from './block-id.ts';

export {
  RICH_BLOCK_ID_PATTERN,
  RICH_BLOCK_IDENTITY_NODE_TYPES,
  generateRichBlockId,
  type RichBlockIdentityNodeType
} from './block-id.ts';

const BLOCK_ID_NODE_TYPE_SET: ReadonlySet<string> = new Set(RICH_BLOCK_IDENTITY_NODE_TYPES);

const richBlockIdentityPluginKey = new PluginKey('richBlockIdentity');

/**
 * Assigns a fresh `blockId` to every identity node without a unique one, writing into `tr`. Returns
 * whether anything changed. Used for the initial state (which `appendTransaction` never sees) and
 * for every edit.
 *
 * - New nodes start at `null` and are assigned here.
 * - A split copies attrs to both halves; the first occurrence keeps the id.
 * - A merge keeps the surviving node's id.
 */
function assignMissingRichBlockIds(doc: ProseMirrorNode, tr: Transaction): boolean {
  const seen = new Set<string>();
  let modified = false;

  doc.descendants((node, pos) => {
    if (!BLOCK_ID_NODE_TYPE_SET.has(node.type.name)) return true;

    const current = node.attrs.blockId;
    if (typeof current === 'string' && current.length > 0 && !seen.has(current)) {
      seen.add(current);
      return true;
    }

    const fresh = generateRichBlockId();
    seen.add(fresh);
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, blockId: fresh }, node.marks);
    modified = true;
    return true;
  });

  return modified;
}

export const RichBlockIdentity = Extension.create({
  name: 'richBlockIdentity',

  addGlobalAttributes() {
    return [
      {
        types: [...RICH_BLOCK_IDENTITY_NODE_TYPES],
        attributes: {
          blockId: {
            default: null,
            // Client-generated, internal-only identity — never read from or
            // written to the DOM.
            parseHTML: () => null,
            renderHTML: () => ({})
          }
        }
      }
    ];
  },

  // ProseMirror does not run `appendTransaction` for the initial state, so a document opened
  // without ids is assigned them here. Tiptap fires `create` one macrotask after construction;
  // tests must await that tick.
  onCreate() {
    const { view, state } = this.editor;
    const tr = state.tr;
    if (!assignMissingRichBlockIds(state.doc, tr)) return;
    tr.setMeta('addToHistory', false);
    view.dispatch(tr);
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: richBlockIdentityPluginKey,
        appendTransaction: (transactions, oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          if (oldState.doc.eq(newState.doc)) return null;
          const tr = newState.tr;
          if (!assignMissingRichBlockIds(newState.doc, tr)) return null;
          // Id-assignment is internal bookkeeping, not user content — keep it
          // out of the undo stack so undoing an edit never needs a second
          // undo just to remove the id side-effect.
          tr.setMeta('addToHistory', false);
          return tr;
        }
      })
    ];
  }
});
