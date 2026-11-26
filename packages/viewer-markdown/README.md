# @formless63/viewer-markdown

`MarkdownViewer` and `Markdown`. Import `@formless63/viewer-markdown/styles.css` after the core styles.

Mermaid is opt-in and needs the `mermaid` peer:

```tsx
import { MermaidDiagram } from '@formless63/viewer-markdown/mermaid';

const codeRenderers = { mermaid: MermaidDiagram };
<MarkdownViewer codeRenderers={codeRenderers} source={file} />;
```

[Formats and limits](https://github.com/formless63/netlibs/blob/main/docs/viewers/formats.md) ·
[Integration](https://github.com/formless63/netlibs/blob/main/docs/viewers/integration.md)
