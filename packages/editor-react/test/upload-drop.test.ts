import { Editor, type Content } from '@tiptap/core';
import { describe, expect, it, vi } from 'bun:test';

import { Slice } from '@tiptap/pm/model';

import './test-dom.ts';

import { testResolver } from './resolver.ts';

import { createEditorExtensions } from '@formless63/editor-core';
import type { EditorDocument } from '@formless63/editor-core';
import {
  createRichUploadExtension,
  deriveRichUploadAlt,
  handleRichUploadFiles,
  insertRichUploadResult,
  richClipboardPasteDisposition,
  type RichUploadFn,
  type RichUploadProgressEvent,
  type RichUploadResult
} from '../src/upload-drop.ts';
import { validateEditorDocument } from '@formless63/editor-core';

/**
 * Drop and paste handling with a fake upload function: node building, ordering, progress and
 * errors.
 */
function makeEditor(content: Content = { type: 'doc', content: [{ type: 'paragraph' }] }): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({ element: el, extensions: createEditorExtensions({ resolver: testResolver }), content });
}

function docJson(editor: Editor): EditorDocument {
  return editor.getJSON() as EditorDocument;
}

function makeFile(name: string, type: string, contents = 'fixture bytes'): File {
  return new File([contents], name, { type });
}

async function waitForAssertion(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw lastError;
}

function makeUploadEditor(uploadFn: RichUploadFn): Editor {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return new Editor({
    element: el,
    extensions: [...createEditorExtensions(), createRichUploadExtension({ uploadFn })],
    content: { type: 'doc', content: [{ type: 'paragraph' }] }
  });
}

function makePasteEvent(files: File[], html: string): ClipboardEvent {
  return {
    clipboardData: {
      files,
      getData: (type: string) => (type === 'text/html' ? html : '')
    },
    preventDefault: vi.fn(),
    stopPropagation: vi.fn()
  } as unknown as ClipboardEvent;
}

function dispatchPaste(editor: Editor, event: ClipboardEvent): boolean {
  return (
    editor.view.someProp('handlePaste', (handler) => handler(editor.view, event, Slice.empty)) ??
    false
  );
}

describe('deriveRichUploadAlt', () => {
  it('strips the extension from a normal filename', () => {
    expect(deriveRichUploadAlt('vacation-photo.png', 'fallback')).toBe('vacation-photo');
  });

  it('falls back to the resource title when the filename has no usable stem', () => {
    expect(deriveRichUploadAlt('.png', 'Uploaded image')).toBe('Uploaded image');
    expect(deriveRichUploadAlt('', 'Uploaded image')).toBe('Uploaded image');
  });
});

