import { getMarkRange, type Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

import { richLinkAttrsForHref } from './stable-link.ts';

/** Edits a link's display text from the link popover. */

/**
 * The display text of the link mark under the cursor/selection — the full
 * mark range's text, not just the selected slice — used to seed the
 * popover's Text field. Falls back to the raw selection text when no link
 * mark is present (fresh draft edge case).
 */
export function getRichLinkText(editor: Editor): string {
  const { state } = editor;
  const linkType = state.schema.marks.link;
  const range =
    getMarkRange(state.selection.$from, linkType) ?? getMarkRange(state.selection.$to, linkType);
  if (!range) return state.doc.textBetween(state.selection.from, state.selection.to);
  return state.doc.textBetween(range.from, range.to);
}

/**
 * Commits a link edit as ONE undoable transaction: extends the selection to
 * the full link mark range, replaces its text when `nextText` differs
 * (preserving the range's other marks — bold/italic/etc. are carried over
 * from the range's first text node), then (re)applies the link mark with
 * `nextHref` (plus the derived internal-target attrs above) across the
 * result. When `nextText` is empty/unchanged only the href updates — so
 * "drop a bare URL" keeps text = URL until edited.
 *
 * `setMark` rather than `setLink`: the stock command's attribute type
 * doesn't admit our extended internal-target attrs (and its isAllowedUri
 * gate re-checks a href our callers already canonicalized).
 */
export function applyRichLinkUpdate(
  editor: Editor,
  nextHref: string,
  nextText?: string | null
): boolean {
  const desired = nextText?.trim() ?? '';
  return editor
    .chain()
    .focus()
    .extendMarkRange('link')
    .command(({ tr, state }) => {
      if (!desired) return true;
      const { from, to } = tr.selection;
      const current = tr.doc.textBetween(from, to);
      if (desired === current) return true;
      const linkType = state.schema.marks.link;
      const carriedMarks = (tr.doc.resolve(from).nodeAfter?.marks ?? []).filter(
        (mark) => mark.type !== linkType
      );
      tr.replaceWith(from, to, state.schema.text(desired, carriedMarks));
      tr.setSelection(TextSelection.create(tr.doc, from, from + desired.length));
      return true;
    })
    .setMark('link', richLinkAttrsForHref(nextHref))
    .run();
}
