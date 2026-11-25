import './test-dom.ts';

import {
  createVersionedDocument,
  DocumentConflictError,
  validateEditorDocument,
  type EditorDocument
} from '@formless63/editor-core';
import { afterEach, describe, expect, it } from 'bun:test';
import { act, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';

import {
  RichTextEditor,
  runRichSlashCommand,
  RICH_SLASH_COMMANDS,
  type RichTextEditorHandle,
  type UnsavedState
} from '../src/index.ts';
import { testResolver } from './resolver.ts';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const doc = (value: string): EditorDocument => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }]
});

let roots: Array<{ root: Root; host: HTMLElement }> = [];
const settle = (ms = 30) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

async function mount(node: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push({ root, host });
  await act(async () => root.render(node));
  await settle();
  return host;
}

afterEach(async () => {
  for (const { root, host } of roots) {
    await act(async () => root.unmount());
    host.remove();
  }
  roots = [];
  window.localStorage?.clear();
});

const noSave = async () => ({ version: 2 });

describe('RichTextEditor', () => {
  it('server-renders a placeholder without touching the DOM or Tiptap view', () => {
    const html = renderToString(
      <RichTextEditor documentId='a' initialContent={doc('hi')} onSave={noSave} version={1} />
    );
    expect(html).toContain('Loading editor');
  });

  it('opens bare, versioned and pre-extraction content', async () => {
    for (const content of [doc('hello'), createVersionedDocument(doc('hello')), { type: 'doc' }]) {
      const host = await mount(
        <RichTextEditor documentId='a' initialContent={content} onSave={noSave} version={1} />
      );
      expect(host.querySelector('.ProseMirror')).not.toBeNull();
    }
  });

  it('refuses content it cannot represent instead of overwriting it', async () => {
    let saves = 0;
    const host = await mount(
      <RichTextEditor
        documentId='a'
        initialContent={{ type: 'doc', content: [{ type: 'mystery' }] }}
        onSave={async () => ({ version: (saves += 1) })}
        version={1}
      />
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('mystery');
    expect(host.querySelector('.ProseMirror')).toBeNull();
    expect(saves).toBe(0);
  });

  it('autosaves valid content against the last version and reports unsaved state', async () => {
    const calls: Array<{ content: EditorDocument; expectedVersion: number }> = [];
    const states: UnsavedState[] = [];
    const ref = createRef<RichTextEditorHandle>();
    const host = await mount(
      <RichTextEditor
        autosaveDelayMs={5}
        documentId='a'
        initialContent={doc('one')}
        onSave={async (input) => {
          calls.push(input);
          return { version: input.expectedVersion + 1 };
        }}
        onUnsavedChange={(state) => states.push(state)}
        ref={ref}
        resolver={testResolver}
        version={7}
      />
    );
    for (const word of [' two', ' three']) {
      await act(async () => void ref.current!.getEditor()!.commands.insertContentAt(1, word));
      await settle(60);
    }
    expect(calls.map((call) => call.expectedVersion)).toEqual([7, 8]);
    for (const call of calls) expect(validateEditorDocument(call.content).findings).toEqual([]);
    expect(states.some((state) => state.hasUnsavedChanges)).toBe(true);
    expect(states.at(-1)?.hasUnsavedChanges).toBe(false);
    expect(ref.current!.hasUnsavedChanges()).toBe(false);
    expect(host.textContent).toContain('Version 9');
  });

  it('does not save a new version just for opening a document', async () => {
    let saves = 0;
    await mount(
      <RichTextEditor
        autosaveDelayMs={5}
        documentId='a'
        initialContent={doc('no block ids yet')}
        onSave={async () => ({ version: (saves += 1) })}
        version={1}
      />
    );
    await settle(60);
    expect(saves).toBe(0);
  });

  it('keeps local edits and stops saving on a version conflict', async () => {
    const ref = createRef<RichTextEditorHandle>();
    let attempts = 0;
    const host = await mount(
      <RichTextEditor
        autosaveDelayMs={5}
        documentId='a'
        initialContent={doc('one')}
        onSave={async () => {
          attempts += 1;
          throw new DocumentConflictError('stale');
        }}
        ref={ref}
        version={1}
      />
    );
    await act(async () => void ref.current!.getEditor()!.commands.insertContentAt(1, 'mine '));
    await settle(60);
    await act(async () => void ref.current!.getEditor()!.commands.insertContentAt(1, 'more '));
    await settle(60);
    expect(attempts).toBe(1);
    expect(JSON.stringify(ref.current!.getContent())).toContain('more mine one');
    expect(ref.current!.hasUnsavedChanges()).toBe(true);
    expect(await ref.current!.save()).toBe(false);
    expect(host.querySelector('footer [role="alert"]')).not.toBeNull();
  });

  it('saves on demand through the handle', async () => {
    const ref = createRef<RichTextEditorHandle>();
    let saved = 0;
    await mount(
      <RichTextEditor
        autosaveDelayMs={60_000}
        documentId='a'
        initialContent={doc('one')}
        onSave={async () => ({ version: (saved += 1) + 1 })}
        ref={ref}
        version={1}
      />
    );
    await act(async () => void ref.current!.getEditor()!.commands.insertContentAt(1, 'x'));
    let result = false;
    await act(async () => {
      result = await ref.current!.save();
    });
    expect(result).toBe(true);
    expect(saved).toBe(1);
  });

  it('renders read-only without any editing chrome', async () => {
    const host = await mount(
      <RichTextEditor documentId='a' initialContent={doc('hi')} onSave={noSave} readOnly version={1} />
    );
    expect(host.querySelector('.ProseMirror')?.getAttribute('contenteditable')).toBe('false');
    expect(host.querySelector('select')).toBeNull();
  });

  it('round-trips through Markdown source mode using the shared renderer', async () => {
    const host = await mount(
      <RichTextEditor documentId='a' initialContent={doc('source me')} onSave={noSave} version={1} />
    );
    const select = host.querySelector<HTMLSelectElement>('select')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )!.set!.call(select, 'source');
      select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle();
    expect(host.querySelector('.cm-content')?.textContent).toContain('source me');
    expect(host.querySelector('[data-rich-preview] .rich-content p')?.textContent).toBe('source me');
  });

  it('opens the picker only in the editor that asked for it', async () => {
    const refs = [createRef<RichTextEditorHandle>(), createRef<RichTextEditorHandle>()];
    for (const [index, ref] of refs.entries()) {
      await mount(
        <RichTextEditor
          documentId={String(index)}
          initialContent={doc('x')}
          onSave={noSave}
          ref={ref}
          resources={[{ id: 'r', title: `Resource of ${index}` }]}
          version={1}
        />
      );
    }
    const editor = refs[1]!.current!.getEditor()!;
    await act(async () => runRichSlashCommand('resource', editor, { from: 1, to: 1 }));
    await settle();
    expect(document.body.textContent).toContain('Resource of 1');
    expect(document.body.textContent).not.toContain('Resource of 0');
  });

  it('every slash command leaves a document that can be saved', async () => {
    const ref = createRef<RichTextEditorHandle>();
    await mount(
      <RichTextEditor
        autosaveDelayMs={60_000}
        documentId='a'
        initialContent={{ type: 'doc' }}
        onSave={noSave}
        ref={ref}
        version={1}
      />
    );
    const editor = ref.current!.getEditor()!;
    for (const command of RICH_SLASH_COMMANDS) {
      await act(async () => {
        editor.commands.setContent({ type: 'doc', content: [{ type: 'paragraph' }] });
        runRichSlashCommand(command.id, editor, { from: 1, to: 1 });
      });
      expect(validateEditorDocument(ref.current!.getContent()).findings, command.id).toEqual([]);
    }
  });
});
