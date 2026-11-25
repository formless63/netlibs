import { Editor } from '@tiptap/core';
import { describe, expect, it } from 'bun:test';

import './test-dom.ts';
import { testResolver } from './resolver.ts';

import { createEditorExtensions, type RichFilePreviewMounter } from '../src/schema.ts';

const RESOURCE_ID = '11111111-1111-4111-8111-111111111111';

interface MountCall {
  slot: HTMLElement;
  props: Parameters<RichFilePreviewMounter>[1];
}

function createPreviewEditor(mountFilePreview: RichFilePreviewMounter, title = 'manual.pdf') {
  const element = document.createElement('div');
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    extensions: createEditorExtensions({
      resolver: testResolver, mountFilePreview }),
    content: {
      type: 'doc',
      content: [
        {
          type: 'resourceCard',
          attrs: {
            resourceId: RESOURCE_ID,
            title,
            kind: 'file',
            selector: 'latest-approved',
            presentation: 'preview'
          }
        }
      ]
    }
  });
  return { editor, element };
}

async function flushMountMicrotask(): Promise<void> {
  await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe('resourceCard preview node-view mounting', () => {
  it('mounts the initial connected preview without a metadata fetcher', async () => {
    const calls: MountCall[] = [];
    let cleanupCount = 0;
    const { editor, element } = createPreviewEditor((slot, props) => {
      calls.push({ slot, props });
      return () => {
        cleanupCount += 1;
      };
    });

    expect(calls).toHaveLength(0);
    await flushMountMicrotask();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.slot.isConnected).toBe(true);
    expect(calls[0]?.props).toMatchObject({
      title: 'manual.pdf',
      sizeBytes: null,
      viewerKey: 'pdf'
    });

    editor.destroy();
    element.remove();
    expect(cleanupCount).toBe(1);
  });

  it('skips a stale slot when the node view rebuilds before its mount microtask', async () => {
    const calls: MountCall[] = [];
    let cleanupCount = 0;
    const { editor, element } = createPreviewEditor((slot, props) => {
      calls.push({ slot, props });
      return () => {
        cleanupCount += 1;
      };
    }, 'first.pdf');

    editor.view.dispatch(editor.state.tr.setNodeAttribute(0, 'title', 'replacement.pdf'));
    await flushMountMicrotask();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.props.title).toBe('replacement.pdf');
    expect(calls[0]?.slot.isConnected).toBe(true);

    editor.destroy();
    element.remove();
    expect(cleanupCount).toBe(1);
  });

  it('does not mount a slot destroyed before its mount microtask', async () => {
    const calls: MountCall[] = [];
    const { editor, element } = createPreviewEditor((slot, props) => {
      calls.push({ slot, props });
      return () => {};
    });
    const slot = element.querySelector<HTMLElement>('.rich-file-preview-slot');

    expect(slot?.isConnected).toBe(true);
    editor.destroy();
    expect(slot?.isConnected).toBe(false);
    await flushMountMicrotask();

    expect(calls).toHaveLength(0);
    element.remove();
  });
});
