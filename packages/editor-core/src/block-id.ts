/**
 * Stable block identity. `blockId` is internal: never rendered or edited, and it survives edits. It
 * is separate from `RichHeading.anchorId`, the human-facing `{#slug}`, so renaming a heading cannot
 * break a reference to the block.
 *
 * `image`, `tableHeader` and `tableCell` are excluded because they are not independent targets.
 */
export const RICH_BLOCK_IDENTITY_NODE_TYPES = [
  'paragraph',
  'heading',
  'blockquote',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'table',
  'tableRow',
  'codeBlock',
  'callout',
  'details',
  'resourceCard',
  'taskReference',
  'childrenIndex',
  'horizontalRule'
] as const;

export type RichBlockIdentityNodeType = (typeof RICH_BLOCK_IDENTITY_NODE_TYPES)[number];

// Crockford base32: excludes I, L, O and U. Ids only need to be unique within one document.
const CROCKFORD_BASE32_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** `b_` + 16 Crockford base32 characters (~96 bits), per spec D2 "Scheme". */
export const RICH_BLOCK_ID_PATTERN = /^b_[0-9A-HJKMNP-TV-Z]{16}$/;

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  // `globalThis.crypto` is the Web Crypto API — available in both the
  // browser (live editor) and modern Node (server-side validation/tests).
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateRichBlockId(): string {
  const bytes = randomBytes(16);
  let suffix = '';
  for (const byte of bytes) {
    suffix += CROCKFORD_BASE32_ALPHABET[byte % CROCKFORD_BASE32_ALPHABET.length];
  }
  return `b_${suffix}`;
}
