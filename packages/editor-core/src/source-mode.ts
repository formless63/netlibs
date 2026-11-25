import type { RichMarkdownImportOptions } from './importer.ts';
import type { EditorDocument, EditorNode } from './types.ts';

/**
 * Editor modes: views over the same document. Pure pieces only (view preference and Markdown
 * fidelity analysis).
 *
 * - `richtext`: the default, with slash and selection menus.
 * - `richtext-toolbar`: the same, plus a persistent toolbar.
 * - `source`: Markdown. Only this mode needs a serialize/import round trip.
 */

export const EDITOR_VIEW_MODES = ['richtext', 'richtext-toolbar', 'source'] as const;
export type EditorViewMode = (typeof EDITOR_VIEW_MODES)[number];

/** The two rich-text-backed modes — i.e. every mode except `source`. Used to type the "which rich mode to land on after leaving source" parameter. */
export type EditorRichTextViewMode = Exclude<EditorViewMode, 'source'>;

/** localStorage key for the per-user (per-browser) mode preference. */
export const EDITOR_VIEW_MODE_STORAGE_KEY = 'rich.editor.viewMode';

/** Any stored value other than a literal member of `EDITOR_VIEW_MODES` degrades to the default `'richtext'` — never throws on a foreign/corrupt value. */
export function parseEditorViewMode(raw: unknown): EditorViewMode {
  return raw === 'source' || raw === 'richtext-toolbar' ? raw : 'richtext';
}

type ReadableStorage = Pick<Storage, 'getItem'>;
type WritableStorage = Pick<Storage, 'setItem'>;

/**
 * Reads the persisted mode preference. Takes the storage object as a
 * parameter (rather than reaching for `window.localStorage` itself) so this
 * stays a pure function callable from tests and from a server-rendered pass
 * (`storage: null`) alike — the caller decides whether `window` exists.
 * Swallows storage errors (private-mode Safari throws on `getItem` in some
 * configurations) — a preference that can't be read just falls back to the
 * default, never crashes the editor.
 */
export function readStoredEditorViewMode(
  storage: ReadableStorage | null | undefined
): EditorViewMode {
  if (!storage) return 'richtext';
  try {
    return parseEditorViewMode(storage.getItem(EDITOR_VIEW_MODE_STORAGE_KEY));
  } catch {
    return 'richtext';
  }
}

/**
 * Reads the stored preference at mount. A stored `source` becomes `richtext`: source mode may only
 * be entered through `enterSourceMode()`, which seeds its buffer.
 */
export function restoreEditorViewMode(
  storage: ReadableStorage | null | undefined
): EditorRichTextViewMode {
  const stored = readStoredEditorViewMode(storage);
  return stored === 'source' ? 'richtext' : stored;
}

/** Persists the mode preference. Swallows storage errors (full/private storage) — the preference simply doesn't survive this session. */
export function writeStoredEditorViewMode(
  storage: WritableStorage | null | undefined,
  mode: EditorViewMode
): void {
  if (!storage) return;
  try {
    storage.setItem(EDITOR_VIEW_MODE_STORAGE_KEY, mode);
  } catch {
    // Private-mode/full storage — mode preference just doesn't persist this session.
  }
}

/**
 * Counts of the canonical constructs `serializer.ts` cannot express in
 * Markdown (or can only express by discarding structure). See
 * `markdown-source-fidelity.test.ts` for the empirical verification behind
 * each classification below — this is not a guess.
 */
