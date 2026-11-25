'use client';

import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  IconAlertCircle,
  IconAlertOctagon,
  IconAlertTriangle,
  IconArrowBackUp,
  IconArrowForwardUp,
  IconBold,
  IconBulb,
  IconChevronRight,
  IconCode,
  IconCheckbox,
  IconEyeOff,
  IconInfoCircle,
  IconItalic,
  IconLink,
  IconList,
  IconListNumbers,
  IconPhoto,
  IconQuote,
  IconSearch,
  IconSeparator,
  IconStrikethrough,
  IconSubscript,
  IconSuperscript,
  IconTable,
  IconTerminal2
} from '@tabler/icons-react';

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Toggle
} from '../ui/index.tsx';

import { RICH_CALLOUT_KINDS, type RichCalloutKind } from '@formless63/editor-core';
import { runRichSlashCommand } from './editor-slash-menu.tsx';

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;

const CALLOUT_LABELS: Record<RichCalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution'
};

const CALLOUT_ICONS: Record<RichCalloutKind, typeof IconInfoCircle> = {
  note: IconInfoCircle,
  tip: IconBulb,
  important: IconAlertCircle,
  warning: IconAlertTriangle,
  caution: IconAlertOctagon
};

/**
 * One logical button group. `ml-2` + `pl-[9px]` reserve the 8px + 1px + 8px
 * separator unit on the group's LEADING edge, and the `before:` pseudo draws
 * the centered 1px line inside it (same h-5 look as the old shadcn
 * `Separator`s). The row container's `-ml-[17px]` (inside the toolbar's
 * `overflow-hidden` + `px-2` shell) pulls the first group of EVERY wrapped
 * row's leading separator out past the clip edge — the classic
 * crop-the-leading-divider flex-wrap trick — so separators only ever render
 * BETWEEN groups on the same row, never dangling at a row edge.
 */
const TOOLBAR_GROUP_CLASS =
  'ce:relative ce:ml-2 ce:flex ce:items-center ce:gap-0.5 ce:pl-[9px] ce:before:absolute ce:before:top-1/2 ce:before:left-0 ce:before:h-5 ce:before:w-px ce:before:-translate-y-1/2 ce:before:bg-border';

/**
 * The persistent toolbar for `richtext-toolbar` mode. Buttons run the same commands as the slash
 * and selection menus. Groups wrap on narrow screens and draw their own separators.
 */
