import { DocumentValidationError, UnsupportedSchemaVersionError } from './errors.ts';
import { EDITOR_SCHEMA_VERSION, type EditorDocument, type EditorNode } from './types.ts';

/** Storage envelope: what to persist when the schema version must travel with the content. */
export interface VersionedDocument {
  format: 'rich-document';
  schemaVersion: number;
  document: EditorDocument;
}

type SchemeMap = (value: string) => string;

function mapNode(node: EditorNode, map: SchemeMap): EditorNode {
  const next: EditorNode = { ...node };
  if (node.attrs && typeof node.attrs.src === 'string') {
    next.attrs = { ...node.attrs, src: map(node.attrs.src) };
  }
  if (Array.isArray(node.marks)) {
    next.marks = node.marks.map((mark) =>
      mark.type === 'link' && typeof mark.attrs?.href === 'string'
        ? { ...mark, attrs: { ...mark.attrs, href: map(mark.attrs.href) } }
        : mark
    );
  }
  if (Array.isArray(node.content)) next.content = node.content.map((child) => mapNode(child, map));
  return next;
}

/** Migration steps keyed by the version they produce. Steps must be idempotent and pure. */
const MIGRATIONS: ReadonlyArray<{ to: number; migrate: (doc: EditorDocument) => EditorDocument }> = [];

/**
 * Upgrades a document to the current schema. `fromVersion` defaults to 1
 * because every step is idempotent: an unversioned document is safe to run
 * through all of them. Never mutates its input.
 */
export function migrateDocument(doc: EditorDocument, fromVersion = 1): EditorDocument {
  if (!Number.isInteger(fromVersion) || fromVersion < 1) {
    throw new DocumentValidationError('Schema version must be a positive integer');
  }
  if (fromVersion > EDITOR_SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(
      `Document schema v${fromVersion} is newer than the supported v${EDITOR_SCHEMA_VERSION}`
    );
  }
  let current = doc;
  for (const step of MIGRATIONS) if (step.to > fromVersion) current = step.migrate(current);
  return current;
}

export function createVersionedDocument(document: EditorDocument): VersionedDocument {
  return { format: 'rich-document', schemaVersion: EDITOR_SCHEMA_VERSION, document };
}

/**
 * Opens stored content in any accepted shape (a versioned envelope or a bare
 * `doc`) and returns an upgraded document. Structural validation is separate
 * (`validateEditorDocument`), so a renderer can open without the Tiptap schema.
 */
export function openDocument(value: unknown): EditorDocument {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DocumentValidationError('Document must be an object');
  }
  const record = value as Record<string, unknown>;
  if (record.format === 'rich-document') {
    const inner = record.document as EditorDocument | undefined;
    if (!inner || inner.type !== 'doc') {
      throw new DocumentValidationError('Versioned document has no doc root');
    }
    return migrateDocument(inner, record.schemaVersion as number);
  }
  if (record.type !== 'doc') throw new DocumentValidationError('Document root must have type "doc"');
  return migrateDocument(value as EditorDocument);
}

/**
 * Rewrites link and image schemes, e.g. `{ 'old-doc:': 'rich-doc:' }`, so
 * documents stored with another application's scheme names can be opened.
 * Swap the pairs to convert back. Never mutates its input.
 */
export function rewriteReferenceSchemes(
  doc: EditorDocument,
  schemes: Readonly<Record<string, string>>
): EditorDocument {
  return mapNode(doc, (value) => {
    for (const [from, to] of Object.entries(schemes)) {
      if (value.startsWith(from)) return to + value.slice(from.length);
    }
    return value;
  }) as EditorDocument;
}
