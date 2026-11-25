# Limitations, deferred work and dependencies

## Limitations

- **Closed schema.** Hosts can add view-only extensions and replace rendering per node, but cannot add
  node or mark types: the validator is a closed list by design. New embeds should use `resourceCard` with a
  host `kind` and a `components` override. A registration API is deferred until a second real need exists.
- **Markdown.** Empty paragraphs, block ids, details open state, header-less tables, and anything reported by
  `detectRichMarkdownFidelityFlags` do not survive. Bare URLs become links. Reference links, footnotes, raw
  HTML, GFM column alignment, foreign images and nested `:::` containers are refused with a finding; a toggle
  inside a colored callout therefore cannot be saved from source mode. Programs should prefer operations over
  whole-document Markdown.
- **Tables** have no merged cells or cell alignment.
- **PDF and STL** previews are client-side only; the renderer emits a file card unless overridden.
- **Uploads** are sequential with no cancellation. Pasted remote images are not fetched.
- **Comments** are anchors only; threads belong to the host.
- **Trailing paragraph.** Tiptap adds an empty final paragraph after some blocks on first interaction, which
  can count as an edit.
- **Bundle size.** The editor is a large client chunk (CodeMirror, KaTeX and Markdown included). Load it lazily.

## Deferred

Realtime collaboration, revision diffing, image upload from URL, lazy-loading CodeMirror, translation of UI
strings, document hierarchy, and registry publishing.

Tests cover jsdom and Node. There is no browser test suite.

## Dependencies

Exact-pinned to the latest stable releases, except:

- **katex 0.18.11**, not 0.19.x: `@tiptap/extension-mathematics` 3.35.0 allows up to 0.18.
- **nitro 3.0.261103-rc**, example only: Nitro 3 has no stable release.
- **TypeScript 7.0.2** stable is used. The `radix-ui`, Vite, Mermaid and TypeScript prereleases offered
  nothing needed here and were not used.

Keep all `@tiptap/*` on one version and one copy of ProseMirror; two copies break decorations at run time.
Optional peers: `mermaid`, `pdfjs-dist`.
