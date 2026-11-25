import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

/**
 * Plain-click link opening in the live editor. Links inside contenteditable do not navigate
 * natively.
 *
 * - A plain left click opens the link, using the href from the mark. `onOpen` owns the safety check
 *   and how to navigate; a falsy return leaves the click to the editor. The check is not imported
 *   here, to avoid an import cycle with the schema.
 * - A drag across a link never opens it, and Shift- and Alt-click are left alone.
 * - Node views carry no `link` mark and are unaffected.
 *
 * Read-only editors get no plugin; the browser follows links natively.
 */
export interface RichLinkClickOptions {
  /**
   * Executes the open; returns whether it actually opened (false for
   * draft/unsafe hrefs, which then behave as an ordinary editor click).
   * `null` (validator/preview mounts) registers no plugin at all.
   */
  onOpen: ((href: string) => boolean) | null;
}

/** The `handleClick` body, exported for tests. Returns `true` when it opened a link. */
export function handleRichLinkClick(
  view: EditorView,
  pos: number,
  event: MouseEvent,
  onOpen: (href: string) => boolean
): boolean {
  if (event.button !== 0) return false;
  if (event.shiftKey || event.altKey) return false;
  if (!view.editable) return false;

  // The pointer must actually be on a rendered anchor inside this editor —
  // a click at a doc position that merely maps NEAR link text (e.g. line
  // padding) must not navigate.
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const anchor = target.closest('a');
  if (!anchor || !view.dom.contains(anchor)) return false;

  // Canonical href from the link mark at the clicked position — never the
  // DOM's presentation href. Node-view anchors carry no link mark and fall
  // through here.
  const linkType = view.state.schema.marks.link;
  if (!linkType) return false;
  const $pos = view.state.doc.resolve(pos);
  const mark =
    $pos.nodeAfter?.marks.find((candidate) => candidate.type === linkType) ??
    $pos.nodeBefore?.marks.find((candidate) => candidate.type === linkType) ??
    $pos.marks().find((candidate) => candidate.type === linkType);
  if (!mark) return false;

  const href = typeof mark.attrs.href === 'string' ? mark.attrs.href : '';
  if (!href) return false;

  return onOpen(href);
}

export const RichLinkClick = Extension.create<RichLinkClickOptions>({
  name: 'richLinkClick',

  addOptions() {
    return { onOpen: null };
  },

  addProseMirrorPlugins() {
    const { onOpen } = this.options;
    if (!onOpen) return [];
    return [
      new Plugin({
        key: new PluginKey('richLinkClick'),
        props: {
          handleClick: (view, pos, event) => handleRichLinkClick(view, pos, event, onOpen)
        }
      })
    ];
  }
});
