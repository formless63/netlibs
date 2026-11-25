/**
 * Re-exporting one type from each extension package carries its `Commands`
 * and `Storage` augmentations to consumers, so `editor.chain().toggleBold()`
 * is typed without depending on every extension directly.
 */
export type { StarterKitOptions } from '@tiptap/starter-kit';
export type { DetailsOptions } from '@tiptap/extension-details';
export type { InlineMathOptions, BlockMathOptions } from '@tiptap/extension-mathematics';
export type { InvisibleCharactersOptions } from '@tiptap/extension-invisible-characters';
