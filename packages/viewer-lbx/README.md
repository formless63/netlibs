# @formless63/viewer-lbx

`LbxViewer` for Brother P-touch `.lbx` labels, with a preview of real TZe tape stocks.

Labels look right only with their own fonts. Load the faces in your app, then describe them:

```tsx
const fonts = {
  'My Label Face': {
    stack: "'My Label Face', sans-serif",
    // from the font's head, hhea and OS/2 tables
    metrics: {
      unitsPerEm: 1024,
      ascender: 896,
      descender: -128,
      lineGap: 0,
      capHeight: 896,
      inkTop: 896,
      inkBottom: 0,
    },
  },
};
<LbxViewer fonts={fonts} source={file} />;
```

[Formats and limits](https://github.com/formless63/netlibs/blob/main/docs/viewers/formats.md) ·
[Integration](https://github.com/formless63/netlibs/blob/main/docs/viewers/integration.md)
