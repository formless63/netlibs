import { importMarkdown, type EditorDocument } from '@formless63/editor-core';

function fromMarkdown(markdown: string, extra: EditorDocument['content'] = []): EditorDocument {
  const result = importMarkdown(markdown);
  if (!result.canCommit) throw new Error(JSON.stringify(result.findings));
  return { type: 'doc', content: [...(result.document.content ?? []), ...extra] };
}

export const SAMPLES: Record<string, { title: string; content: EditorDocument }> = {
  note: {
    title: 'Internal note',
    content: fromMarkdown(`## Weekly check

- [x] Rotate the staging key
- [ ] Review **backup** report
  - [ ] Confirm the restore test

> [!WARNING] Before Friday
> The old host goes away.

A private note with \`inline code\`, ~~old text~~, H~2~O and E = mc^2^.`)
  },
  docs: {
    title: 'Documentation',
    content: fromMarkdown(
      `# Install {#install}

1. Clone the repository.
2. Run the build:

   \`\`\`bash
   bun install && bun run build
   \`\`\`
3. Read [the guide](rich-doc:cms).

| Option | Default |
| --- | --- |
| \`port\` | 3000 |
| \`host\` | all<br>interfaces |

:::details[Why Bun?]

Fast installs, and one tool.

:::

\`\`\`mermaid
flowchart LR
  Editor --> JSON --> Renderer
\`\`\``,
      [{ type: 'childrenIndex' }]
    )
  },
  project: {
    title: 'Project writeup',
    content: fromMarkdown(
      `# Enclosure rev B

Wall thickness follows $t = \\frac{F}{\\sigma}$.

\`\`\`math
\\int_0^1 x^2 \\, dx = \\tfrac{1}{3}
\`\`\``,
      [
        {
          type: 'image',
          attrs: {
            resourceId: 'sample-image',
            alt: 'Rendered enclosure',
            title: 'enclosure.png',
            description: 'Rev B, front view',
            width: 360,
            align: 'center'
          }
        },
        {
          type: 'resourceCard',
          attrs: {
            resourceId: 'sample-file',
            title: 'bill-of-materials.csv',
            description: 'Exported today',
            kind: 'file',
            selector: 'live'
          }
        },
        { type: 'taskReference', attrs: { taskId: 't-1', fallbackTitle: 'Order the prototype' } }
      ]
    )
  },
  cms: {
    title: 'Public CMS page',
    content: fromMarkdown(`# About the studio

We build *useful* tools. Read more at [example.com](https://example.com/).

> [!TIP]
> This page renders on the server without the editor.

:::note[Colored callout]{color=purple}

Palette overrides survive Markdown.

:::`)
  },
  legacy: {
    title: 'Stored before the extraction',
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'An old ' },
            {
              type: 'text',
              text: 'internal link',
              marks: [
                { type: 'link', attrs: { href: 'rich-doc:docs#install', targetDocumentId: 'docs', targetAnchor: 'install' } }
              ]
            },
            { type: 'text', text: ' and ' },
            { type: 'customEmoji', attrs: { name: 'octocat' } }
          ]
        }
      ]
    }
  }
};
