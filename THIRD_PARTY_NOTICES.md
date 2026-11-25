# Third-party notices

These apply to the `editor-*` and `viewer-*` packages.

## Vendored code

### tiptap-search-and-replace (MIT)

`packages/editor-react/src/vendor/search-and-replace.ts` is vendored, with changes noted in the file, from
`@memfoldai/tiptap-search-and-replace` 0.2.0 (https://github.com/memfoldai/tiptap-search-and-replace).

```
MIT License

Copyright (c) 2023 Jeet Mandaliya (Github Username: sereneinserenade)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Lucide `external-link` icon path (ISC)

Path data in `packages/editor-core/src/open-affordance.ts`. Copyright (c) Lucide Icons and Contributors
(https://lucide.dev); portions from Feather (MIT, Copyright (c) 2013-present Cole Bemis).

```
Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee
is hereby granted, provided that the above copyright notice and this permission notice appear in all
copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE
INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE
FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING
OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

### TanStack/Next.js dashboard starter (MIT)

Parts of the editor were first written in an application based on this starter. Included as a precaution.

```
MIT License

Copyright (c) 2023 Kiranism

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### KiCanvas (MIT)

`packages/viewer-ecad/vendor/kicanvas.js`, © 2022 Alethea Katherine Flowers, with the changes listed in
`packages/viewer-ecad/vendor/README.md`. Its licence and the notices of what it includes are in
`packages/viewer-ecad/vendor/LICENSE.md`.

### Material Symbols Outlined (Apache-2.0)

A 17-icon subset, `packages/viewer-ecad/vendor/material-symbols.js`, © Google. Licence:
`packages/viewer-ecad/vendor/LICENSE-material-symbols.txt`.

## Runtime dependencies (not vendored)

| Package | License |
| --- | --- |
| Tiptap (`@tiptap/*`), ProseMirror | MIT |
| CodeMirror, Lezer | MIT |
| radix-ui, @floating-ui/dom | MIT |
| @tabler/icons-react | MIT |
| katex, lowlight, unified, remark-* | MIT |
| highlight.js | BSD-3-Clause |
| mermaid (optional) | MIT |
| pdfjs-dist (optional) | Apache-2.0 |
| react-markdown, remark-gfm, rehype-highlight | MIT |
| online-3d-viewer, three | MIT |
| @google/model-viewer | Apache-2.0 |
| @tracespace/* | MIT |
| bil-lbx, fast-xml-parser | MIT |
| jszip | MIT or GPL-3.0-or-later, used under MIT |

Brother, P-touch and TZe are trademarks of Brother Industries. Names of products and formats are descriptive.
