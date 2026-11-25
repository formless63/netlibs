# Integration

## Installing

The packages are not on npm yet. Build tarballs and install all the
ones you need, with overrides so that their dependencies on each other resolve:

```sh
bun run build && bun run pack:all   # artifacts/*.tgz
```

```json
{
  "dependencies": {
    "@formless63/viewer-core": "file:./vendor/formless63-viewer-core-0.1.0.tgz",
    "@formless63/viewer-pdf": "file:./vendor/formless63-viewer-pdf-0.1.0.tgz"
  },
  "overrides": {
    "@formless63/viewer-core": "file:./vendor/formless63-viewer-core-0.1.0.tgz"
  }
}
```

Exactly one copy of `@formless63/viewer-core` must be installed: the provider is a
React context, and two copies are two contexts. Alternatively add this
repository as a Git submodule and list `packages/*` in your workspaces.

## Sources

```ts
type ViewerInput = string | URL | Blob | ArrayBuffer | ArrayBufferView;
```

- A string is always a URL. Wrap text in a `Blob`.
- In-memory sources are compared by identity. Keep them in state or `useMemo`.
- Buffers are copied before an engine sees them, because some engines detach
  what they are given.
- `name`, `contentType` and `sizeBytes` fill in what the source cannot say.
  Names are inferred from `File` and from URL paths with an extension.

A viewer is chosen by specific MIME type, then extension, then generic MIME type
(`text/plain`, `application/json`, …), then, for unnamed in-memory sources,
leading bytes. Force one with `viewerKey`.

## Adapters

```ts
interface ViewerAdapter {
  fetch?(url, init): Promise<Response>;
  resolveUrl?(url): string | Promise<string>;
  getOpenHref?(url, file): string | null;
  getDownloadHref?(url, file): string | null;
  onError?(error, file): void;
  maxBytes?: number;
}
```

Supplying `fetch` makes every viewer read URLs through it, including engines that
only take a URL (native PDF, model-viewer), which then get a `blob:` URL. The
cost is no streaming or range requests. Without `fetch`, engines get the real URL
and `resolveUrl` still applies, which suits signed URLs and cookie sessions.

Because a plain link cannot carry your credentials, an adapter with `fetch` and
no `getDownloadHref` downloads through itself, and hides Open. Keep the adapter
object stable: a new one reloads mounted viewers.

## Components

`FileViewer` is the usual entry: it resolves, defers until visible, guards large
files, contains errors and shapes its box to the artwork.

| Prop                                         | Default           |                                                       |
| -------------------------------------------- | ----------------- | ----------------------------------------------------- |
| `source`, `name`, `contentType`, `sizeBytes` |                   | The file                                              |
| `viewerKey`                                  | resolved          | Force a viewer                                        |
| `sizeGuardBytes`                             | 50 MB             | `null` disables                                       |
| `lazyLoad`                                   | `true`            | Wait until near the viewport                          |
| `aspectRatio`                                | automatic         | CSS ratio, or `fill` for the parent's height          |
| `header`                                     | `false`           | Name, size, open, download, full screen               |
| `controls`                                   | `true`            | The viewer's own controls                             |
| `fallback`                                   | a note with links | For unsupported files                                 |
| `onStatusChange`                             |                   | `(status, error?)` with `loading`, `ready` or `error` |

`ready` means the engine finished, not that the bytes arrived, wherever the
engine can say so.

Use a viewer directly for its own props. Give it a height through `style` or a
parent.

| Component           | Extra props                                           |
| ------------------- | ----------------------------------------------------- |
| `PdfViewer`         | `mode`: `auto`, `native`, `canvas`                    |
| `MeshViewer`        | `colorVariable`, `lineColorVariable`, `companions`    |
| `GltfViewer`        | `ar`, `autoRotate`                                    |
| `KicadViewer`       | `companions`, `theme`                                 |
| `GerberViewer`      | `color`, `background`                                 |
| `GerberBoardViewer` | `files`                                               |
| `LbxViewer`         | `fonts`, `fallbackColors`, `stockSelector`, `onLabel` |
| `HtmlViewer`        | `fallbackImage`, `remoteContent`                      |
| `TextViewer`        | `maxCharacters`, `wrap`                               |
| `MarkdownViewer`    | `codeRenderers`, `transformUrl`                       |

Importing a component from a package root makes it part of that chunk. The
engines stay lazy either way; to keep the component lazy as well, go through
`FileViewer` or the package's `/definitions`.

## Your own viewer

```ts
const registry = createDefaultRegistry([
  {
    key: 'dxf',
    label: 'DXF drawing',
    extensions: ['dxf'],
    contentTypes: ['image/vnd.dxf'],
    load: () => import('./dxf-viewer'),
  },
]);
```

Inside, `useResolvedSource(props)` and `useViewerLoad(source, load)` give you
bytes, aborts, retry, disposal and status reporting; `ViewerRoot`, `ViewerLoading`,
`ViewerFailure` and `PanZoom` give you the shared presentation.

## TanStack Start

Nothing special is needed: `examples/viewer-playground` is a Start app. Components render a
loading state on the server and touch browser APIs only in effects. Definitions
and `registry.resolve` are safe in loaders and server functions. Link the
stylesheet from the root route:

```tsx
import viewerStyles from '@formless63/viewers/styles.css?url';
```

With other bundlers, the pdf.js worker is created with
`new Worker(new URL('./pdf-worker.js', import.meta.url), { type: 'module' })`.
If yours does not understand that, use `configurePdf({ workerSrc })` or
`createWorker`.

## Engine configuration

```ts
configurePdf({ assetBaseUrl: '/pdfjs/' }); // after: bunx viewer-pdf-assets public/pdfjs
configureGltf({ dracoDecoderLocation: '/draco/' });
configureKicad({ loadEngine: () => import('./newer-kicanvas.js') });
```

Call these once, before the first file of that kind renders.

## Theming

Chrome uses `--fv-*` variables, which fall back to shadcn tokens
(`--background`, `--foreground`, `--muted`, `--primary`, …) and then to neutral
values that follow `color-scheme`. The tokens must hold complete colours;
bare HSL channels (`0 0% 100%`) from older shadcn themes do not work, so set the
`--fv-*` variables instead. Text can be replaced through the provider's
`messages`.

## Security

Files are treated as hostile. Still, the host must serve them safely: anyone can
open a file URL directly, outside any viewer. Send `X-Content-Type-Options:
nosniff`, do not trust the uploader's declared type, and serve HTML, SVG and XML
as attachments or under a `Content-Security-Policy: sandbox`.

- HTML renders in an iframe with an empty `sandbox` and, by default, a policy
  that blocks remote content.
- SVG renders through `<img>`, so it cannot run script.
- Markdown shows raw HTML as text and filters link schemes. Mermaid runs with
  `securityLevel: 'strict'`.
- Open and Download links refuse `javascript:`, `data:` and unknown schemes.
- LBX archives are refused when implausibly large, and only hex colours and
  host-supplied font stacks reach CSS.
- No viewer makes a third-party request with default settings except
  model-viewer's decoder downloads (see [formats](formats.md)).
