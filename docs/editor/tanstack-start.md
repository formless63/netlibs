# TanStack Start integration

Runnable: [`examples/editor-tanstack-start`](../../examples/editor-tanstack-start). `bun run build`, then
`bun --cwd examples/editor-tanstack-start dev`.

| File | Shows |
| --- | --- |
| `src/resolver.ts` | One resolver shared by server render and editor. It imports only `/model`. |
| `src/server/documents.ts` | `createDocumentService` with a store (swap `MemoryDocumentStore` for yours) |
| `src/documents.functions.ts` | Server functions; the service is imported inside handlers so it stays server-side |
| `src/routes/docs.$documentId.index.tsx` | Public page: `RenderDocument` in a normal SSR route, no editor code |
| `src/routes/docs.$documentId.edit.tsx` | Editor: `lazy` + `ClientOnly`, `useBlocker` wired to `onUnsavedChange` |

Points that matter:

1. **Keep the editor out of public routes.** Import `RichTextEditor` with `lazy()` only in edit routes.
2. **Send documents as JSON text** through server functions. The content tree is open-ended, and the
   service validates it on arrival anyway.
3. **Return conflicts as data.** Error classes do not survive the server-function boundary; rethrow in the
   browser with `code: 'VERSION_CONFLICT'`.
4. **Authorize in every handler** and take `actorId` from the session. The example has no auth.
5. **Leave `enableBeforeUnload` off** in `useBlocker`: the editor already warns on tab close.
6. Load `katex/dist/katex.min.css` where documents may contain math.