describe('insertRichUploadResult', () => {
  it('inserts a canonical image node with attrs.resourceId and a filename-derived alt', () => {
    const editor = makeEditor();
    const result: RichUploadResult = {
      resourceId: '11111111-1111-4111-8111-111111111111',
      title: 'A photo',
      contentType: 'image/png'
    };
    const inserted = insertRichUploadResult(
      editor,
      editor.state.doc.content.size,
      result,
      'my-photo.png'
    );
    expect(inserted).toBe(true);

    const json = docJson(editor);
    const imageNode = json.content?.find((node) => node.type === 'image');
    expect(imageNode).toMatchObject({
      type: 'image',
      attrs: { resourceId: result.resourceId, alt: 'my-photo', title: 'A photo' }
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('inserts a canonical resourceCard (kind=file) for a non-image upload — the distinct file card ', () => {
    const editor = makeEditor();
    const result: RichUploadResult = {
      resourceId: '22222222-2222-4222-8222-222222222222',
      title: 'invoice.pdf',
      contentType: 'application/pdf'
    };
    const inserted = insertRichUploadResult(
      editor,
      editor.state.doc.content.size,
      result,
      'invoice.pdf'
    );
    expect(inserted).toBe(true);

    const json = docJson(editor);
    const card = json.content?.find((node) => node.type === 'resourceCard');
    expect(card).toMatchObject({
      type: 'resourceCard',
      attrs: {
        resourceId: result.resourceId,
        title: 'invoice.pdf',
        kind: 'file',
        // Matches the selector `ingestRichUserUpload` stamps on the
        // resource row it creates for a user upload.
        selector: 'live',
        // A fresh drop of a previewable file starts as a preview.
        presentation: 'preview'
      }
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('inserts a plain-card resourceCard for a non-previewable upload (schema v5 — no registered viewer for the extension)', () => {
    const editor = makeEditor();
    const result: RichUploadResult = {
      resourceId: '33333333-3333-4333-8333-333333333333',
      title: 'firmware-bundle.zip',
      contentType: 'application/zip'
    };
    insertRichUploadResult(editor, editor.state.doc.content.size, result, 'firmware-bundle.zip');

    const json = docJson(editor);
    const card = json.content?.find((node) => node.type === 'resourceCard');
    expect(card).toMatchObject({
      type: 'resourceCard',
      attrs: { title: 'firmware-bundle.zip', presentation: 'card' }
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('renders the file card in the editor DOM: wrapper, extension chip, filename, and a Download anchor', () => {
    const editor = makeEditor();
    const result: RichUploadResult = {
      resourceId: '22222222-2222-4222-8222-222222222222',
      title: 'firmware-bundle.zip',
      contentType: 'application/zip'
    };
    insertRichUploadResult(editor, editor.state.doc.content.size, result, 'firmware-bundle.zip');

    const card = editor.view.dom.querySelector('.rich-file-card');
    expect(card).not.toBeNull();
    expect(card?.getAttribute('data-resource-id')).toBe(result.resourceId);
    expect(card?.querySelector('.rich-file-card__icon')?.textContent).toBe('ZIP');
    expect(card?.querySelector('.rich-file-card__name')?.textContent).toBe(
      'firmware-bundle.zip'
    );
    const download = card?.querySelector<HTMLAnchorElement>('a.rich-file-card__download');
    expect(download?.textContent).toBe('Download');
    expect(download?.getAttribute('href')).toBe(`/media/${result.resourceId}?download=1`);
    expect(download?.hasAttribute('download')).toBe(true);
    editor.destroy();
  });
});

describe('handleRichUploadFiles', () => {
  it('calls uploadFn once per file, inserts each result, and reports uploading -> done progress', async () => {
    const editor = makeEditor();
    const results: RichUploadResult[] = [
      {
        resourceId: '33333333-3333-4333-8333-333333333333',
        title: 'First',
        contentType: 'image/png'
      },
      {
        resourceId: '44444444-4444-4444-8444-444444444444',
        title: 'Second',
        contentType: 'image/jpeg'
      }
    ];
    const uploadFn: RichUploadFn = vi.fn(async () => results.shift()!);
    const events: RichUploadProgressEvent[] = [];

    const files = [makeFile('one.png', 'image/png'), makeFile('two.jpg', 'image/jpeg')];
    await handleRichUploadFiles(editor, files, editor.state.doc.content.size, {
      uploadFn,
      onProgress: (event) => events.push(event)
    });

    expect(uploadFn).toHaveBeenCalledTimes(2);
    const json = docJson(editor);
    const imageNodes = json.content?.filter((node) => node.type === 'image') ?? [];
    expect(imageNodes).toHaveLength(2);
    expect(imageNodes[0]?.attrs?.alt).toBe('one');
    expect(imageNodes[1]?.attrs?.alt).toBe('two');

    const statusesByFile = events.reduce<Record<string, string[]>>((acc, event) => {
      (acc[event.filename] ??= []).push(event.status);
      return acc;
    }, {});
    expect(statusesByFile['one.png']).toEqual(['uploading', 'done']);
    expect(statusesByFile['two.jpg']).toEqual(['uploading', 'done']);
    editor.destroy();
  });

  it('reports an error event and calls onError when uploadFn rejects, without touching the document', async () => {
    const editor = makeEditor();
    const uploadFn: RichUploadFn = vi.fn(async () => {
      throw new Error('Upload rejected: file too large');
    });
    const events: RichUploadProgressEvent[] = [];
    const errors: Array<{ file: File; error: unknown }> = [];
    const before = docJson(editor);

    await handleRichUploadFiles(editor, [makeFile('huge.png', 'image/png')], 0, {
      uploadFn,
      onProgress: (event) => events.push(event),
      onError: (file, error) => errors.push({ file, error })
    });

    expect(events.map((event) => event.status)).toEqual(['uploading', 'error']);
    expect(events[1]?.message).toBe('Upload rejected: file too large');
    expect(errors).toHaveLength(1);
    expect(docJson(editor)).toEqual(before);
    editor.destroy();
  });

  it('processes multiple files sequentially, each insert advancing the next insertion point', async () => {
    const editor = makeEditor();
    let call = 0;
    const uploadFn: RichUploadFn = vi.fn(async () => {
      call += 1;
      return {
        resourceId: `55555555-5555-4555-8555-55555555555${call}`,
        title: `File ${call}`,
        contentType: 'image/png'
      };
    });

    await handleRichUploadFiles(
      editor,
      [
        makeFile('a.png', 'image/png'),
        makeFile('b.png', 'image/png'),
        makeFile('c.png', 'image/png')
      ],
      editor.state.doc.content.size,
      { uploadFn }
    );

    const json = docJson(editor);
    const imageAlts = json.content
      ?.filter((node) => node.type === 'image')
      .map((node) => node.attrs?.alt);
    expect(imageAlts).toEqual(['a', 'b', 'c']);
    editor.destroy();
  });

  it('drops a non-image file through the pipeline into a kind=file resourceCard ', async () => {
    const editor = makeEditor();
    const uploadFn: RichUploadFn = vi.fn(async () => ({
      resourceId: '99999999-9999-4999-8999-999999999999',
      title: 'schematics.zip',
      contentType: 'application/zip'
    }));

    await handleRichUploadFiles(
      editor,
      [makeFile('schematics.zip', 'application/zip')],
      editor.state.doc.content.size,
      { uploadFn }
    );

    const json = docJson(editor);
    const card = json.content?.find((node) => node.type === 'resourceCard');
    expect(card).toMatchObject({
      type: 'resourceCard',
      attrs: {
        resourceId: '99999999-9999-4999-8999-999999999999',
        title: 'schematics.zip',
        kind: 'file',
        selector: 'live'
      }
    });
    expect(validateEditorDocument(json)).toMatchObject({ success: true });
    editor.destroy();
  });

  it('falls back to a synthesized filename for a nameless pasted blob', async () => {
    const editor = makeEditor();
    const uploadFn: RichUploadFn = vi.fn(async () => ({
      resourceId: '66666666-6666-4666-8666-666666666666',
      title: 'Pasted image',
      contentType: 'image/png'
    }));
    const events: RichUploadProgressEvent[] = [];
    const pasted = new File(['bytes'], '', { type: 'image/png' });

    await handleRichUploadFiles(editor, [pasted], editor.state.doc.content.size, {
      uploadFn,
      onProgress: (event) => events.push(event)
    });

    expect(events[0]?.filename).toBe('pasted-image.png');
    editor.destroy();
  });
});

// Spreadsheets put both HTML and a picture of the range on the clipboard.
const EXCEL_HTML = `
  <html xmlns:x="urn:schemas-microsoft-com:office:excel"><head>
  <style>td { mso-number-format: General; }</style></head><body>
  <table><tbody><tr><td>Qty</td><td>SKU</td></tr>
  <tr><td>4</td><td>RA-SNES-CSYNC</td></tr></tbody></table></body></html>`;

describe('richClipboardPasteDisposition ', () => {
  it('Excel/Sheets shape (table HTML + image flavor) → consume-html', () => {
    expect(richClipboardPasteDisposition(EXCEL_HTML)).toBe('consume-html');
  });

  it('pure screenshot (no HTML flavor at all) → upload-files', () => {
    expect(richClipboardPasteDisposition('')).toBe('upload-files');
    expect(richClipboardPasteDisposition('   ')).toBe('upload-files');
  });

  it('rich text with embedded images → consume-html (text wins; files ignored)', () => {
    expect(
      richClipboardPasteDisposition('<p>hello <img src="https://example.com/pic.png"> world</p>')
    ).toBe('consume-html');
  });

  it('bare foreign-image wrapper (Chrome copy-image of a web image) → upload-files', () => {
    expect(richClipboardPasteDisposition('<img src="https://example.com/pic.png">')).toBe(
      'upload-files'
    );
    expect(
      richClipboardPasteDisposition(
        '<meta charset="utf-8"><img src="https://example.com/a.png">'
      )
    ).toBe('upload-files');
  });

  it('bare CUSTOM-EMOJI image wrapper → consume-html (the parse rules reconstruct the inline atom; never re-upload our own asset)', () => {
    expect(
      richClipboardPasteDisposition(
        '<img src="https://example.invalid/rich-emoji/octocat.png">'
      )
    ).toBe('consume-html');
    expect(
      richClipboardPasteDisposition(
        '<img class="rich-custom-emoji" src="/rich-emoji/shipit.png" data-rich-custom-emoji="shipit">'
      )
    ).toBe('consume-html');
  });

  it('a copied library image (data-resource-id) → consume-html (parses back to the canonical node; no duplicate upload)', () => {
    expect(
      richClipboardPasteDisposition(
        '<img src="/api/resources/11111111-1111-4111-8111-111111111111/content" data-resource-id="11111111-1111-4111-8111-111111111111">'
      )
    ).toBe('consume-html');
  });

  it('style/script cruft alone is not content → upload-files', () => {
    expect(
      richClipboardPasteDisposition(
        '<style>p { color: red; }</style><img src="https://x.test/p.png">'
      )
    ).toBe('upload-files');
  });
});

describe('paste pipeline end-to-end through the live plugin ', () => {
  it('Excel shape: the table is consumed via the HTML flavor and the image flavor is IGNORED — one table, zero uploads', () => {
    const uploadFn: RichUploadFn = vi.fn(async () => {
      throw new Error('must not upload');
    });
    const editor = makeUploadEditor(uploadFn);
    const event = makePasteEvent([makeFile('image.png', 'image/png')], EXCEL_HTML);

    const handled = dispatchPaste(editor, event);
    // Returning false hands the event to ProseMirror's native paste, which
    // inserts the HTML flavor — simulated here since a synthetic event
    // carries no real browser paste pipeline.
    expect(handled).toBe(false);
    expect(uploadFn).not.toHaveBeenCalled();
    editor.commands.insertContent(EXCEL_HTML);

    const json = docJson(editor);
    expect(json.content?.filter((node) => node.type === 'table')).toHaveLength(1);
    expect(json.content?.some((node) => node.type === 'image')).toBe(false);
    expect(validateEditorDocument(json)).toMatchObject({ success: true, findings: [] });
    editor.destroy();
  });

  it('pure screenshot (image-only clipboard): still uploads and inserts the image node', async () => {
    const uploadFn: RichUploadFn = vi.fn(async () => ({
      resourceId: '77777777-7777-4777-8777-777777777777',
      title: 'Pasted image',
      contentType: 'image/png'
    }));
    const editor = makeUploadEditor(uploadFn);
    const event = makePasteEvent([makeFile('', 'image/png')], '');

    const handled = dispatchPaste(editor, event);
    expect(handled).toBe(true);
    expect(event.preventDefault).toHaveBeenCalled();

    await waitForAssertion(() => expect(uploadFn).toHaveBeenCalledTimes(1));
    await waitForAssertion(() => {
      const json = docJson(editor);
      const imageNode = json.content?.find((node) => node.type === 'image');
      expect(imageNode?.attrs?.resourceId).toBe('77777777-7777-4777-8777-777777777777');
    });
    editor.destroy();
  });

  it('rich text with embedded real images: HTML flavor wins, no uploads fire', () => {
    const uploadFn: RichUploadFn = vi.fn(async () => {
      throw new Error('must not upload');
    });
    const editor = makeUploadEditor(uploadFn);
    const html = '<p>hello <img src="https://example.com/pic.png"> world</p>';
    const handled = dispatchPaste(editor, makePasteEvent([makeFile('pic.png', 'image/png')], html));
    expect(handled).toBe(false);
    expect(uploadFn).not.toHaveBeenCalled();
    editor.destroy();
  });

  it('bare foreign-image wrapper: uploads the file AND suppresses the HTML wrapper so nothing double-inserts', async () => {
    const uploadFn: RichUploadFn = vi.fn(async () => ({
      resourceId: '88888888-8888-4888-8888-888888888888',
      title: 'A web image',
      contentType: 'image/png'
    }));
    const editor = makeUploadEditor(uploadFn);
    const event = makePasteEvent(
      [makeFile('pic.png', 'image/png')],
      '<img src="https://example.com/pic.png">'
    );

    const handled = dispatchPaste(editor, event);
    expect(handled).toBe(true);
    await waitForAssertion(() => expect(uploadFn).toHaveBeenCalledTimes(1));
    await waitForAssertion(() => {
      const json = docJson(editor);
      const imageNodes = json.content?.filter((node) => node.type === 'image') ?? [];
      expect(imageNodes).toHaveLength(1);
      expect(imageNodes[0]?.attrs?.resourceId).toBe('88888888-8888-4888-8888-888888888888');
    });
    editor.destroy();
  });

  it('custom-emoji copy-image wrapper: HTML flavor wins and the parse rules reconstruct the inline atom — never a block image, never an upload', () => {
    const uploadFn: RichUploadFn = vi.fn(async () => {
      throw new Error('must not upload');
    });
    const editor = makeUploadEditor(uploadFn);
    const html = '<img src="https://example.invalid/rich-emoji/octocat.png">';
    const handled = dispatchPaste(
      editor,
      makePasteEvent([makeFile('octocat.png', 'image/png')], html)
    );
    expect(handled).toBe(false);
    expect(uploadFn).not.toHaveBeenCalled();
    editor.commands.insertContent(html);

    const json = docJson(editor);
    expect(json.content?.some((node) => node.type === 'image')).toBe(false);
    const paragraph = json.content?.find((node) => node.type === 'paragraph');
    expect(paragraph?.content?.[0]).toMatchObject({
      type: 'customEmoji',
      attrs: { name: 'octocat' }
    });
    editor.destroy();
  });
});
