import { bareContentType } from './delivery.ts';

/**
 * Declared types that describe the same format as a detected one. Browsers
 * declare from the file extension and the OS, so these are honest spellings, not
 * disguises. Extending a row is safe; it never accepts a different format.
 */
export const SAME_FORMAT_TYPES: Readonly<Record<string, readonly string[]>> = {
  'model/gltf-binary': ['model/gltf+json', 'model/gltf.binary', 'application/octet-stream'],
  'model/stl': [
    'application/sla',
    'application/vnd.ms-pki.stl',
    'application/x-navistyle',
    'model/x.stl-ascii',
    'model/x.stl-binary',
    'application/octet-stream',
  ],
  'application/zip': [
    'application/octet-stream',
    'application/x-zip-compressed',
    'application/x-zip',
    'multipart/x-zip',
  ],
};

export interface UploadTypeInput {
  /** From the bytes, e.g. `fileTypeFromBuffer` of `file-type`. Null when unrecognised. */
  detected: string | null | undefined;
  /** What the client said. */
  declared: string | null | undefined;
  filename: string;
  sameFormat?: Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * Extensions of formats that are ZIP files inside but not archives, such as
   * `lbx`. Stored as `application/zip`, Chromium would rename the download to
   * `.zip`; stored as octet-stream it keeps its name.
   */
  opaqueZipExtensions?: readonly string[] | undefined;
}

export type UploadType =
  | { ok: true; contentType: string }
  /** The bytes are a different format from the one declared. */
  | { ok: false; detected: string; declared: string };

/**
 * Decide the type to store for an upload.
 *
 * Detected bytes beat the declaration, and a real conflict is refused. Bytes
 * with no signature (text, CSV, SVG) keep the declared type, which is why
 * delivery must not trust it: see `fileDelivery`.
 */
export function uploadType(input: UploadTypeInput): UploadType {
  const detected = bareContentType(input.detected);
  const declared = bareContentType(input.declared);
  const sameFormat = input.sameFormat ?? SAME_FORMAT_TYPES;
  if (
    detected !== null &&
    declared !== null &&
    detected !== declared &&
    !(Object.hasOwn(sameFormat, detected) && sameFormat[detected]!.includes(declared))
  ) {
    return { ok: false, detected, declared };
  }
  const contentType = detected ?? declared ?? 'application/octet-stream';
  const extension = /\.([^./\\]+)$/.exec(input.filename.trim())?.[1]?.toLowerCase();
  const zip =
    contentType === 'application/zip' ||
    (Object.hasOwn(sameFormat, 'application/zip') &&
      contentType !== 'application/octet-stream' &&
      sameFormat['application/zip']!.includes(contentType));
  if (zip && extension !== undefined && input.opaqueZipExtensions?.includes(extension)) {
    return { ok: true, contentType: 'application/octet-stream' };
  }
  return { ok: true, contentType };
}
