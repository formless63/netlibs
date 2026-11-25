'use client';

import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '../ui/index.tsx';
import { cn } from '../ui/cn.ts';

import { RICH_TABLE_GRIP_CLICK_EVENT, type RichTableGripClickDetail } from '@formless63/editor-core';

/**
 * The menu for table grips. Nothing shows until a grip is clicked. Deleting the table asks for
 * confirmation.
 *
 * It is exempt from the touch gate: it opens only on an explicit press, whose own release is what
 * would arm the gate.
 */
export function EditorTableControls({ editor }: { editor: Editor | null }) {
  const [menu, setMenu] = useState<RichTableGripClickDetail | null>(null);
  const [pendingDeleteTableAnchor, setPendingDeleteTableAnchor] = useState<number | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);

  useEffect(() => {
    if (!editor) return;
    const handleGripClick = (event: Event) => {
      const detail = (event as CustomEvent<RichTableGripClickDetail>).detail;
      if (!detail) return;
      setMenu(detail);
    };
    const host = editor.view.dom;
    host.addEventListener(RICH_TABLE_GRIP_CLICK_EVENT, handleGripClick);
    return () => host.removeEventListener(RICH_TABLE_GRIP_CLICK_EVENT, handleGripClick);
  }, [editor]);

  useEffect(() => {
    if (!menu) return;
    const handlePointerDown = () => closeMenu();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    // Bubble-phase: the grip's own `mousedown` handler in `table-grips.ts`
    // calls `stopPropagation()`, so the click that *opened* this menu never
    // reaches these listeners — only a later, outside click will.
    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [menu, closeMenu]);

  if (!editor) return null;

  const runAtAnchor = (anchorPos: number, run: () => void) => {
    editor.chain().focus().setCellSelection({ anchorCell: anchorPos }).run();
    run();
    closeMenu();
  };

  const items: { label: string; onClick: () => void; destructive?: boolean }[] = [];
  if (menu?.kind === 'row') {
    items.push(
      {
        label: 'Insert row above',
        onClick: () =>
          runAtAnchor(menu.anchorPos, () => editor.chain().focus().addRowBefore().run())
      },
      {
        label: 'Insert row below',
        onClick: () => runAtAnchor(menu.anchorPos, () => editor.chain().focus().addRowAfter().run())
      },
      {
        label: 'Delete row',
        destructive: true,
        onClick: () => runAtAnchor(menu.anchorPos, () => editor.chain().focus().deleteRow().run())
      }
    );
  } else if (menu?.kind === 'column') {
    items.push(
      {
        label: 'Insert column left',
        onClick: () =>
          runAtAnchor(menu.anchorPos, () => editor.chain().focus().addColumnBefore().run())
      },
      {
        label: 'Insert column right',
        onClick: () =>
          runAtAnchor(menu.anchorPos, () => editor.chain().focus().addColumnAfter().run())
      },
      {
        label: 'Delete column',
        destructive: true,
        onClick: () =>
          runAtAnchor(menu.anchorPos, () => editor.chain().focus().deleteColumn().run())
      }
    );
  } else if (menu?.kind === 'corner') {
    items.push(
      {
        label: 'Toggle header row',
        onClick: () =>
          runAtAnchor(menu.anchorPos, () => editor.chain().focus().toggleHeaderRow().run())
      },
      {
        label: 'Toggle header column',
        onClick: () =>
          runAtAnchor(menu.anchorPos, () => editor.chain().focus().toggleHeaderColumn().run())
      },
      {
        label: 'Delete table…',
        destructive: true,
        onClick: () => {
          setPendingDeleteTableAnchor(menu.anchorPos);
          closeMenu();
        }
      }
    );
  }

  return (
    <>
      {menu ? (
        <div
          className='ce:fixed ce:z-50 ce:min-w-40 ce:rounded-md ce:border ce:bg-popover ce:p-1 ce:text-popover-foreground ce:shadow-md'
          onMouseDown={(event) => event.stopPropagation()}
          role='menu'
          style={{ left: menu.rect.left, top: menu.rect.bottom + 4 }}
          tabIndex={-1}
        >
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
      ) : null}

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setPendingDeleteTableAnchor(null);
        }}
        open={pendingDeleteTableAnchor !== null}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this table?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the table and everything in it from the document. This can&apos;t be
              undone from here — you would need to restore an earlier revision to get it back.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDeleteTableAnchor === null) return;
                editor
                  .chain()
                  .focus()
                  .setCellSelection({ anchorCell: pendingDeleteTableAnchor })
                  .deleteTable()
                  .run();
                setPendingDeleteTableAnchor(null);
              }}
            >
              Delete table
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
