# API

## Documents

A document is Tiptap JSON: `{ type: 'doc', content: [...] }`. It stores stable ids, never URLs:
`rich-doc:<id>#<anchor>`, `rich-resource:<id>`, `rich-task:<id>`.

```ts
import { openDocument, validateEditorDocument, createVersionedDocument } from '@formless63/editor-core';

const doc = openDocument(stored);            // bare doc or versioned envelope; upgrades old schemas
const { success, findings } = validateEditorDocument(doc);
const envelope = createVersionedDocument(doc); // { format, schemaVersion, document }
```

Documents from an application that used other scheme names can be converted first, and back:

```ts
const doc = openDocument(rewriteReferenceSchemes(stored, { 'old-doc:': 'rich-doc:' }));
```

`openDocument` throws `UnsupportedSchemaVersionError` for content newer than this build.
`prepareContent(unknown)` does everything a write needs: size bounds, upgrade, grammar check.

## Host adapter: `EditorResolver`

The one seam between stored ids and your application. Synchronous: preload with
`collectDocumentReferences(doc)` (`resourceIds`, `documentIds`, `taskIds`, `hasChildrenIndex`).

```ts
const resolver: EditorResolver = {
  documentHref: ({ documentId, anchor }) => `/docs/${documentId}${anchor ? `#${anchor}` : ''}`,
  parseDocumentHref: (href) => /* inverse, so pasted app URLs become stable links */ null,
  resourceHref: (id, purpose /* content | download | preview */) => urls.get(id) ?? null,
  taskHref: (id) => `/tasks/${id}`,
  resourceKindLabel: (kind) => null
};
```

Return `null` for anything the viewer may not see. The renderer then shows text or alt text, never a
broken link. Authorization belongs in the code that fills the resolver and serves the media.

## Rendering

```tsx
import { RenderDocument, getTableOfContents } from '@formless63/editor-renderer';
import { renderDocumentToHtml } from '@formless63/editor-renderer/html';
import '@formless63/editor-renderer/styles.css';
import 'katex/dist/katex.min.css'; // only if documents use math

<RenderDocument document={doc} resolver={resolver} headingOffset={1} />
```

Props: `childrenIndexRows`, `resourceSizes`, `autoHeadingIds`, `blockAnchors`, `externalLinkRel`,
`className`, and `components`, which replaces node types:

```tsx
<RenderDocument components={{ resourceCard: MyPdfCard, codeBlock: MyMermaidOrCode }} ... />
```

It accepts unvalidated content: every URL is checked on output, unknown nodes degrade to their children,
and comment anchors are never emitted.

## Editing

```tsx
import { RichTextEditor } from '@formless63/editor-react';
import '@formless63/editor-react/styles.css'; // includes the renderer's styles

<RichTextEditor
  documentId={id}
  initialContent={content}
  version={version}
  resolver={resolver}
  onSave={({ content, expectedVersion }) => api.save(...)} // resolves { version }
  onUpload={(file) => api.upload(file)}                    // resolves { id, name, mimeType }
/>
```

- **Conflicts:** reject `onSave` with `code: 'VERSION_CONFLICT'` or `status: 409`. Local edits are kept
  and autosave stops.
- **Navigation:** `onUnsavedChange` reports unsaved state to your router; `ref` exposes `save()`,
  `hasUnsavedChanges()`, `getContent()`, `focus()` and `getEditor()`.
- **Optional:** `documents`, `resources`, `tasks` (pickers), `childDocuments`, `onCreateComment`,
  `onOpenDocument`, `onNavigate`, `readOnly`, `extensions` (view-only Tiptap extensions).
- **Viewers:** Mermaid works when `mermaid` is installed. For inline PDFs, call
  `configurePdfPreview({ workerSrc })` once; otherwise PDFs show open/download links.
- **Theme:** every color reads a shadcn-style variable when present (`--primary`, …) and can be overridden
  with `--rich-*`. Dark defaults apply under `.dark` or `[data-theme='dark']`.

The editor never loads content it cannot represent; it shows an error instead of overwriting it.

## Markdown

```ts
const { document, findings, canCommit } = importMarkdown(markdown, { referenceManifest });
const markdown = serializeMarkdown(document);
```

Import never throws. `canCommit: false` means something would be lost or unsafe; `findings` says what.
`detectRichMarkdownFidelityFlags(doc)` lists what Markdown cannot hold before you convert.
`textToDocument` / `documentToText` are a smaller, dependency-free dialect in which every newline is a
line break: convenient for short generated notes.

## Programmatic edits

Plain functions over JSON, for CLIs, jobs and agents.

```ts
import { applyDocumentOperations, ensureBlockIds, listBlocks } from '@formless63/editor-core';

const doc = ensureBlockIds(openDocument(stored));
listBlocks(doc);          // [{ blockId, type, depth, text, attrs }]
getDocumentOutline(doc);  // headings

const next = applyDocumentOperations(doc, [
  { op: 'replaceSection', headingId, markdown: 'New body' },
  { op: 'insert', position: { after: blockId }, markdown: '- [ ] Follow up' },
  { op: 'replaceText', find: 'teh', replace: 'the' }, // fails unless exactly one match
  { op: 'move', blockId, position: { at: 'end' } },
  { op: 'setAttrs', blockId, attrs: { checked: true } },
  { op: 'delete', blockId }
]);
```

All-or-nothing: a `DocumentOperationError` (with `operationIndex`) leaves the input untouched, and the
result is always a valid document.

## Versioned storage

```ts
const service = createDocumentService({ store, contentPolicy });
await service.save({ id, expectedVersion, content, actorId });
await service.applyOperations({ id, expectedVersion, operations, actorId });
await service.restore({ id, revisionId, expectedVersion, actorId });
await service.listRevisions(id, { limit: 20 });
```

Implement `DocumentStore` over your database. `insert` and `update` must write the record and its
revision in one transaction, and `update` must be a compare-and-set:

```sql
update documents set ... , version = $expected + 1 where id = $id and version = $expected
```

Return `false` when no row matched. `MemoryDocumentStore` is the reference implementation.
