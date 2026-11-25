'use client';

import type { Editor } from '@tiptap/react';
import { IconChevronDown, IconChevronUp, IconSearch, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  Button,
  Input
} from '../ui/index.tsx';
import { cn } from '../ui/cn.ts';

import { RICH_FIND_REPLACE_TOGGLE_EVENT } from '../find-replace.ts';

/**
 * The find and replace panel, opened with `Mod-f`, its own button or the toolbar. `hideTrigger`
 * hides the floating button when the toolbar provides one. It uses decorations and text replacement
 * only, and clears the search on close.
 */
export function EditorFindReplace({
  editor,
  hideTrigger = false
}: {
  editor: Editor | null;
  hideTrigger?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [replaceValue, setReplaceValue] = useState('');
  const [matchCount, setMatchCount] = useState(0);
  const [resultIndex, setResultIndex] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const closePanel = useCallback(() => {
    setOpen(false);
    if (editor && !editor.isDestroyed) editor.commands.setSearchTerm('');
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const toggle = () => setOpen((current) => !current);
    const host = editor.view.dom;
    host.addEventListener(RICH_FIND_REPLACE_TOGGLE_EVENT, toggle);
    return () => host.removeEventListener(RICH_FIND_REPLACE_TOGGLE_EVENT, toggle);
  }, [editor]);

  useEffect(() => {
    if (open) searchInputRef.current?.focus();
  }, [open]);

  // The extension's commands mutate `editor.storage.searchAndReplace`
  // directly and don't emit their own React-visible event; `editor.commands.X()`
  // always dispatches a transaction regardless of the command's own return
  // value (Tiptap's `CommandManager`), so the plugin's decoration/`results`
  // recompute always runs — `editor.on('transaction', ...)` is the correct,
  // always-fires hook to resync this panel's match-count/position display
  // after every search/replace/navigate call below.
  useEffect(() => {
    if (!editor) return;
    const sync = () => {
      const storage = editor.storage.searchAndReplace;
      setMatchCount(storage?.results.length ?? 0);
      setResultIndex(storage?.resultIndex ?? 0);
    };
    sync();
    editor.on('transaction', sync);
    return () => {
      editor.off('transaction', sync);
    };
  }, [editor]);

  const scrollToCurrentMatch = useCallback(() => {
    if (!editor) return;
    const current = editor.view.dom.querySelector('.rich-search-result-current');
    current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [editor]);

  const runSearch = useCallback(
    (term: string) => {
      if (!editor) return;
      editor.commands.setSearchTerm(term);
      requestAnimationFrame(scrollToCurrentMatch);
    },
    [editor, scrollToCurrentMatch]
  );

  const goToNext = useCallback(() => {
    if (!editor) return;
    editor.commands.nextSearchResult();
    scrollToCurrentMatch();
  }, [editor, scrollToCurrentMatch]);

  const goToPrevious = useCallback(() => {
    if (!editor) return;
    editor.commands.previousSearchResult();
    scrollToCurrentMatch();
  }, [editor, scrollToCurrentMatch]);

  if (!editor) return null;

  if (!open) {
    if (hideTrigger) return null;
    return (
      <Button
        aria-label='Find and replace (Ctrl/Cmd+F)'
        className='ce:absolute ce:top-2 ce:right-2 ce:z-10'
        onClick={() => setOpen(true)}
        size='icon'
        title='Find and replace (Ctrl/Cmd+F)'
        type='button'
        variant='ghost'
      >
        <IconSearch className='ce:size-4' />
      </Button>
    );
  }

  return (
    <div
      className='ce:absolute ce:top-2 ce:right-2 ce:z-10 ce:flex ce:w-72 ce:max-w-[calc(100%-1rem)] ce:flex-col ce:gap-1.5 ce:rounded-md ce:border ce:bg-popover ce:p-2 ce:text-popover-foreground ce:shadow-md'
      role='search'
    >
      <div className='ce:flex ce:items-center ce:gap-1'>
        <Input
          className='ce:h-8'
          onChange={(event) => {
            setSearchValue(event.target.value);
            runSearch(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              closePanel();
              return;
            }
            if (event.key === 'Enter') {
              event.preventDefault();
              if (event.shiftKey) goToPrevious();
              else goToNext();
            }
          }}
          placeholder='Find'
          ref={searchInputRef}
          value={searchValue}
        />
        <span
          className={cn(
            'ce:w-12 ce:shrink-0 ce:text-center ce:text-xs ce:text-muted-foreground',
            matchCount === 0 && searchValue.length > 0 && 'ce:text-destructive-ink'
          )}
        >
          {searchValue.length === 0
            ? ''
            : matchCount === 0
              ? '0/0'
              : `${resultIndex + 1}/${matchCount}`}
        </span>
        <Button
          aria-label='Previous match'
          className='ce:size-8'
          disabled={matchCount === 0}
          onClick={goToPrevious}
          size='icon'
          type='button'
          variant='ghost'
        >
          <IconChevronUp className='ce:size-4' />
        </Button>
        <Button
          aria-label='Next match'
          className='ce:size-8'
          disabled={matchCount === 0}
          onClick={goToNext}
          size='icon'
          type='button'
          variant='ghost'
        >
          <IconChevronDown className='ce:size-4' />
        </Button>
        <Button
          aria-label='Close find and replace'
          className='ce:size-8'
          onClick={closePanel}
          size='icon'
          type='button'
          variant='ghost'
        >
          <IconX className='ce:size-4' />
        </Button>
      </div>
      <div className='ce:flex ce:items-center ce:gap-1'>
        <Input
          className='ce:h-8'
          onChange={(event) => {
            setReplaceValue(event.target.value);
            editor.commands.setReplaceTerm(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') closePanel();
          }}
          placeholder='Replace'
          value={replaceValue}
        />
        <Button
          className='ce:h-8 ce:shrink-0'
          disabled={matchCount === 0}
          onClick={() => editor.commands.replace()}
          size='sm'
          type='button'
          variant='outline'
        >
          Replace
        </Button>
        <Button
          className='ce:h-8 ce:shrink-0'
          disabled={matchCount === 0}
          onClick={() => editor.commands.replaceAll()}
          size='sm'
          type='button'
          variant='outline'
        >
          Replace all
        </Button>
      </div>
    </div>
  );
}
