/**
 * Drop and paste uploads. Drop uses `@tiptap/extension-file-handler`; paste is a custom plugin,
 * because the file handler cannot choose between HTML and files on one clipboard. The result
 * becomes an `image` or a file `resourceCard`.
 *
 * The document is not changed while an upload is in flight, so autosave cannot persist a
 * placeholder; `onProgress` is for UI only.
 */

import { Extension, type Editor } from '@tiptap/core';
import { FileHandler } from '@tiptap/extension-file-handler';
import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';

import {
  richCustomEmojiNameFromSrc,
  richViewerKindForContentType,
  richViewerKindForFilename
} from '@formless63/editor-core';

export interface RichUploadResult {
  resourceId: string;
  title: string;
  contentType: string;
}

export type RichUploadFn = (file: File) => Promise<RichUploadResult>;

export type RichUploadProgressStatus = 'uploading' | 'done' | 'error';

export interface RichUploadProgressEvent {
  id: string;
  filename: string;
  status: RichUploadProgressStatus;
  message?: string;
}

/**
 * Window CustomEvent the `/image` slash command dispatches to ask the editor
 * component to open a native file picker and route the chosen file through the
 * same upload pipeline as drop/paste. A DOM-event bridge (same pattern as
 * find-replace / table-grips) keeps the pure `runRichSlashCommand` function
 * decoupled from the upload closure the component owns.
 */
export const RICH_IMAGE_PICKER_EVENT = 'rich-image-picker-open';

let uploadIdCounter = 0;
function nextRichUploadId(): string {
  uploadIdCounter += 1;
  return `rich-upload-${Date.now()}-${uploadIdCounter}`;
}

function isImageContentType(contentType: string): boolean {
  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase();
  return (
    normalized === 'image/png' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/gif' ||
    normalized === 'image/webp' ||
    normalized === 'image/avif'
  );
}

/** Filename sans extension, for the image node's `alt` attr — falls back to the resource's stored title when the stem is empty. */
export function deriveRichUploadAlt(filename: string, fallbackTitle: string): string {
  const stem = filename.replace(/\.[^./\\]+$/, '').trim();
  return stem || fallbackTitle;
}

/**
 * Insert the node/link one completed upload resolves to at `pos`. Returns
 * whether the insertion command actually ran (Tiptap's chain commands return
 * `false` — without throwing — when the target position can't take the
 * content, e.g. a document that changed shape underneath a stale `pos`).
 */
export function insertRichUploadResult(
  editor: Editor,
  pos: number,
  result: RichUploadResult,
  originalFilename: string
): boolean {
  if (isImageContentType(result.contentType)) {
    return editor
      .chain()
      .insertContentAt(pos, {
        type: 'image',
        attrs: {
          resourceId: result.resourceId,
          alt: deriveRichUploadAlt(originalFilename, result.title),
          title: result.title
        }
      })
      .run();
  }

  // A file becomes a `resourceCard` with the host's title. A fresh drop of a previewable kind
  // starts as a preview; picked references stay cards.
  const previewable =
    richViewerKindForContentType(result.contentType) ??
    richViewerKindForFilename(result.title) ??
    richViewerKindForFilename(originalFilename);
  return editor
    .chain()
    .insertContentAt(pos, {
      type: 'resourceCard',
      attrs: {
        resourceId: result.resourceId,
        title: result.title,
        description: null,
        kind: 'file',
        selector: 'live',
        presentation: previewable ? 'preview' : 'card'
      }
    })
    .run();
}

export interface RichUploadHandlerOptions {
  uploadFn: RichUploadFn;
  onProgress?: (event: RichUploadProgressEvent) => void;
  onError?: (file: File, error: unknown) => void;
}

function fallbackFilename(file: File): string {
  if (file.name) return file.name;
  // Paste-image blobs frequently carry no `File.name` at all — synthesize
  // something readable (and non-UUID-shaped: `resolveRichUploadTitle` on
  // the server falls back safely regardless, but a real name displays
  // better as link text for the non-image path).
  const subtype = file.type.split('/')[1]?.split('+')[0];
  return subtype ? `pasted-image.${subtype}` : 'pasted-file';
}

/**
 * Sequential upload + insert for one drop/paste event's file list. Files
 * are processed one at a time (not in parallel) so each successful
 * insertion's end position becomes the next file's insert position, keeping
 * a multi-file drop in the order the OS handed the files over instead of
 * racing.
 */
