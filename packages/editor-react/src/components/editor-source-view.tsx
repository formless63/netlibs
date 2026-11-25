'use client';

import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as codeMirrorPlaceholder } from '@codemirror/view';
import { tags } from '@lezer/highlight';

import { cn } from '../ui/cn.ts';

/**
 * A Markdown color scheme built from CSS custom properties, so it follows the host theme and mode.
 */
const richMarkdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '600', color: 'var(--rich-foreground)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--rich-foreground)' },
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--rich-foreground)' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--rich-primary)' },
  { tag: tags.url, color: 'var(--rich-primary)', textDecoration: 'underline' },
  { tag: tags.monospace, fontFamily: 'var(--rich-font-mono)', color: 'var(--rich-accent-foreground)' },
  { tag: tags.quote, color: 'var(--rich-muted-foreground)', fontStyle: 'italic' },
  { tag: tags.processingInstruction, color: 'var(--rich-muted-foreground)' },
  { tag: tags.contentSeparator, color: 'var(--rich-muted-foreground)' },
  { tag: tags.meta, color: 'var(--rich-muted-foreground)' },
  { tag: tags.list, color: 'var(--rich-foreground)' }
]);

const editorSourceTheme = EditorView.theme({
  '&': {
    color: 'var(--rich-foreground)',
    backgroundColor: 'transparent',
    fontSize: '0.875rem',
    height: '100%'
  },
  '.cm-content': {
    fontFamily: 'var(--rich-font-mono)',
    padding: '1.25rem 1.5rem',
    caretColor: 'var(--rich-foreground)'
  },
  '.cm-line': { padding: '0' },
  '.cm-scroller': {
    lineHeight: '1.6',
    fontFamily: 'var(--rich-font-mono)'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--rich-foreground)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in oklch, var(--rich-primary) 25%, transparent)'
  },
  '.cm-gutters': { display: 'none' },
  '.cm-placeholder': { color: 'var(--rich-muted-foreground)' }
});

export interface EditorSourceViewProps {
  /** Seeds the CodeMirror buffer on mount only — see the doc comment below on why this is uncontrolled. */
  value: string;
  /** Fires on every doc-changing transaction with the buffer's current full text. */
  onChange: (value: string) => void;
  autoFocus?: boolean;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  lineSeparator?: string;
}

/**
 * The CodeMirror source buffer. Uncontrolled: `value` seeds it at mount, because replacing it later
 * would fight the cursor and undo history. The parent remounts it with a new `key` to reset it.
 */
export function EditorSourceView({
  value,
  onChange,
  autoFocus = false,
  placeholder,
  className,
  ariaLabel = 'Markdown source',
  lineSeparator
}: EditorSourceViewProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const extensions = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      markdown({ base: markdownLanguage }),
      syntaxHighlighting(richMarkdownHighlightStyle),
      editorSourceTheme,
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
      ...(lineSeparator ? [EditorState.lineSeparator.of(lineSeparator)] : []),
      ...(placeholder ? [codeMirrorPlaceholder(placeholder)] : []),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChangeRef.current(update.state.sliceDoc());
      })
    ];
    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: hostRef.current
    });
    viewRef.current = view;
    if (autoFocus) view.focus();
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Mount once — `value` only seeds the initial doc; see the component doc
    // comment above for why this stays uncontrolled after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn('ce:h-full ce:min-h-[32rem] ce:overflow-auto', className)}
      data-rich-source-view=''
      ref={hostRef}
    />
  );
}
