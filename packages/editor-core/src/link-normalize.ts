import { Extension } from '@tiptap/core';
import type { Mark } from '@tiptap/pm/model';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { canonicalizeRichHref, richLinkAttrsForHref } from './stable-link.ts';

export const RICH_LINK_REL = 'noopener noreferrer nofollow';

function canonicalLinkAttrs(mark: Mark): Record<string, unknown> | null {
  const raw = typeof mark.attrs.href === 'string' ? mark.attrs.href : '';
  const href = canonicalizeRichHref(raw);
  if (!href) return null;
  return {
    ...mark.attrs,
    ...richLinkAttrsForHref(href),
    class: null,
    rel: mark.attrs.rel === null ? null : RICH_LINK_REL,
    target: mark.attrs.target === '_blank' ? '_blank' : null
  };
}

function normalizeLinks(doc: ProseMirrorNode, tr: Transaction): boolean {
  let changed = false;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const mark = node.marks.find((candidate) => candidate.type.name === 'link');
    if (!mark) return true;
    const attrs = canonicalLinkAttrs(mark);
    const to = pos + node.nodeSize;
    if (!attrs) {
      tr.removeMark(pos, to, mark);
      changed = true;
      return true;
    }
    const next = mark.type.create(attrs);
    if (next.eq(mark)) return true;
    tr.removeMark(pos, to, mark).addMark(pos, to, next);
    changed = true;
    return true;
  });
  return changed;
}

/**
 * Keeps every link mark in canonical form as it enters the document.
 *
 * Tiptap's autolink, paste-link and `setLink` paths write whatever the user
 * typed (`https://example.com`, no trailing slash) plus any `class`/`rel` found
 * on a pasted anchor. The canonical validator rejects those, so without this
 * plugin an autolinked bare domain blocks the next save.
 */
export const RichLinkNormalizer = Extension.create({
  name: 'richLinkNormalizer',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('richLinkNormalizer'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const tr = newState.tr;
          return normalizeLinks(newState.doc, tr) ? tr : null;
        }
      })
    ];
  }
});
