/**
 * Resource insertion. The slash command asks the editor to open a picker; this pure function turns
 * the choice into a node.
 */

import type { Editor } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';

import { isInlineReferenceKind } from '@formless63/editor-core';
import type { RichResourceSelector } from '@formless63/editor-core';

import { richResourceCardDefaultPresentation } from '@formless63/editor-core';

/**
 * Event the `/resource` command raises to open the picker. The position is read when a choice is
 * made, because the selection stays put while the dialog has focus.
 */
export const RICH_RESOURCE_PICKER_EVENT = 'rich-resource-picker-open';

/**
 * One resource the picker dialog resolved — either from the "search
 * existing resources" tab or the "URL reference" quick-create tab.
 */
export interface RichResourcePickResult {
  resourceId: string;
  title: string;
  description: string | null;
  kind: string;
  selector: RichResourceSelector;
}

/** Inserts a picked resource as a `resourceCard` at `pos`. Returns whether the command ran. */
export function insertRichResourceCard(
  editor: Editor,
  pos: number,
  picked: RichResourcePickResult
): boolean {
  return editor
    .chain()
    .insertContentAt(pos, {
      type: 'resourceCard',
      attrs: {
        resourceId: picked.resourceId,
        title: picked.title,
        description: picked.description,
        kind: picked.kind,
        selector: picked.selector,
        // Picker references start as cards; the upload pipeline independently
        // enables previews for fresh files with a safe viewer.
        presentation: richResourceCardDefaultPresentation(picked.kind)
      }
    })
    .run();
}

/**
 * Insert one picked resource as an INLINE `resourceChip` at `pos` (schema
 * v6). Chips carry the card's reference identity minus its
 * presentation attrs — `description` is deliberately dropped (chips have no
 * meta line; converting back to a card restores it as null).
 */
export function insertRichResourceChip(
  editor: Editor,
  pos: number,
  picked: RichResourcePickResult
): boolean {
  return editor
    .chain()
    .insertContentAt(pos, {
      type: 'resourceChip',
      attrs: {
        resourceId: picked.resourceId,
        title: picked.title,
        kind: picked.kind,
        selector: picked.selector
      }
    })
    .run();
}

/**
 * Inserts inline kinds as a chip and everything else as a card. Either can be converted afterwards.
 */
export function insertRichResourcePick(
  editor: Editor,
  pos: number,
  picked: RichResourcePickResult
): boolean {
  return isInlineReferenceKind(picked.kind)
    ? insertRichResourceChip(editor, pos, picked)
    : insertRichResourceCard(editor, pos, picked);
}

/**
 * Conversions between card and chip.
 *
 * - Card to chip: replaced in place by a paragraph holding the chip; presentation attrs are
 *   dropped.
 * - Chip to card: a card is inserted after the containing block, and the chip is removed.
 *
 * Both return false when the selection is not the expected node.
 */
export function convertRichResourceCardToChip(editor: Editor): boolean {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'resourceCard') {
    return false;
  }
  const attrs = selection.node.attrs;
  return editor
    .chain()
    .command(({ state, tr }) => {
      const chip = state.schema.nodes.resourceChip.create({
        resourceId: attrs.resourceId,
        title: attrs.title,
        kind: attrs.kind,
        selector: attrs.selector
      });
      const paragraph = state.schema.nodes.paragraph.create(null, chip);
      tr.replaceWith(selection.from, selection.to, paragraph);
      return true;
    })
    .focus()
    .run();
}

export function convertRichResourceChipToCard(editor: Editor): boolean {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'resourceChip') {
    return false;
  }
  const attrs = selection.node.attrs;
  return editor
    .chain()
    .command(({ state, tr }) => {
      const $from = state.doc.resolve(selection.from);
      // Position immediately after the block containing the chip (its
      // parent at the chip's own depth).
      const afterBlock = $from.after();
      const card = state.schema.nodes.resourceCard.create({
        resourceId: attrs.resourceId,
        title: attrs.title,
        description: null,
        kind: attrs.kind,
        selector: attrs.selector
      });
      tr.delete(selection.from, selection.to);
      tr.insert(tr.mapping.map(afterBlock), card);
      return true;
    })
    .focus()
    .run();
}
