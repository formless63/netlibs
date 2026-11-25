'use client';

import type { Editor } from '@tiptap/react';
import { IconAlignCenter, IconAlignLeft, IconAlignRight, IconCheck, IconForms, IconX } from '@tabler/icons-react';
import { useEffect, useId, useState } from 'react';

import {
  Button,
  Input,
  Separator,
  Toggle
} from '../ui/index.tsx';

import { RICH_IMAGE_SIZE_PRESETS, type RichImageAlignment } from '@formless63/editor-core';
import { EditorFloatingMenu, type EditorFloatingMenuProps } from './editor-floating-menu.tsx';
import { EDITOR_MENU_ATTR, useEditorMenuGate } from './editor-touch-intent.ts';

// Stable identities; see the note in editor-bubble-menu.tsx.
const MENU_OPTIONS = { placement: 'top' } as const;
const shouldShow: NonNullable<EditorFloatingMenuProps['shouldShow']> = ({ editor }) =>
  editor.isActive('image');

interface RichImageMenuAttrs {
  width: number | null;
  align: RichImageAlignment | null;
  alt: string;
  description: string;
}

function readImageAttrs(editor: Editor): RichImageMenuAttrs {
  const attrs = editor.getAttributes('image');
  return {
    width: typeof attrs.width === 'number' ? attrs.width : null,
    align:
      attrs.align === 'left' || attrs.align === 'center' || attrs.align === 'right'
        ? attrs.align
        : null,
    alt: typeof attrs.alt === 'string' ? attrs.alt : '',
    description: typeof attrs.description === 'string' ? attrs.description : ''
  };
}

/**
 * The image menu, shown for an image selection: preset sizes (the same `width` as drag-resize),
 * alignment ("Left" writes null), alt text (required) and caption. It unmounts while the menu gate
 * is closed.
 */
