/** Document schema version. `migrate.ts` upgrades older documents. */
export const EDITOR_SCHEMA_VERSION = 1 as const;

export const RICH_RESOURCE_SELECTORS = [
  'live',
  'latest-approved',
  'pinned',
  'imported-copy'
] as const;

export type RichResourceSelector = (typeof RICH_RESOURCE_SELECTORS)[number];

/**
 * Custom emojis with no Unicode form: the only names `customEmoji` accepts. Shown as shortcode
 * chips, so no remote images are loaded.
 */
export const RICH_CUSTOM_EMOJI_NAMES = [
  'atom',
  'basecamp',
  'basecampy',
  'bowtie',
  'electron',
  'feelsgood',
  'finnadie',
  'goberserk',
  'godmode',
  'hurtrealbad',
  'neckbeard',
  'octocat',
  'rage1',
  'rage2',
  'rage3',
  'rage4',
  'shipit',
  'suspect',
  'trollface'
] as const;

export type RichCustomEmojiName = (typeof RICH_CUSTOM_EMOJI_NAMES)[number];

export function isRichCustomEmojiName(value: unknown): value is RichCustomEmojiName {
  return (
    typeof value === 'string' && (RICH_CUSTOM_EMOJI_NAMES as readonly string[]).includes(value)
  );
}

/** Recovers a custom emoji name from a `/rich-emoji/<name>.png` image source, or null. */
export function richCustomEmojiNameFromSrc(src: unknown): RichCustomEmojiName | null {
  if (typeof src !== 'string' || src.length === 0) return null;
  let pathname: string;
  try {
    // The base only resolves relative sources; the host is never inspected.
    pathname = new URL(src, 'https://relative.invalid').pathname;
  } catch {
    return null;
  }
  const match = /^\/rich-emoji\/([^/]+)\.png$/.exec(pathname);
  const name = match?.[1];
  return isRichCustomEmojiName(name) ? name : null;
}

export const RICH_CALLOUT_KINDS = ['note', 'tip', 'important', 'warning', 'caution'] as const;

export type RichCalloutKind = (typeof RICH_CALLOUT_KINDS)[number];

/** Callout color override; null uses the kind's color. The kind still sets the icon and label. */
export const RICH_CALLOUT_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple'
] as const;

export type RichCalloutColor = (typeof RICH_CALLOUT_COLORS)[number];

/** Bounds for the optional table `colwidth` / image `width` integer attrs (px). */
export const RICH_TABLE_COLWIDTH_MIN = 30;
export const RICH_TABLE_COLWIDTH_MAX = 2000;
export const RICH_IMAGE_WIDTH_MIN = 16;
export const RICH_IMAGE_WIDTH_MAX = 4096;

/** Bounds for a preview card's `height` in px; null derives it from the viewer's aspect ratio. */
export const RICH_PREVIEW_HEIGHT_MIN = 80;
export const RICH_PREVIEW_HEIGHT_MAX = 2000;

/** Aspect presets for preview cards. Each writes `width` and `height`; `heightPerWidth` is h/w. */
export const RICH_PREVIEW_ASPECT_PRESETS = [
  { id: 'portrait', label: 'Portrait', heightPerWidth: 11 / 8.5 },
  { id: 'landscape', label: 'Landscape', heightPerWidth: 8.5 / 11 },
  { id: 'square', label: 'Square', heightPerWidth: 1 }
] as const;

export type RichPreviewAspectPreset = (typeof RICH_PREVIEW_ASPECT_PRESETS)[number];

/**
 * Resolve one aspect preset against the card's current effective width into
 * the `{ width, height }` attr pair the popover commits. `baseWidth` is the
 * node's persisted width when set, else the caller's rendered-frame width
 * (falling back to the ~720px prose column). Both values clamp into their
 * canonical bounds so the result always validates.
 */
export function richPreviewAspectPresetDimensions(
  preset: RichPreviewAspectPreset,
  baseWidth: number | null | undefined
): { width: number; height: number } {
  const width = Math.min(
    RICH_IMAGE_WIDTH_MAX,
    Math.max(
      RICH_IMAGE_WIDTH_MIN,
      Math.round(typeof baseWidth === 'number' && Number.isFinite(baseWidth) ? baseWidth : 720)
    )
  );
  const height = Math.min(
    RICH_PREVIEW_HEIGHT_MAX,
    Math.max(RICH_PREVIEW_HEIGHT_MIN, Math.round(width * preset.heightPerWidth))
  );
  return { width, height };
}

