# Formats, limits and cost

"Browser" below means the Playwright suite renders a fixture in Chromium with
the real engine, asserts that pixels were painted, and asserts no console errors
and no third-party requests. "Unit" means jsdom or Node. Only Chromium is
automated; Firefox and Safari have not been tested.

## Supported

| Format | Viewer key | Verified | Notes |
| --- | --- | --- | --- |
| PDF, native | `pdf` | Browser (full Chromium, URL, blob and authenticated) | Search, print and zoom are the browser's |
| PDF, pdf.js | `pdf` | Browser, real worker | Lazy pages, page navigation, zoom. No text selection, links or forms |
| STL ASCII and binary | `mesh` | Browser | Coloured from the theme |
| OBJ | `mesh` | Browser, geometry only | `.mtl` and textures via `companions`, which is **not** tested |
| PLY, OFF | `mesh` | Browser, ASCII | Binary variants untested |
| 3MF | `mesh` | Browser, geometry only | Materials and multi-part builds untested |
| GLB, glTF | `gltf` | Browser | glTF with external buffers works only from a direct URL. Draco, KTX2 and meshopt untested |
| `.kicad_pcb`, `.kicad_sch` | `kicad` | Browser, minimal KiCad 7 files, and both together | KiCanvas is alpha software. Large boards and KiCad 8/9 files untested |
| Gerber RS-274X | `gerber` | Unit and browser, one layer | |
| Excellon drill | `gerber` | Unit and browser, metric Gerbers with inch drills | |
| Gerber stack | component only | Unit and browser, six files | Overlay with per-layer visibility, not a photorealistic board |
| Brother `.lbx` | `lbx` | Unit (75 tests), browser | See below |
| PNG, SVG | `image` | Browser | JPEG, GIF, WebP, AVIF and BMP rely on the same `<img>` path |
| Text: txt, log, csv, tsv, json, xml, yaml, toml, ini | `text` | Browser (csv) | Verbatim. No tables, no highlighting |
| HTML | `html` | Browser, hostile fixture | Empty sandbox, remote content off |
| Markdown | `markdown` | Unit and browser | GFM, highlighting, opt-in Mermaid |

## Not supported

Office files (docx, xlsx, pptx), STEP, IGES and other CAD (they need CDN
WASM), DXF/DWG, `.kicad_mod`, `.kicad_pro`, legacy KiCad `.sch`/`.lib`, ZIP
archives of Gerbers, audio and video.

## Limitations worth knowing

**LBX.** Text, rectangles and lines render. Barcodes and images draw as labelled
placeholders. `flip`, hatch patterns (they draw solid), shrink-to-fit and
multi-sheet labels are not modelled. Rounded corners follow the documented Win32
convention but no test label confirms it. Text is faithful only when the host
supplies the label's fonts and metrics. Labels that declare no stock render black on white; set
`fallbackColors` to change that.

**KiCad.** KiCanvas reports no load errors. Failures are inferred from its
reflected attributes, plus checks for the right root element and balanced
parentheses. A well-formed file with nonsense inside can still throw inside
KiCanvas after loading. Its toolbar cannot be restyled.

**Gerber.** tracespace 5 is an alpha last released in 2023. Parsing is synchronous on the
main thread. Layers of a stack are identified by filename.

**PDF.** Without `assetBaseUrl`, pdf.js falls back to system fonts for
non-embedded base-14 fonts, and CJK CMaps, JBIG2/JPEG2000 images and ICC
profiles may not render.

**glTF.** model-viewer downloads the Draco and KTX2 decoders from a Google CDN
the first time a model needs them, unless `configureGltf` points elsewhere.

**3D in general.** Each model holds a WebGL context and browsers allow about 16.
`FileViewer` defers models until they are near the viewport but does not unload
them after. Long galleries should paginate.

**Pan/zoom.** Touch has buttons and drag, but no two-finger pinch. Trackpad pinch
and Ctrl/Cmd + wheel work.

## Cost

Gzipped, from a Vite 8 production build of a page that imports only
`@formless63/viewers`. The entry chunk is 75 KB including React; it contains no
viewer.

| Opening a… | Loads about |
| --- | --- |
| PDF, native | 3 KB |
| PDF, pdf.js | 500 KB (366 KB of it in the worker) |
| mesh | 268 KB |
| GLB or glTF | 295 KB |
| KiCad file | 116 KB |
| Gerber | 37 KB |
| LBX | 57 KB |
| Markdown | 96 KB, plus Mermaid if used |

`@formless63/viewer-model` brings two copies of three.js, because online-3d-viewer
pins its own. Both load only on a page that shows both a mesh and a glTF model,
which also logs three's "multiple instances" warning. It is harmless here.

The size guard waits for a click above 50 MB by default. `adapter.maxBytes` is a
hard ceiling, enforced on the stream even when Content-Length is missing.
