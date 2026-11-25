import { extractRichSearchText } from './search.ts';
import { serializeMarkdown } from './serializer.ts';
import { EDITOR_SCHEMA_VERSION, type EditorDocument } from './types.ts';
import { assertEditorDocument } from './validation.ts';

export interface PreparedEditorSnapshot {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  canonicalJson: EditorDocument;
  markdown: string;
  searchText: string;
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}

/**
 * Markdown and search text for content that is already canonical, without validating or hashing
 * again.
 */
export function deriveRichRevisionProjections(
  canonicalJson: EditorDocument,
  options: { documentTitle?: string } = {}
): { markdown: string; searchText: string } {
  return {
    markdown: serializeMarkdown(canonicalJson),
    searchText: extractRichSearchText(canonicalJson, options.documentTitle)
  };
}

export function prepareEditorSnapshot(
  value: unknown,
  options: { documentTitle?: string } = {}
): PreparedEditorSnapshot {
  assertEditorDocument(value);
  const canonicalJson = sortJson(structuredClone(value)) as EditorDocument;
  return {
    schemaVersion: EDITOR_SCHEMA_VERSION,
    canonicalJson,
    ...deriveRichRevisionProjections(canonicalJson, options)
  };
}

/**
 * Validate + canonicalize a raw editor payload for the working-copy (level
 * 1) write path — cheap and frequent, so it deliberately skips the
 * markdown/search-text derivation `prepareEditorSnapshot` does for a
 * mint (the working copy table doesn't store either field).
 */
export function prepareRichWorkingCopySnapshot(value: unknown): {
  schemaVersion: typeof EDITOR_SCHEMA_VERSION;
  canonicalJson: EditorDocument;
} {
  assertEditorDocument(value);
  const canonicalJson = sortJson(structuredClone(value)) as EditorDocument;
  return { schemaVersion: EDITOR_SCHEMA_VERSION, canonicalJson };
}
