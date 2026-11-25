# @formless63/editor-core

A rich-text document model built on Tiptap JSON: schema, validation, Markdown, programmatic edits and versioned
storage. No React.

```ts
import { applyDocumentOperations, importMarkdown, serializeMarkdown, validateEditorDocument } from '@formless63/editor-core';

const { document, findings, canCommit } = importMarkdown('# Plan\n\n- [ ] First step');
const next = applyDocumentOperations(document, [{ op: 'replaceText', find: 'First', replace: 'Next' }]);
validateEditorDocument(next).success; // true
serializeMarkdown(next);
```

Documents hold stable ids, never URLs; a host supplies an `EditorResolver` to turn ids into links.
`@formless63/editor-core/model` is the part that loads no Tiptap or ProseMirror.

See `docs/editor/api.md` in the repository.
