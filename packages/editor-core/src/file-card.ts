/**
 * Presentation helpers for file cards, shared by the live editor and the renderer. Pure strings;
 * safe anywhere.
 */

import { resourceKindLabel, type EditorResolver } from './resolver.ts';

/**
 * Uppercase extension chip label derived from a filename-shaped title
 * ("invoice.pdf" → "PDF"). Falls back to the generic "FILE" when the title
 * carries no usable extension (no dot, empty stem, or an implausibly long
 * trailing segment that is clearly not an extension).
 */
export function richFileExtensionLabel(title: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(title.trim());
  return match ? match[1].toUpperCase() : 'FILE';
}

/**
 * Save-as hint for a file card's Download link, or `null` when it must not carry one. A hint
 * without an extension makes the browser append one from the MIME type; without the attribute, the
 * server's Content-Disposition filename is used.
 */
export function richFileDownloadName(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  return /\.[a-z0-9]{1,8}$/i.test(trimmed) ? trimmed : null;
}

/** Human-readable byte size ("247.3 KB"), or null when the size is unknown. */
export function formatRichFileSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'] as const;
  let value = bytes;
  let unit: (typeof units)[number] = units[0];
  for (const candidate of units) {
    value /= 1024;
    unit = candidate;
    if (value < 1024) break;
  }
  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${unit}`;
}

/**
 * Type label for an inline `resourceChip`: the host's kind label, a file's extension, or the kind
 * in upper case. Shared by the live editor and the renderer.
 */
export function richResourceChipKindLabel(
  kind: string,
  title: string,
  resolver?: EditorResolver
): string {
  const label = resourceKindLabel(kind, resolver);
  if (label) return label;
  if (kind === 'file') return richFileExtensionLabel(title);
  return kind ? kind.toUpperCase() : 'REF';
}

/**
 * Renames a file card while keeping its original extension, which drives the label, download name
 * and previews. A blank edit returns the previous title.
 */
export function richFileTitleWithPreservedExtension(
  previousTitle: string,
  nextTitle: string
): string {
  const trimmed = nextTitle.trim();
  if (!trimmed) return previousTitle;
  const match = /\.[a-z0-9]{1,8}$/i.exec(previousTitle.trim());
  if (!match) return trimmed;
  const extension = match[0];
  return trimmed.toLowerCase().endsWith(extension.toLowerCase())
    ? trimmed
    : `${trimmed}${extension}`;
}
