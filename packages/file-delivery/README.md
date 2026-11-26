# @formless63/file-delivery

Response headers for serving user uploads from your own origin without letting
one of them run script as the viewer.

A stored content type is usually whatever the uploader claimed. Served inline, a
file claiming `text/html` is a page on your site. `nosniff` does not help: the
type is wrong, not sniffed.

```ts
import { fileDelivery } from '@formless63/file-delivery';

const { headers } = fileDelivery({ contentType: stored.type, filename: stored.name });
return new Response(stream, { headers: { ...headers, 'Cache-Control': 'private' } });
```

| Stored type                          | Served as                                                                  |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Image, audio, video, text, JSON, CSV | Inline, sandboxed by a `Content-Security-Policy`                           |
| SVG                                  | The same: works in `<img>`, cannot run script when opened                  |
| PDF                                  | Inline, not sandboxed, because Chromium's viewer refuses to open sandboxed |
| Anything else, or malformed          | `application/octet-stream` download                                        |

Always `nosniff`, and a `Content-Disposition` that is legal for any filename.

**Comma-joined types.** Browsers use the last type in a comma-joined value, so
Chromium renders `application/pdf;x=1, text/html` as HTML, `nosniff` or not, while
code splitting on `;` sees a PDF. Such values are refused here. The browser suite
demonstrates the attack and the defence.

## Accepting uploads

```ts
import { fileTypeFromBuffer } from 'file-type';
import { uploadType } from '@formless63/file-delivery';

const type = uploadType({
  detected: (await fileTypeFromBuffer(bytes))?.mime,
  declared: file.type,
  filename: file.name,
  opaqueZipExtensions: ['lbx'], // ZIP inside, but must download under its own name
});
if (!type.ok) return new Response('Contents do not match the declared type', { status: 415 });
```

Detected bytes beat the declaration and real conflicts are refused, with known
alternative spellings (GLB, STL, ZIP) allowed. Text formats have no signature and
keep the declared type, which is why delivery does not trust it.

## Untrusted documents

`untrustedDocumentHeaders()` is for captured pages and stored emails that should
render: no script, no network, no origin. It isolates; it does not sanitise.

## Limits

This is defence in depth. Serving uploads from a separate origin is stronger.
It does not do caching, conditional or range requests, or malware scanning.
Verified in Chromium; Firefox and Safari follow the same standards but are not
tested. `frame-ancestors 'self'` allows embedding by your own pages only.
