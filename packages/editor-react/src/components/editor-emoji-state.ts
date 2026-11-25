/**
 * The pure half of the emoji popover. `@tiptap/extension-emoji` is used only for its data: its node
 * would store every emoji as an atom, while here Unicode emojis are plain text.
 */

import type { EmojiItem } from '@tiptap/extension-emoji';

import { isRichCustomEmojiName } from '@formless63/editor-core';

export type { EmojiItem };

/**
 * Minimum query length before the popover offers anything — a bare `:` (or a
 * single following character) is far more often ordinary prose punctuation
 * than the start of a shortcode.
 */
export const RICH_EMOJI_MIN_QUERY_LENGTH = 2;

/** Cap on rendered suggestions — the list is keyboard-navigated, not scrolled through hundreds of rows. */
export const RICH_EMOJI_MAX_RESULTS = 30;

/** Whether this editor can insert the item: a Unicode emoji, or a known custom name. */
export function isInsertableRichEmoji(item: EmojiItem): boolean {
  if (typeof item.emoji === 'string' && item.emoji.length > 0) return true;
  return isRichCustomEmojiName(item.name);
}

/** True when the item inserts as a `customEmoji` node rather than unicode text. */
export function isRichCustomEmojiItem(item: EmojiItem): boolean {
  return !(typeof item.emoji === 'string' && item.emoji.length > 0);
}

/**
 * Shortcode/name/tag filter with startsWith-first ranking. `query` arrives
 * without the leading `:` (the suggestion plugin strips its trigger char).
 */
export function filterRichEmojiItems(items: readonly EmojiItem[], query: string): EmojiItem[] {
  const q = query.toLowerCase();
  if (q.length < RICH_EMOJI_MIN_QUERY_LENGTH) return [];

  const startsWith: EmojiItem[] = [];
  const contains: EmojiItem[] = [];
  for (const item of items) {
    if (!isInsertableRichEmoji(item)) continue;
    const names = [item.name, ...item.shortcodes];
    if (names.some((name) => name.toLowerCase().startsWith(q))) {
      startsWith.push(item);
    } else if (
      names.some((name) => name.toLowerCase().includes(q)) ||
      item.tags.some((tag) => tag.toLowerCase().includes(q))
    ) {
      contains.push(item);
    }
    if (startsWith.length >= RICH_EMOJI_MAX_RESULTS) break;
  }
  return [...startsWith, ...contains].slice(0, RICH_EMOJI_MAX_RESULTS);
}