export function EditorImageMenu({ editor }: { editor: Editor }) {
  const { allowed } = useEditorMenuGate(editor);
  const altInputId = useId();
  const captionInputId = useId();
  const [attrs, setAttrs] = useState<RichImageMenuAttrs | null>(null);
  const [textPanelOpen, setTextPanelOpen] = useState(false);
  const [altDraft, setAltDraft] = useState('');
  const [captionDraft, setCaptionDraft] = useState('');
  const [altError, setAltError] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => {
      const active = editor.isActive('image');
      setAttrs(active ? readImageAttrs(editor) : null);
      if (!active) {
        setTextPanelOpen(false);
        setAltError(null);
      }
    };
    sync();
    editor.on('selectionUpdate', sync);
    editor.on('transaction', sync);
    return () => {
      editor.off('selectionUpdate', sync);
      editor.off('transaction', sync);
    };
  }, [editor]);

  if (!attrs || !allowed) return null;

  const setWidth = (width: number | null) => {
    editor.chain().focus().updateAttributes('image', { width }).run();
  };

  const setAlign = (align: RichImageAlignment) => {
    // Canonical minimalism: left IS the default placement, so "Left" clears
    // the attr instead of persisting an equivalent-but-flagged 'left'.
    editor
      .chain()
      .focus()
      .updateAttributes('image', { align: align === 'left' ? null : align })
      .run();
  };

  const openTextPanel = () => {
    setAltDraft(attrs.alt);
    setCaptionDraft(attrs.description);
    setAltError(null);
    setTextPanelOpen(true);
  };

  const commitText = () => {
    const alt = altDraft.trim();
    if (!alt) {
      setAltError('Alt text is required.');
      return;
    }
    const description = captionDraft.trim();
    editor
      .chain()
      .focus()
      .updateAttributes('image', { alt, description: description || null })
      .run();
    setTextPanelOpen(false);
    setAltError(null);
  };

  const cancelText = () => {
    setTextPanelOpen(false);
    setAltError(null);
  };

  const onTextKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commitText();
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelText();
    }
  };

  const effectiveAlign: RichImageAlignment = attrs.align ?? 'left';

  return (
    <EditorFloatingMenu
      {...{ [EDITOR_MENU_ATTR]: '' }}
      className='ce:rounded-md ce:border ce:bg-popover ce:p-1 ce:text-sm ce:shadow-md'
      editor={editor}
      options={MENU_OPTIONS}
      pluginKey='richImageMenu'
      shouldShow={shouldShow}
    >
      <div className='ce:flex ce:items-center ce:gap-0.5'>
        {RICH_IMAGE_SIZE_PRESETS.map((preset) => (
          <Toggle
            aria-label={
              preset.width === null ? 'Original size' : `${preset.label} (${preset.width}px)`
            }
            key={preset.id}
            onPressedChange={() => setWidth(preset.width)}
            pressed={attrs.width === preset.width}
            size='sm'
            title={preset.width === null ? 'Original size' : `${preset.width}px wide`}
          >
            <span className='ce:px-0.5 ce:text-xs ce:font-medium'>{preset.label}</span>
          </Toggle>
        ))}
        {attrs.width !== null &&
        !RICH_IMAGE_SIZE_PRESETS.some((preset) => preset.width === attrs.width) ? (
          <span className='ce:px-1 ce:font-mono ce:text-[10px] ce:text-muted-foreground'>{attrs.width}px</span>
        ) : null}

        <Separator className='ce:mx-1 ce:h-5 ce:w-px' orientation='vertical' />

        <Toggle
          aria-label='Align left'
          onPressedChange={() => setAlign('left')}
          pressed={effectiveAlign === 'left'}
          size='sm'
          title='Align left'
        >
          <IconAlignLeft className='ce:size-4' />
        </Toggle>
        <Toggle
          aria-label='Align center'
          onPressedChange={() => setAlign('center')}
          pressed={effectiveAlign === 'center'}
          size='sm'
          title='Align center'
        >
          <IconAlignCenter className='ce:size-4' />
        </Toggle>
        <Toggle
          aria-label='Align right'
          onPressedChange={() => setAlign('right')}
          pressed={effectiveAlign === 'right'}
          size='sm'
          title='Align right'
        >
          <IconAlignRight className='ce:size-4' />
        </Toggle>

        <Separator className='ce:mx-1 ce:h-5 ce:w-px' orientation='vertical' />

        <Toggle
          aria-label='Edit alt text and caption'
          onPressedChange={() => (textPanelOpen ? cancelText() : openTextPanel())}
          pressed={textPanelOpen}
          size='sm'
          title='Alt text & caption'
        >
          <IconForms className='ce:size-4' />
        </Toggle>
      </div>

      {textPanelOpen ? (
        <div className='ce:mt-1 ce:flex ce:w-72 ce:flex-col ce:gap-1.5 ce:border-t ce:pt-1.5'>
          <label
            className='ce:flex ce:flex-col ce:gap-0.5 ce:text-[11px] ce:text-muted-foreground'
            htmlFor={altInputId}
          >
            Alt text
            <Input
              autoFocus
              className='ce:h-7 ce:text-xs'
              id={altInputId}
              onChange={(event) => {
                setAltDraft(event.target.value);
                setAltError(null);
              }}
              onKeyDown={onTextKeyDown}
              placeholder='Describe the image…'
              value={altDraft}
            />
          </label>
          <label
            className='ce:flex ce:flex-col ce:gap-0.5 ce:text-[11px] ce:text-muted-foreground'
            htmlFor={captionInputId}
          >
            Caption
            <Input
              className='ce:h-7 ce:text-xs'
              id={captionInputId}
              onChange={(event) => setCaptionDraft(event.target.value)}
              onKeyDown={onTextKeyDown}
              placeholder='Optional caption shown under the image'
              value={captionDraft}
            />
          </label>
          {altError ? <span className='ce:text-[11px] ce:text-destructive-ink'>{altError}</span> : null}
          <div className='ce:flex ce:items-center ce:justify-end ce:gap-1'>
            <Button
              aria-label='Cancel text edit'
              className='ce:size-7'
              onClick={cancelText}
              size='icon'
              type='button'
              variant='ghost'
            >
              <IconX className='ce:size-4' />
            </Button>
            <Button
              aria-label='Apply text'
              className='ce:size-7'
              onClick={commitText}
              size='icon'
              type='button'
              variant='ghost'
            >
              <IconCheck className='ce:size-4' />
            </Button>
          </div>
        </div>
      ) : null}
    </EditorFloatingMenu>
  );
}