export async function handleRichUploadFiles(
  editor: Editor,
  files: readonly File[],
  pos: number,
  options: RichUploadHandlerOptions
): Promise<void> {
  let insertAt = pos;

  // `pos` was captured before the upload, so it is mapped through every transaction made meanwhile.
  const trackInsertPosition = ({ transaction }: { transaction: Transaction }): void => {
    insertAt = transaction.mapping.map(insertAt);
  };
  editor.on('transaction', trackInsertPosition);

  try {
    for (const file of files) {
      const uploadId = nextRichUploadId();
      const filename = fallbackFilename(file);
      options.onProgress?.({ id: uploadId, filename, status: 'uploading' });

      try {
        const result = await options.uploadFn(file);
        const inserted = insertRichUploadResult(editor, insertAt, result, filename);
        if (inserted) insertAt = editor.state.selection.to;
        options.onProgress?.({ id: uploadId, filename, status: 'done' });
      } catch (error) {
        options.onProgress?.({
          id: uploadId,
          filename,
          status: 'error',
          message: error instanceof Error ? error.message : 'Upload failed'
        });
        options.onError?.(file, error);
      }
    }
  } finally {
    editor.off('transaction', trackInsertPosition);
  }
}

/**
 * Which clipboard flavor a paste carrying files should use. Spreadsheets and word processors add a
 * picture of the selection beside the HTML.
 *
 * - `consume-html`: the HTML is meaningful (text, a structure, or images that map to nodes); files
 *   are ignored.
 * - `upload-files`: no HTML, or only a wrapper around foreign images; files are uploaded and the
 *   HTML is suppressed.
 */
export function richClipboardPasteDisposition(html: string): 'consume-html' | 'upload-files' {
  const trimmed = html.trim();
  if (!trimmed) return 'upload-files';
  const body = new DOMParser().parseFromString(trimmed, 'text/html').body;
  if (!body) return 'upload-files';
  // Office clipboard HTML routinely carries <style>/<script>/comment cruft
  // whose text must not count as "content".
  for (const element of body.querySelectorAll('style, script, title, meta')) element.remove();
  if ((body.textContent ?? '').trim().length > 0) return 'consume-html';
  if (body.querySelector('table, ul, ol, pre, blockquote, aside, figure')) return 'consume-html';
  const images = Array.from(body.querySelectorAll('img'));
  if (
    images.length > 0 &&
    images.every(
      (image) =>
        richCustomEmojiNameFromSrc(image.getAttribute('src')) !== null ||
        image.getAttribute('data-rich-custom-emoji') !== null ||
        image.getAttribute('data-resource-id') !== null
    )
  ) {
    return 'consume-html';
  }
  return 'upload-files';
}

/**
 * The paste half of uploads. The file handler's `onPaste` would upload files while ProseMirror also
 * inserts the HTML; here exactly one wins.
 */
function createRichPasteFilesPlugin(editor: Editor, options: RichUploadHandlerOptions) {
  return new Plugin({
    key: new PluginKey('richPasteFiles'),
    props: {
      handlePaste(_view, event) {
        const clipboard = event.clipboardData;
        if (!clipboard?.files?.length) return false;
        const html = clipboard.getData('text/html');
        if (richClipboardPasteDisposition(html) === 'consume-html') return false;
        event.preventDefault();
        event.stopPropagation();
        void handleRichUploadFiles(
          editor,
          Array.from(clipboard.files),
          editor.state.selection.from,
          options
        );
        return true;
      }
    }
  });
}

/**
 * The Tiptap extension — desktop file drop AND paste-image both route
 * through this. Drop keeps `FileHandler` (its position resolution and
 * ProseMirror-internal-drag guard are exactly right); paste is the
 * flavor-arbitrating plugin above (see its doc comment for why FileHandler's
 * own `onPaste` couldn't stay).
 */
export function createRichUploadExtension(options: RichUploadHandlerOptions) {
  return Extension.create({
    name: 'richUpload',
    addExtensions() {
      return [
        FileHandler.configure({
          onDrop: (editor, files, pos) => {
            void handleRichUploadFiles(editor, files, pos, options);
          }
        })
      ];
    },
    addProseMirrorPlugins() {
      return [createRichPasteFilesPlugin(this.editor, options)];
    }
  });
}
