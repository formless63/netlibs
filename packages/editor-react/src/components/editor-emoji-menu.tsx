'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';
import SuggestionPlugin, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import { forwardRef, useImperativeHandle, useState } from 'react';

import { cn } from '../ui/cn.ts';

import { isRichCustomEmojiName } from '@formless63/editor-core';
import { EDITOR_MENU_ATTR } from './editor-touch-intent.ts';

import {
  filterRichEmojiItems,
  isRichCustomEmojiItem,
  type EmojiItem
} from './editor-emoji-state.ts';

/**
 * The `:shortcode:` emoji popover, built like the slash menu. Unicode emojis insert as text; custom
 * ones insert a `customEmoji` atom. The dataset loads on first use, and a failed load is retried on
 * the next keystroke.
 */

let emojiDataPromise: Promise<readonly EmojiItem[]> | null = null;

async function loadRichEmojiData(): Promise<readonly EmojiItem[]> {
  emojiDataPromise ??= import('@tiptap/extension-emoji').then((module) => module.gitHubEmojis);
  try {
    return await emojiDataPromise;
  } catch (error) {
    // Transient dynamic-import failure (network blip on a lazy chunk):
    // degrade to "no suggestions" for THIS query and retry on the next one.
    emojiDataPromise = null;
    console.error('[rich-editor] emoji dataset failed to load', error);
    return [];
  }
}

/** Replaces the `:query` range with the emoji: text, or a `customEmoji` atom. */
export function runRichEmojiInsert(editor: Editor, range: Range, item: EmojiItem): void {
  if (typeof item.emoji === 'string' && item.emoji.length > 0) {
    editor.chain().focus().deleteRange(range).insertContent(item.emoji).run();
    return;
  }
  if (!isRichCustomEmojiName(item.name)) return;
  editor
    .chain()
    .focus()
    .deleteRange(range)
    .insertContent({ type: 'customEmoji', attrs: { name: item.name } })
    .run();
}

const RichEmojiMenuList = forwardRef<
  { onKeyDown: (event: { event: KeyboardEvent }) => boolean },
  {
    items: EmojiItem[];
    command: (item: EmojiItem) => void;
    query: string;
  }
>(function RichEmojiMenuList({ items, command, query }, ref) {
  const [selection, setSelection] = useState({ query, index: 0 });
  const selectedIndex = selection.query === query ? Math.min(selection.index, items.length - 1) : 0;

  const select = (index: number) => {
    const item = items[index];
    if (item) command(item);
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (items.length === 0) return false;
      if (event.key === 'ArrowUp') {
        setSelection({ query, index: (selectedIndex + items.length - 1) % items.length });
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelection({ query, index: (selectedIndex + 1) % items.length });
        return true;
      }
      if (event.key === 'Enter') {
        select(selectedIndex);
        return true;
      }
      return false;
    }
  }));

  // Below the minimum query length (or with no match) render nothing at all —
  // a bare `:` in prose shouldn't summon an empty box.
  if (items.length === 0) return null;

  return (
    <div className='ce:max-h-64 ce:w-64 ce:overflow-auto ce:rounded-md ce:border ce:bg-popover ce:p-1 ce:shadow-md'>
      {items.map((item, index) => (
        <button
          className={cn(
            'ce:flex ce:w-full ce:items-center ce:gap-2 ce:rounded ce:px-2 ce:py-1 ce:text-left ce:text-sm ce:hover:bg-accent',
            selectedIndex === index && 'ce:bg-accent'
          )}
          key={item.name}
          onClick={() => select(index)}
          onMouseEnter={() => setSelection({ query, index })}
          type='button'
        >
          <span aria-hidden='true' className='ce:flex ce:w-5 ce:items-center ce:justify-center'>
            {isRichCustomEmojiItem(item) && isRichCustomEmojiName(item.name) ? (
              <span className='ce:text-[10px] ce:font-medium'>:{item.name}:</span>
            ) : (
              item.emoji
            )}
          </span>
          <span className='ce:flex-1 ce:truncate ce:text-xs ce:text-muted-foreground'>
            :{item.shortcodes[0] ?? item.name}:
          </span>
        </button>
      ))}
    </div>
  );
});

function makeRichEmojiSuggestion(): Partial<SuggestionOptions<EmojiItem>> {
  return {
    items: async ({ query }) => filterRichEmojiItems(await loadRichEmojiData(), query),
    render: () => {
      let component: ReactRenderer<{
        onKeyDown: (event: { event: KeyboardEvent }) => boolean;
      }> | null = null;
      let popupElement: HTMLDivElement | null = null;

      const position = (props: SuggestionProps<EmojiItem>) => {
        if (!popupElement || !props.clientRect) return;
        const rect = props.clientRect();
        if (!rect) return;
        popupElement.style.top = `${rect.bottom + window.scrollY + 4}px`;
        popupElement.style.left = `${rect.left + window.scrollX}px`;
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(RichEmojiMenuList, {
            props,
            editor: props.editor
          });
          popupElement = document.createElement('div');
          popupElement.style.position = 'absolute';
          popupElement.style.zIndex = '50';
          // Mark as an editor menu so a click here isn't treated as an
          // "outside" dismissal (which would unmount the bubble menu →
          // unregisterPlugin → destroy this popup mid-click). Plus keep editor
          // focus on mousedown. Full note in editor-slash-menu.tsx.
          popupElement.setAttribute(EDITOR_MENU_ATTR, '');
          popupElement.addEventListener('mousedown', (event) => event.preventDefault());
          popupElement.appendChild(component.element);
          document.body.appendChild(popupElement);
          position(props);
        },
        onUpdate: (props) => {
          component?.updateProps(props);
          position(props);
        },
        onKeyDown: (props) => {
          if (props.event.key === 'Escape') {
            popupElement?.remove();
            return true;
          }
          return component?.ref?.onKeyDown(props) ?? false;
        },
        onExit: () => {
          popupElement?.remove();
          popupElement = null;
          component?.destroy();
          component = null;
        }
      };
    }
  };
}

export const RichEmojiSuggestionExtension = Extension.create<{
  suggestion: Partial<SuggestionOptions<EmojiItem>>;
}>({
  name: 'richEmojiSuggestion',
  addOptions() {
    return {
      suggestion: {
        char: ':',
        startOfLine: false,
        command: ({ editor, range, props }) => {
          runRichEmojiInsert(editor, range, props);
        }
      }
    };
  },
  addProseMirrorPlugins() {
    return [
      SuggestionPlugin({
        editor: this.editor,
        // A distinct key: the slash menu uses the default, and two plugins cannot share one.
        pluginKey: new PluginKey('richEmojiSuggestion'),
        ...this.options.suggestion
      })
    ];
  }
});

export function createRichEmojiSuggestionExtension() {
  return RichEmojiSuggestionExtension.configure({
    suggestion: makeRichEmojiSuggestion()
  });
}
