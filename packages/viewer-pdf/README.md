# @formless63/viewer-pdf

`PdfViewer`: the browser's PDF viewer, or pdf.js where there is none.

For PDFs without embedded fonts, with CJK text, or with JBIG2/JPEG2000 images, copy the pdf.js assets and point at them:

```sh
bunx viewer-pdf-assets public/pdfjs
```

```ts
configurePdf({ assetBaseUrl: '/pdfjs/' });
```

[Formats and limits](https://github.com/formless63/netlibs/blob/main/docs/viewers/formats.md) ·
[Integration](https://github.com/formless63/netlibs/blob/main/docs/viewers/integration.md)