export interface RichMarkdownFidelityFlags {
  /** `comment` marks (schema.ts's `RichCommentMark`) — serializer.ts's `applyMarks` has no `comment` case, so these are silently dropped on export. Round-trip DESTROYS them. */
  commentMarkCount: number;
  /** `tableCell`/`tableHeader` `colwidth` arrays — `serializeTable` emits cell text only, no width metadata at all. Round-trip DESTROYS them. */
  tableColumnWidthCount: number;
  /** Image `align` has no Markdown form and is lost in a round trip. */
  alignedImageCount: number;
  /**
   * Image `width` survives as a ` =WIDTH` title suffix, so it is listed but needs no confirmation.
   */
  resizedImageCount: number;
  /**
   * A card's presentation attrs (`width`, `height`, `align`, `caption`, `presentation`) have no
   * Markdown form and are lost in a round trip.
   */
  previewFileCardCount: number;
  /** Table cells holding more than one paragraph: Markdown cells are a single line, so other blocks are flattened. */
  flattenedTableCellCount: number;
}

function emptyFidelityFlags(): RichMarkdownFidelityFlags {
  return {
    commentMarkCount: 0,
    tableColumnWidthCount: 0,
    alignedImageCount: 0,
    resizedImageCount: 0,
    previewFileCardCount: 0,
    flattenedTableCellCount: 0
  };
}

function walkForFidelity(node: EditorNode, flags: RichMarkdownFidelityFlags): void {
  if (
    (node.type === 'tableCell' || node.type === 'tableHeader') &&
    Array.isArray(node.attrs?.colwidth) &&
    node.attrs.colwidth.length > 0
  ) {
    flags.tableColumnWidthCount += 1;
  }
  if (
    (node.type === 'tableCell' || node.type === 'tableHeader') &&
    (node.content?.length !== 1 || node.content[0]?.type !== 'paragraph')
  ) {
    flags.flattenedTableCellCount += 1;
  }
  if (node.type === 'image' && typeof node.attrs?.width === 'number') {
    flags.resizedImageCount += 1;
  }
  // Any non-null align counts — even an explicit 'left' would come back null
  // after a round trip, so it too is honestly a destroyed attr.
  if (node.type === 'image' && typeof node.attrs?.align === 'string' && node.attrs.align) {
    flags.alignedImageCount += 1;
  }
  // Any non-default presentation attr counts, even a width on a plain card.
  if (
    node.type === 'resourceCard' &&
    (typeof node.attrs?.width === 'number' ||
      typeof node.attrs?.height === 'number' ||
      (typeof node.attrs?.align === 'string' && node.attrs.align) ||
      (typeof node.attrs?.caption === 'string' && node.attrs.caption) ||
      node.attrs?.presentation === 'preview')
  ) {
    flags.previewFileCardCount += 1;
  }
  for (const mark of node.marks ?? []) {
    if (mark.type === 'comment') flags.commentMarkCount += 1;
  }
  for (const child of node.content ?? []) walkForFidelity(child, flags);
}

/** Scans one canonical document for the Markdown-lossy constructs above. */
export function detectRichMarkdownFidelityFlags(
  doc: EditorDocument
): RichMarkdownFidelityFlags {
  const flags = emptyFidelityFlags();
  for (const child of doc.content ?? []) walkForFidelity(child, flags);
  return flags;
}

/**
 * Whether committing the source buffer would drop attributes the document had. The caller must then
 * ask for confirmation.
 */
export function richMarkdownFidelityRequiresConfirm(
  flags: RichMarkdownFidelityFlags
): boolean {
  return (
    flags.commentMarkCount > 0 ||
    flags.tableColumnWidthCount > 0 ||
    flags.alignedImageCount > 0 ||
    flags.previewFileCardCount > 0 ||
    flags.flattenedTableCellCount > 0
  );
}

/**
 * Human-readable descriptions of every DESTROYED-on-export construct present
 * in `flags`, for the fidelity notice and the destructive-commit confirm
 * dialog (shared so the two surfaces can never enumerate different sets).
 */
