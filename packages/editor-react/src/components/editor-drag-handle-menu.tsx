'use client';

import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '../ui/cn.ts';

import {
  applyRichBlockDelete,
  applyRichBlockDuplicate,
  applyRichBlockResetFormatting
} from '@formless63/editor-core';
import {
  insertRichBlockAdjacentParagraph,
  richBlockLinkTarget,
  richDragHandleTurnIntoOptions,
  RICH_DRAG_HANDLE_MENU_EVENT,
  type RichDragHandleMenuOpenDetail,
  type RichDragHandleTurnIntoOption
} from '@formless63/editor-core';
import { RICH_CALLOUT_COLORS, type RichCalloutColor, type EditorResolver } from '@formless63/editor-core';
import { runRichSlashCommand } from './editor-slash-menu.tsx';

const CALLOUT_COLOR_SWATCH: Record<RichCalloutColor | 'default', string> = {
  default: 'var(--rich-muted-foreground)',
  gray: 'var(--rich-muted-foreground)',
  red: 'var(--rich-destructive)',
  orange: 'var(--rich-orange)',
  yellow: 'var(--rich-warning)',
  green: 'var(--rich-success)',
  blue: 'var(--rich-info)',
  purple: 'var(--rich-purple)'
};

/**
 * Runs one "Turn into" option on the block at `pos`: selects its whole content, then runs each step
 * through the slash menu's own commands. Exported for tests.
 */
export function runRichDragHandleTurnInto(
  editor: Editor,
  pos: number,
  option: RichDragHandleTurnIntoOption
): void {
  const { doc } = editor.state;
  const node = doc.nodeAt(pos);
  if (!node || node.nodeSize < 2) return;
  const $from = doc.resolve(pos + 1);
  const $to = doc.resolve(pos + node.nodeSize - 1);
  editor.view.dispatch(editor.state.tr.setSelection(TextSelection.between($from, $to)));
  for (const step of option.steps) {
    if (step.kind === 'lift-callout') {
      editor.chain().focus().unsetRichCallout().run();
    } else {
      // Collapsed range: `runRichSlashCommand`'s leading `deleteRange` is a
      // no-op (same shape the slash contract test uses), and the command runs
      // against the selection set above (mapped through any prior step).
      const at = editor.state.selection.from;
      runRichSlashCommand(step.id, editor, { from: at, to: at });
    }
  }
}

/**
 * The drag-handle menu. `drag-handle.ts` detects the click; this owns the UI and edits: turn into,
 * insert paragraph, copy block link, duplicate, reset and delete.
 *
 * It needs no touch gate: the grip is hidden on coarse pointers and opens only on an explicit
 * click.
 */
