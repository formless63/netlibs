# @formless63/editor-react

A rich-text editor component: slash menu, toolbar, Markdown source mode, tables, uploads, autosave with conflict
detection, and PDF, STL and Mermaid viewers.

```tsx
import { RichTextEditor } from '@formless63/editor-react';
import '@formless63/editor-react/styles.css';

<RichTextEditor documentId={id} initialContent={content} version={version} onSave={save} resolver={resolver} />
```

Browser only: load it lazily. `mermaid` and `pdfjs-dist` are optional peers. Tailwind is not required.

See the [API guide](https://github.com/formless63/netlibs/blob/main/docs/editor/api.md) and [limitations](https://github.com/formless63/netlibs/blob/main/docs/editor/limitations.md).