export function describeRichMarkdownFidelityLosses(
  flags: RichMarkdownFidelityFlags
): string[] {
  const parts: string[] = [];
  if (flags.commentMarkCount > 0) {
    parts.push(
      `${flags.commentMarkCount} inline comment${flags.commentMarkCount === 1 ? '' : 's'}`
    );
  }
  if (flags.tableColumnWidthCount > 0) {
    parts.push(
      `${flags.tableColumnWidthCount} resized table column${
        flags.tableColumnWidthCount === 1 ? '' : 's'
      }`
    );
  }
  if (flags.alignedImageCount > 0) {
    parts.push(
      `${flags.alignedImageCount} aligned image${flags.alignedImageCount === 1 ? '' : 's'}`
    );
  }
  if (flags.previewFileCardCount > 0) {
    parts.push(
      `${flags.previewFileCardCount} file preview layout${
        flags.previewFileCardCount === 1 ? '' : 's'
      }`
    );
  }
  if (flags.flattenedTableCellCount > 0) {
    parts.push(
      `multi-block content in ${flags.flattenedTableCellCount} table cell${
        flags.flattenedTableCellCount === 1 ? '' : 's'
      }`
    );
  }
  return parts;
}

/** Oxford-free natural join: "a", "a and b", "a, b, and c". */
export function joinRichFidelityLossParts(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(', ')}, and ${parts.at(-1)}`;
}

type RichReferenceManifest = NonNullable<RichMarkdownImportOptions['referenceManifest']>;
type RichReferenceManifestResource = NonNullable<RichReferenceManifest['resources']>[number];

const RESOURCE_SELECTORS = ['live', 'latest-approved', 'pinned', 'imported-copy'] as const;

function resourceSelector(value: unknown): RichReferenceManifestResource['selector'] {
  return typeof value === 'string' && (RESOURCE_SELECTORS as readonly string[]).includes(value)
    ? (value as RichReferenceManifestResource['selector'])
    : 'latest-approved';
}

/**
 * Builds the manifest the importer uses to turn `rich-resource:` and `rich-task:` links back into
 * nodes. Source mode starts from this document, so its own JSON has all the metadata. A reference
 * typed by hand is left unresolved and blocks the commit.
 */
export function buildRichMarkdownReferenceManifest(
  doc: EditorDocument
): RichReferenceManifest {
  const resources: RichReferenceManifestResource[] = [];
  const tasks: NonNullable<RichReferenceManifest['tasks']> = [];
  const seenResources = new Set<string>();
  const seenTasks = new Set<string>();

  const visit = (node: EditorNode): void => {
    // Chips join the manifest so their kind and selector round-trip. They have no description.
    if (
      (node.type === 'image' || node.type === 'resourceCard' || node.type === 'resourceChip') &&
      typeof node.attrs?.resourceId === 'string' &&
      node.attrs.resourceId.length > 0
    ) {
      const resourceId = node.attrs.resourceId;
      if (!seenResources.has(resourceId)) {
        seenResources.add(resourceId);
        resources.push({
          resourceId,
          title: typeof node.attrs.title === 'string' ? node.attrs.title : resourceId,
          description: typeof node.attrs.description === 'string' ? node.attrs.description : null,
          kind: typeof node.attrs.kind === 'string' ? node.attrs.kind : 'file',
          selector: resourceSelector(node.attrs.selector)
        });
      } else if (typeof node.attrs.description === 'string') {
        // A description-less chip may have claimed the entry first; a later
        // card for the same resource still contributes its description so the
        // card's reimport stays lossless.
        const existing = resources.find((candidate) => candidate.resourceId === resourceId);
        if (existing && existing.description == null) existing.description = node.attrs.description;
      }
    }
    if (
      node.type === 'taskReference' &&
      typeof node.attrs?.taskId === 'string' &&
      node.attrs.taskId.length > 0
    ) {
      const taskId = node.attrs.taskId;
      if (!seenTasks.has(taskId)) {
        seenTasks.add(taskId);
        tasks.push({
          taskId,
          fallbackTitle:
            typeof node.attrs.fallbackTitle === 'string' ? node.attrs.fallbackTitle : taskId
        });
      }
    }
    for (const child of node.content ?? []) visit(child);
  };

  for (const child of doc.content ?? []) visit(child);
  return { resources, tasks };
}