export function EditorDragHandleMenu({
  documentId,
  editor,
  resolver
}: {
  documentId: string;
  editor: Editor | null;
  resolver: EditorResolver;
}) {
  const [menu, setMenu] = useState<RichDragHandleMenuOpenDetail | null>(null);
  const [turnIntoOpen, setTurnIntoOpen] = useState(false);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setTurnIntoOpen(false);
  }, []);

  useEffect(() => {
    if (!editor) return;
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<RichDragHandleMenuOpenDetail>).detail;
      if (!detail) return;
      setTurnIntoOpen(false);
      setMenu(detail);
    };
    const host = editor.view.dom;
    host.addEventListener(RICH_DRAG_HANDLE_MENU_EVENT, handleOpen);
    return () => host.removeEventListener(RICH_DRAG_HANDLE_MENU_EVENT, handleOpen);
  }, [editor]);

  useEffect(() => {
    if (!menu) return;
    // The grip's own `mousedown` handler in `drag-handle.ts` calls
    // `stopPropagation()`, so the click that opened this menu never reaches
    // this listener — only a later, outside click will (same reasoning as
    // `EditorTableControls`).
    const handlePointerDown = () => closeMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, closeMenu]);

  if (!editor || !menu) return null;

  const run = (
    apply: (tr: Parameters<typeof applyRichBlockDelete>[0], pos: number) => boolean
  ) => {
    const tr = editor.state.tr;
    if (apply(tr, menu.pos)) {
      editor.view.dispatch(tr);
      editor.view.focus();
    }
    closeMenu();
  };

  const blockNode = editor.state.doc.nodeAt(menu.pos);
  const turnIntoOptions = blockNode ? richDragHandleTurnIntoOptions(blockNode) : [];
  const blockLinkTarget = blockNode ? richBlockLinkTarget(documentId, blockNode) : null;
  const blockLinkHref = blockLinkTarget ? resolver.documentHref(blockLinkTarget) : null;

  const turnInto = (option: RichDragHandleTurnIntoOption) => {
    runRichDragHandleTurnInto(editor, menu.pos, option);
    editor.view.focus();
    closeMenu();
  };

  const insertAdjacent = (side: 'above' | 'below') => {
    insertRichBlockAdjacentParagraph(editor, menu.pos, side);
    closeMenu();
  };

  const copyBlockLink = () => {
    if (blockLinkHref) {
      void navigator.clipboard?.writeText(new URL(blockLinkHref, window.location.href).href);
    }
    closeMenu();
  };

  const items: { label: string; onClick: () => void; destructive?: boolean }[] = [
    { label: 'Insert paragraph above', onClick: () => insertAdjacent('above') },
    { label: 'Insert paragraph below', onClick: () => insertAdjacent('below') },
    ...(blockLinkHref ? [{ label: 'Copy link to block', onClick: copyBlockLink }] : []),
    { label: 'Duplicate block', onClick: () => run(applyRichBlockDuplicate) },
    { label: 'Reset formatting', onClick: () => run(applyRichBlockResetFormatting) },
    { label: 'Delete block', destructive: true, onClick: () => run(applyRichBlockDelete) }
  ];

  // Callout color picker: only shown when the grip's block is
  // a callout. Sets the optional `color` attr directly on that node; `default`
  // clears it back to the kind-derived palette.
  const isCallout = blockNode?.type.name === 'callout';
  const setCalloutColor = (color: RichCalloutColor | null): void => {
    editor
      .chain()
      .command(({ tr }) => {
        tr.setNodeAttribute(menu.pos, 'color', color);
        return true;
      })
      .run();
    editor.view.focus();
    closeMenu();
  };

  return (
    <div
      className='ce:fixed ce:z-50 ce:min-w-44 ce:rounded-md ce:border ce:bg-popover ce:p-1 ce:text-popover-foreground ce:shadow-md'
      onMouseDown={(event) => event.stopPropagation()}
      role='menu'
      style={{ left: menu.rect.left, top: menu.rect.bottom + 4 }}
      tabIndex={-1}
    >
      {isCallout ? (
        <div className='ce:border-b ce:px-2 ce:pb-2 ce:pt-1'>
          <div className='ce:pb-1 ce:text-[10px] ce:uppercase ce:tracking-wide ce:text-muted-foreground'>
            Callout color
          </div>
          <div className='ce:flex ce:flex-wrap ce:gap-1'>
            {(['default', ...RICH_CALLOUT_COLORS] as const).map((color) => (
              <button
                aria-label={color}
                className='ce:size-5 ce:rounded-full ce:border'
                key={color}
                onClick={() => setCalloutColor(color === 'default' ? null : color)}
                style={{ backgroundColor: CALLOUT_COLOR_SWATCH[color] }}
                title={color}
                type='button'
              />
            ))}
          </div>
        </div>
      ) : null}
      {turnIntoOptions.length > 0 ? (
        <>
          <button
            aria-expanded={turnIntoOpen}
            className='ce:flex ce:w-full ce:items-center ce:justify-between ce:rounded-sm ce:px-2 ce:py-1.5 ce:text-left ce:text-sm ce:hover:bg-accent ce:hover:text-accent-foreground'
            onClick={() => setTurnIntoOpen((open) => !open)}
            role='menuitem'
            type='button'
          >
            Turn into
            <span aria-hidden='true' className='ce:text-muted-foreground'>
              {turnIntoOpen ? '▾' : '▸'}
            </span>
          </button>
          {turnIntoOpen ? (
            <div className='ce:mb-1 ce:border-b ce:pb-1'>
              {turnIntoOptions.map((option) => (
                <button
                  className='ce:flex ce:w-full ce:items-center ce:rounded-sm ce:py-1.5 ce:pl-6 ce:pr-2 ce:text-left ce:text-sm ce:hover:bg-accent ce:hover:text-accent-foreground'
                  key={option.id}
                  onClick={() => turnInto(option)}
                  role='menuitem'
                  type='button'
                >
                  {option.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
      {items.map((item, index) => (
        <button
          className={cn(
            'ce:flex ce:w-full ce:items-center ce:rounded-sm ce:px-2 ce:py-1.5 ce:text-left ce:text-sm ce:hover:bg-accent ce:hover:text-accent-foreground',
            item.destructive &&
              'ce:text-destructive-ink ce:hover:bg-destructive/10 ce:hover:text-destructive-ink',
            index === items.length - 1 && item.destructive && 'ce:mt-1 ce:border-t ce:pt-2'
          )}
          key={item.label}
          onClick={item.onClick}
          role='menuitem'
          type='button'
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
