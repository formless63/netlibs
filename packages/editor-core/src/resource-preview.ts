/**
 * Which cards have a preview, with which viewer and source. Shared by the live editor and the
 * renderer. Only files whose name matches a viewer are previewable.
 */

import { richViewerKindForFilename, type RichViewerKind } from './viewer-kind.ts';

/** The viewer key a resourceCard of `kind` previews with, or null when the kind/title has no preview. */
export function richResourceCardViewerKey(
  kind: string,
  title: string
): RichViewerKind | null {
  if (kind === 'file') return richViewerKindForFilename(title);
  return null;
}

/**
 * Picker-inserted references stay cards. Fresh file drops opt into previews
 * in `upload-drop.ts` only when a safe viewer exists.
 */
export function richResourceCardDefaultPresentation(_kind: string): 'card' {
  return 'card';
}