/** Image alignment. `null` is the default placement. It has no Markdown form. */
export const RICH_IMAGE_ALIGNMENTS = ['left', 'center', 'right'] as const;

export type RichImageAlignment = (typeof RICH_IMAGE_ALIGNMENTS)[number];

/**
 * Preset image widths in px, writing the same `width` as drag-resize. `null` is the original size.
 */
export const RICH_IMAGE_SIZE_PRESETS = [
  { id: 'small', label: 'S', width: 240 },
  { id: 'medium', label: 'M', width: 480 },
  { id: 'large', label: 'L', width: 720 },
  { id: 'original', label: 'Original', width: null }
] as const;

export type RichImageSizePreset = (typeof RICH_IMAGE_SIZE_PRESETS)[number];

/**
 * `resourceCard` presentation. `card` is the default; `preview` shows an inline viewer for a file
 * that has one.
 *
 * `width` and `align` use the image bounds and values. `caption` is shown under the preview and is
 * separate from `description`, which describes the resource. None of these has a Markdown form.
 */
export const RICH_RESOURCE_CARD_PRESENTATIONS = ['card', 'preview'] as const;

export type RichResourceCardPresentation = (typeof RICH_RESOURCE_CARD_PRESENTATIONS)[number];

export interface EditorMark {
  type: 'bold' | 'italic' | 'strike' | 'code' | 'link' | 'comment' | 'superscript' | 'subscript';
  attrs?: Record<string, unknown>;
}

export interface EditorNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: EditorNode[];
  marks?: EditorMark[];
  text?: string;
}

export interface EditorDocument extends EditorNode {
  type: 'doc';
  content?: EditorNode[];
}

export type RichImportSeverity = 'warning' | 'error';

export interface RichImportFinding {
  code:
    | 'invalid_canonical_document'
    | 'invalid_canonical_callout_kind'
    | 'malformed_outline_callout'
    | 'nested_outline_callout'
    | 'unsupported_callout_kind'
    | 'unsupported_editor_node'
    | 'unsupported_mark'
    | 'unsafe_url_scheme_removed'
    | 'unsafe_html_attribute_removed'
    | 'unsafe_html_element_removed'
    | 'unresolved_image_resource'
    | 'uuid_display_title'
    | 'unsupported_table_alignment'
    | 'reference_metadata_loss'
    | 'duplicate_block_id'
    | 'invalid_callout_color'
    | 'invalid_table_colwidth'
    | 'invalid_image_width'
    | 'invalid_image_alignment'
    | 'invalid_custom_emoji_name'
    | 'invalid_math_expression'
    | 'invalid_comment_id'
    | 'invalid_resource_card_presentation'
    | 'invalid_preview_height';
  severity: RichImportSeverity;
  message: string;
  path?: string;
  context?: Record<string, string | number | boolean | null>;
}

export interface RichImportResult {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  document: EditorDocument;
  findings: RichImportFinding[];
  canCommit: boolean;
}

export type EditorSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'conflict' | 'error';

/**
 * One direct child for the `/tree` index. Dates are ISO strings. Resolved once, when the editor
 * mounts.
 */
export interface RichChildrenIndexNodeRow {
  id: string;
  documentType: string;
  title: string;
  href: string;
  updatedAt: string;
  /** ISO string, like `updatedAt`. */
  publishedAt: string;
  childCount: number;
}

/**
 * Two-level optimistic concurrency.
 * `expectedRevisionId` is the rarer level-2 (mint/restore) guard;
 * `expectedWorkingVersion` is the fast, frequent level-1 (working-copy)
 * guard every autosave/flush actually races against.
 */
export interface EditorSaveRequest {
  content: EditorDocument;
  expectedRevisionId: string;
  expectedWorkingVersion: number;
}

export type EditorSaveResult =
  | {
      status: 'saved';
      workingVersion: number;
      /** Present only when this save happened to coincide with a session-cut mint. */
      revisionId?: string;
    }
  | {
      status: 'conflict';
      level: 'working_copy';
      workingVersion: number;
      content: EditorDocument;
    }
  | { status: 'conflict'; level: 'revision'; currentRevisionId: string }
  | { status: 'error'; message: string };
