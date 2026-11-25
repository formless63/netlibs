import { containsControlCharacter } from './stable-link.ts';

export type RichViewerKind = 'image' | 'pdf' | 'audio' | 'video' | 'stl';

const IMAGE_EXTENSIONS = new Set(['avif', 'gif', 'jpeg', 'jpg', 'png', 'webp']);
const AUDIO_EXTENSIONS = new Set(['aac', 'flac', 'm4a', 'mp3', 'ogg', 'wav']);
const VIDEO_EXTENSIONS = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm']);

function fileExtension(filename: string): string {
  const cleanFilename = filename.split(/[?#]/, 1)[0] ?? '';
  const extension = cleanFilename.includes('.') ? cleanFilename.split('.').pop() : null;
  return extension?.toLowerCase() ?? '';
}

export function richViewerKindForFilename(filename: string): RichViewerKind | null {
  const extension = fileExtension(filename);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (extension === 'stl') return 'stl';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

export function richViewerKindForContentType(contentType: string): RichViewerKind | null {
  const normalized = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (
    normalized === 'image/png' ||
    normalized === 'image/jpeg' ||
    normalized === 'image/gif' ||
    normalized === 'image/webp' ||
    normalized === 'image/avif'
  ) {
    return 'image';
  }
  if (normalized === 'application/pdf') return 'pdf';
  if (normalized === 'model/stl' || normalized === 'application/sla') {
    return 'stl';
  }
  if (normalized.startsWith('audio/')) return 'audio';
  if (normalized.startsWith('video/')) return 'video';
  return null;
}

/**
 * Whether a resolver-provided media URL may be loaded by a viewer: a
 * root-relative path, an absolute http(s) URL, or an in-page blob.
 */
export function isSafeMediaUrl(value: string): boolean {
  if (value.length === 0 || containsControlCharacter(value) || value.includes('\\')) return false;
  if (value.startsWith('/')) return !value.startsWith('//');
  try {
    return ['http:', 'https:', 'blob:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
