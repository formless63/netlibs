'use client';

import { Extension, type Editor, type Range } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import SuggestionPlugin, { type SuggestionOptions, type SuggestionProps } from '@tiptap/suggestion';
import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconBulb,
  IconChevronRight,
  IconCode,
  IconCheckbox,
  IconEyeOff,
  IconHeading,
  IconInfoCircle,
  IconLink,
  IconList,
  IconListNumbers,
  IconListTree,
  IconMath,
  IconPhoto,
  IconQuote,
  IconSearch,
  IconSeparator,
  IconTable,
  type Icon
} from '@tabler/icons-react';
import { forwardRef, useImperativeHandle, useState } from 'react';

import { cn } from '../ui/cn.ts';

import { RICH_FIND_REPLACE_TOGGLE_EVENT } from '../find-replace.ts';
import { RICH_RESOURCE_PICKER_EVENT } from '../resource-picker.ts';
import type { RichCalloutKind } from '@formless63/editor-core';
import { RICH_IMAGE_PICKER_EVENT } from '../upload-drop.ts';
import { EDITOR_MENU_ATTR } from './editor-touch-intent.ts';
import {
  filterRichSlashCommands,
  groupRichSlashCommands,
  RICH_SLASH_COMMAND_GROUPS,
  RICH_SLASH_COMMANDS,
  type RichSlashCommandDefinition
} from './editor-slash-menu-state.ts';

// The slash menu: filtering, groups, arrow keys and Enter. The popup is positioned manually.

const COMMAND_ICONS: Record<string, Icon> = {
  'heading-1': IconHeading,
  'heading-2': IconHeading,
  'heading-3': IconHeading,
  'heading-4': IconHeading,
  'heading-5': IconHeading,
  'heading-6': IconHeading,
  quote: IconQuote,
  divider: IconSeparator,
  'code-block': IconCode,
  mermaid: IconCode,
  table: IconTable,
  'bullet-list': IconList,
  'numbered-list': IconListNumbers,
  'task-list': IconCheckbox,
  'callout-note': IconInfoCircle,
  'callout-tip': IconBulb,
  'callout-important': IconAlertCircle,
  'callout-warning': IconAlertTriangle,
  'callout-caution': IconAlertOctagon,
  image: IconPhoto,
  resource: IconLink,
  details: IconChevronRight,
  'math-block': IconMath,
  'math-inline': IconMath,
  'children-index': IconListTree,
  'find-replace': IconSearch,
  'invisible-characters': IconEyeOff
};

/** Runs one slash command. Exported so tests use the same path as a live insertion. */
export function runRichSlashCommand(id: string, editor: Editor, range: Range): void {
  if (id === 'image') {
    // `/image` opens the picker, whose first row uploads a file. It runs before the shared chain
    // and without `.focus()`, because Tiptap refocuses the editor a frame later and would take
    // focus from the picker's search field.
    editor.chain().deleteRange(range).run();
    editor.view.dom.dispatchEvent(new CustomEvent(RICH_IMAGE_PICKER_EVENT));
    return;
  }

  const chain = editor.chain().focus().deleteRange(range);
  switch (id) {
    case 'heading-1':
      chain.toggleHeading({ level: 1 }).run();
      return;
    case 'heading-2':
      chain.toggleHeading({ level: 2 }).run();
      return;
    case 'heading-3':
      chain.toggleHeading({ level: 3 }).run();
      return;
    case 'heading-4':
      chain.toggleHeading({ level: 4 }).run();
      return;
    case 'heading-5':
      chain.toggleHeading({ level: 5 }).run();
      return;
    case 'heading-6':
      chain.toggleHeading({ level: 6 }).run();
      return;
    case 'quote':
      chain.toggleBlockquote().run();
      return;
    case 'divider':
      chain.setHorizontalRule().run();
      return;
    case 'code-block':
      chain.toggleCodeBlock().run();
      return;
    case 'mermaid':
      chain.setCodeBlock({ language: 'mermaid' }).run();
      return;
    case 'table':
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
      return;
    case 'bullet-list':
      chain.toggleBulletList().run();
      return;
    case 'numbered-list':
      chain.toggleOrderedList().run();
      return;
    case 'task-list':
      chain.toggleTaskList().run();
      return;
    case 'details':
      chain.setDetails().run();
      return;
    case 'math-block':
      chain.insertBlockMath({ latex: 'x^2' }).run();
      return;
    case 'math-inline':
      chain.insertInlineMath({ latex: 'x' }).run();
      return;
    case 'children-index':
      chain.insertContent({ type: 'childrenIndex' }).run();
      return;
    // `image` is handled above, before the focusing chain is built.
    case 'resource':
      // The resourceCard enters via the resource
      // picker dialog, same "clear the query text, ask the editor component
      // to open a picker" shape as `image` above.
      chain.run();
      editor.view.dom.dispatchEvent(new CustomEvent(RICH_RESOURCE_PICKER_EVENT));
      return;
    case 'find-replace':
      chain.run();
      editor.view.dom.dispatchEvent(new CustomEvent(RICH_FIND_REPLACE_TOGGLE_EVENT));
      return;
    case 'invisible-characters':
      // Decoration-only view toggle (`InvisibleCharacters`, `editor/schema.ts`)
      // — no node/mark inserted, so this never touches canonical content.
      chain.toggleInvisibleCharacters().run();
      return;
    default: {
      if (id.startsWith('callout-')) {
        const kind = id.slice('callout-'.length) as RichCalloutKind;
        chain.setRichCallout(kind).run();
        return;
      }
      // Unknown command id — leave the deleteRange applied (the "/query" text
      // is gone) but insert nothing. Should be unreachable: every rendered
      // menu item comes from RICH_SLASH_COMMANDS.
      chain.run();
    }
  }
}

