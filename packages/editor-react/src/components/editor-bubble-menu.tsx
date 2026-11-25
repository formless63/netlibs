'use client';

import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import {
  IconBold,
  IconCode,
  IconItalic,
  IconLink,
  IconMessage,
  IconStrikethrough,
  IconSubscript,
  IconSuperscript
} from '@tabler/icons-react';

import {
  Separator,
  Toggle
} from '../ui/index.tsx';
import { cn } from '../ui/cn.ts';

import { EditorFloatingMenu, type EditorFloatingMenuProps } from './editor-floating-menu.tsx';
import {
  EDITOR_MENU_ATTR,
  richMarksMenuShouldShow,
  useEditorMenuGate
} from './editor-touch-intent.ts';

// Module constants, not inline props: Tiptap's BubbleMenu dispatches a
// transaction whenever these change identity, and this editor re-renders on
// transactions, so fresh values every render would loop forever.
const MENU_OPTIONS = { placement: 'top' } as const;

// One floating menu per selection kind: tables, links and images have their
// own controls. The policy lives in editor-touch-intent.ts.
const shouldShow: NonNullable<EditorFloatingMenuProps['shouldShow']> = ({ editor: currentEditor, state }) =>
  richMarksMenuShouldShow({
    selectionEmpty: state.selection.empty,
    nodeSelection: state.selection instanceof NodeSelection,
    isTable: currentEditor.isActive('table'),
    isLink: currentEditor.isActive('link'),
    isImage: currentEditor.isActive('image')
  });

/**
 * The selection toolbar. Offers the marks the schema accepts. The comment button hands the
 * selection to the host, which applies the mark once a thread exists. It hides on links, where the
 * link popover takes over, and unmounts while the menu gate is closed (see
 * `editor-touch-intent.ts`).
 */
export function EditorBubbleMenu({
  editor,
  onRequestLink,
  onRequestComment
}: {
  editor: Editor | null;
  onRequestLink: () => void;
  onRequestComment?: () => void;
}) {
  const { allowed } = useEditorMenuGate(editor);

  if (!editor || !allowed) return null;

  return (
    <EditorFloatingMenu
      {...{ [EDITOR_MENU_ATTR]: '' }}
      className='ce:flex ce:items-center ce:gap-0.5 ce:rounded-md ce:border ce:bg-popover ce:p-1 ce:text-sm ce:shadow-md'
      editor={editor}
      options={MENU_OPTIONS}
      shouldShow={shouldShow}
    >
      <Toggle
        aria-label='Bold'
        onPressedChange={() => editor.chain().focus().toggleBold().run()}
        pressed={editor.isActive('bold')}
        size='sm'
        title='Bold (⌘B)'
      >
        <IconBold className='ce:size-4' />
      </Toggle>
      <Toggle
        aria-label='Italic'
        onPressedChange={() => editor.chain().focus().toggleItalic().run()}
        pressed={editor.isActive('italic')}
        size='sm'
        title='Italic (⌘I)'
      >
        <IconItalic className='ce:size-4' />
      </Toggle>
      <Toggle
        aria-label='Strikethrough'
        onPressedChange={() => editor.chain().focus().toggleStrike().run()}
        pressed={editor.isActive('strike')}
        size='sm'
        title='Strikethrough'
      >
        <IconStrikethrough className='ce:size-4' />
      </Toggle>
      <Toggle
        aria-label='Code'
        onPressedChange={() => editor.chain().focus().toggleCode().run()}
        pressed={editor.isActive('code')}
        size='sm'
        title='Code'
      >
        <IconCode className='ce:size-4' />
      </Toggle>
      <Toggle
        aria-label='Superscript'
        onPressedChange={() => editor.chain().focus().toggleSuperscript().run()}
        pressed={editor.isActive('superscript')}
        size='sm'
        title='Superscript (⌘.)'
      >
        <IconSuperscript className='ce:size-4' />
      </Toggle>
      <Toggle
        aria-label='Subscript'
        onPressedChange={() => editor.chain().focus().toggleSubscript().run()}
        pressed={editor.isActive('subscript')}
        size='sm'
        title='Subscript (⌘,)'
      >
        <IconSubscript className='ce:size-4' />
      </Toggle>
      <Separator className={cn('ce:mx-1 ce:h-5 ce:w-px')} orientation='vertical' />
      <Toggle
        aria-label='Link'
        onPressedChange={() => onRequestLink()}
        pressed={false}
        size='sm'
        title='Link'
      >
        <IconLink className='ce:size-4' />
      </Toggle>
      {onRequestComment ? (
        <Toggle
          aria-label='Comment'
          onPressedChange={() => onRequestComment()}
          pressed={false}
          size='sm'
          title='Comment'
        >
          <IconMessage className='ce:size-4' />
        </Toggle>
      ) : null}
    </EditorFloatingMenu>
  );
}