export function EditorToolbar({
  editor,
  onRequestLink
}: {
  editor: Editor | null;
  onRequestLink: () => void;
}) {
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null;
      return {
        headingLevel: HEADING_LEVELS.find((level) => current.isActive('heading', { level })) ?? 0,
        bold: current.isActive('bold'),
        italic: current.isActive('italic'),
        strike: current.isActive('strike'),
        code: current.isActive('code'),
        superscript: current.isActive('superscript'),
        subscript: current.isActive('subscript'),
        bulletList: current.isActive('bulletList'),
        orderedList: current.isActive('orderedList'),
        taskList: current.isActive('taskList'),
        blockquote: current.isActive('blockquote'),
        details: current.isActive('details'),
        codeBlock: current.isActive('codeBlock'),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
        invisibleCharactersVisible: Boolean(current.storage.invisibleCharacters?.visibility?.())
      };
    }
  });

  if (!editor || !state) return null;

  const runAtCursor = (id: string) => {
    const pos = editor.state.selection.from;
    runRichSlashCommand(id, editor, { from: pos, to: pos });
  };

  return (
    <div
      aria-label='Formatting toolbar'
      className='ce:overflow-hidden ce:border-b ce:bg-muted/20 ce:px-2 ce:py-1'
      data-editor-toolbar=''
      role='toolbar'
    >
      <div className='ce:-ml-[17px] ce:flex ce:flex-wrap ce:items-center ce:gap-y-0.5'>
        <div className={TOOLBAR_GROUP_CLASS} data-editor-toolbar-group=''>
          <Button
            aria-label='Undo'
            disabled={!state.canUndo}
            onClick={() => editor.chain().focus().undo().run()}
            size='icon'
            title='Undo (⌘Z)'
            type='button'
            variant='ghost'
          >
            <IconArrowBackUp className='ce:size-4' />
          </Button>
          <Button
            aria-label='Redo'
            disabled={!state.canRedo}
            onClick={() => editor.chain().focus().redo().run()}
            size='icon'
            title='Redo (⌘⇧Z)'
            type='button'
            variant='ghost'
          >
            <IconArrowForwardUp className='ce:size-4' />
          </Button>
        </div>

        <div className={TOOLBAR_GROUP_CLASS} data-editor-toolbar-group=''>
          <select
            aria-label='Text style'
            className='rich-ui-select'
            onChange={(event) => {
              const value = event.target.value;
              if (value === '0') {
                editor.chain().focus().setParagraph().run();
                return;
              }
              runAtCursor(`heading-${value}`);
            }}
            value={String(state.headingLevel)}
          >
            <option value='0'>Paragraph</option>
            {HEADING_LEVELS.map((level) => (
              <option key={level} value={level}>{`Heading ${level}`}</option>
            ))}
          </select>
        </div>

        <div className={TOOLBAR_GROUP_CLASS} data-editor-toolbar-group=''>
          <Toggle
            aria-label='Bold'
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
            pressed={state.bold}
            size='sm'
            title='Bold (⌘B)'
          >
            <IconBold className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Italic'
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            pressed={state.italic}
            size='sm'
            title='Italic (⌘I)'
          >
            <IconItalic className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Strikethrough'
            onPressedChange={() => editor.chain().focus().toggleStrike().run()}
            pressed={state.strike}
            size='sm'
            title='Strikethrough'
          >
            <IconStrikethrough className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Code'
            onPressedChange={() => editor.chain().focus().toggleCode().run()}
            pressed={state.code}
            size='sm'
            title='Code'
          >
            <IconCode className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Superscript'
            onPressedChange={() => editor.chain().focus().toggleSuperscript().run()}
            pressed={state.superscript}
            size='sm'
            title='Superscript (⌘.)'
          >
            <IconSuperscript className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Subscript'
            onPressedChange={() => editor.chain().focus().toggleSubscript().run()}
            pressed={state.subscript}
            size='sm'
            title='Subscript (⌘,)'
          >
            <IconSubscript className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Link'
            onPressedChange={() => onRequestLink()}
            pressed={false}
            size='sm'
            title='Link'
          >
            <IconLink className='ce:size-4' />
          </Toggle>
        </div>

        <div className={TOOLBAR_GROUP_CLASS} data-editor-toolbar-group=''>
          <Toggle
            aria-label='Bullet list'
            onPressedChange={() => runAtCursor('bullet-list')}
            pressed={state.bulletList}
            size='sm'
            title='Bullet list'
          >
            <IconList className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Numbered list'
            onPressedChange={() => runAtCursor('numbered-list')}
            pressed={state.orderedList}
            size='sm'
            title='Numbered list'
          >
            <IconListNumbers className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Task list'
            onPressedChange={() => runAtCursor('task-list')}
            pressed={state.taskList}
            size='sm'
            title='Task list'
          >
            <IconCheckbox className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Blockquote'
            onPressedChange={() => runAtCursor('quote')}
            pressed={state.blockquote}
            size='sm'
            title='Blockquote'
          >
            <IconQuote className='ce:size-4' />
          </Toggle>
        </div>

        <div className={TOOLBAR_GROUP_CLASS} data-editor-toolbar-group=''>
          <Button
            aria-label='Divider'
            onClick={() => runAtCursor('divider')}
            size='icon'
            title='Divider'
            type='button'
            variant='ghost'
          >
            <IconSeparator className='ce:size-4' />
          </Button>
          <Button
            aria-label='Table'
            onClick={() => runAtCursor('table')}
            size='icon'
            title='Table'
            type='button'
            variant='ghost'
          >
            <IconTable className='ce:size-4' />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label='Callout'
                size='icon'
                title='Callout'
                type='button'
                variant='ghost'
              >
                <IconInfoCircle className='ce:size-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start'>
              {RICH_CALLOUT_KINDS.map((kind) => {
                const KindIcon = CALLOUT_ICONS[kind];
                return (
                  <DropdownMenuItem key={kind} onSelect={() => runAtCursor(`callout-${kind}`)}>
                    <KindIcon className='ce:size-4' />
                    {CALLOUT_LABELS[kind]} callout
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>

          <Toggle
            aria-label='Toggle block'
            onPressedChange={() => runAtCursor('details')}
            pressed={state.details}
            size='sm'
            title='Toggle block'
          >
            <IconChevronRight className='ce:size-4' />
          </Toggle>
          <Toggle
            aria-label='Code block'
            onPressedChange={() => runAtCursor('code-block')}
            pressed={state.codeBlock}
            size='sm'
            title='Code block'
          >
            <IconTerminal2 className='ce:size-4' />
          </Toggle>
          <Button
            aria-label='Insert image'
            onClick={() => runAtCursor('image')}
            size='icon'
            title='Insert image'
            type='button'
            variant='ghost'
          >
            <IconPhoto className='ce:size-4' />
          </Button>
        </div>

        <div className={TOOLBAR_GROUP_CLASS} data-editor-toolbar-group=''>
          <Button
            aria-label='Find and replace'
            onClick={() => runAtCursor('find-replace')}
            size='icon'
            title='Find and replace (⌘F)'
            type='button'
            variant='ghost'
          >
            <IconSearch className='ce:size-4' />
          </Button>
          <Toggle
            aria-label='Toggle invisible characters'
            onPressedChange={() => runAtCursor('invisible-characters')}
            pressed={state.invisibleCharactersVisible}
            size='sm'
            title='Toggle invisible characters'
          >
            <IconEyeOff className='ce:size-4' />
          </Toggle>
        </div>
      </div>
    </div>
  );
}