const RichSlashMenuList = forwardRef<
  { onKeyDown: (event: { event: KeyboardEvent }) => boolean },
  {
    items: RichSlashCommandDefinition[];
    command: (item: RichSlashCommandDefinition) => void;
    query: string;
  }
>(function RichSlashMenuList({ items, command, query }, ref) {
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

  if (items.length === 0) {
    return (
      <div className='ce:rounded-md ce:border ce:bg-popover ce:p-2 ce:text-xs ce:text-muted-foreground ce:shadow-md'>
        No matches.
      </div>
    );
  }

  const grouped = groupRichSlashCommands(items);
  const itemIndexes = new Map(items.map((item, index) => [item.id, index]));

  return (
    <div className='ce:max-h-72 ce:w-72 ce:overflow-auto ce:rounded-md ce:border ce:bg-popover ce:p-1 ce:shadow-md'>
      {RICH_SLASH_COMMAND_GROUPS.map((group) =>
        grouped[group].length ? (
          <div key={group}>
            <div className='ce:px-2 ce:pt-2 ce:text-[10px] ce:uppercase ce:tracking-wide ce:text-muted-foreground'>
              {group}
            </div>
            {grouped[group].map((item) => {
              const index = itemIndexes.get(item.id) ?? 0;
              const Icon = COMMAND_ICONS[item.id] ?? IconInfoCircle;
              return (
                <button
                  className={cn(
                    'ce:flex ce:w-full ce:items-start ce:gap-2 ce:rounded ce:px-2 ce:py-1.5 ce:text-left ce:text-sm ce:hover:bg-accent',
                    selectedIndex === index && 'ce:bg-accent'
                  )}
                  key={item.id}
                  onClick={() => select(index)}
                  onMouseEnter={() => setSelection({ query, index })}
                  type='button'
                >
                  <Icon className='ce:mt-0.5 ce:size-4 ce:shrink-0 ce:text-muted-foreground' />
                  <span className='ce:flex-1'>
                    <span className='ce:block ce:font-medium'>{item.title}</span>
                    <span className='ce:block ce:text-xs ce:text-muted-foreground'>{item.description}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ) : null
      )}
    </div>
  );
});

function makeRichSlashSuggestion(): Partial<SuggestionOptions<RichSlashCommandDefinition>> {
  return {
    items: ({ query }) => filterRichSlashCommands(RICH_SLASH_COMMANDS, query),
    render: () => {
      let component: ReactRenderer<{
        onKeyDown: (event: { event: KeyboardEvent }) => boolean;
      }> | null = null;
      let popupElement: HTMLDivElement | null = null;

      // Positioned manually from Suggestion's `getReferenceClientRect`.
      const position = (props: SuggestionProps<RichSlashCommandDefinition>) => {
        if (!popupElement || !props.clientRect) return;
        const rect = props.clientRect();
        if (!rect) return;
        popupElement.style.top = `${rect.bottom + window.scrollY + 4}px`;
        popupElement.style.left = `${rect.left + window.scrollX}px`;
      };

      return {
        onStart: (props) => {
          component = new ReactRenderer(RichSlashMenuList, {
            props,
            editor: props.editor
          });
          popupElement = document.createElement('div');
          popupElement.style.position = 'absolute';
          popupElement.style.zIndex = '50';
          // Marks this popup as an editor menu. Otherwise a click in it counts as outside the
          // editor, the selection toolbar unmounts, and that rebuilds the plugin set and destroys
          // this popup before the click lands.
          popupElement.setAttribute(EDITOR_MENU_ATTR, '');
          // Also keep editor focus on mousedown so the command's range stays
          // valid (standard ProseMirror-menu hygiene).
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

export const RichSlashCommandExtension = Extension.create<{
  suggestion: Partial<SuggestionOptions<RichSlashCommandDefinition>>;
}>({
  name: 'richSlashCommand',
  addOptions() {
    return {
      suggestion: {
        char: '/',
        startOfLine: false,
        command: ({ editor, range, props }) => {
          runRichSlashCommand(props.id, editor, range);
        }
      }
    };
  },
  addProseMirrorPlugins() {
    return [
      SuggestionPlugin({
        editor: this.editor,
        ...this.options.suggestion
      })
    ];
  }
});

export function createRichSlashMenuExtension() {
  return RichSlashCommandExtension.configure({
    suggestion: makeRichSlashSuggestion()
  });
}
