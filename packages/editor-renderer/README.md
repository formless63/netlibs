# @formless63/editor-renderer

Renders rich-text documents read-only, with no editor code, hooks or client JavaScript.

```tsx
import { RenderDocument } from '@formless63/editor-renderer';
import '@formless63/editor-renderer/styles.css';

<RenderDocument document={doc} resolver={resolver} />
```

`renderDocumentToHtml` in `@formless63/editor-renderer/html` returns a string. Unvalidated content is safe to
render: URLs are checked on output and unknown nodes degrade to their children.

See `docs/editor/api.md` in the repository.
