import {
  DocumentConflictError,
  DocumentError,
  DocumentNotFoundError,
  DocumentReadOnlyError,
  DocumentValidationError
} from './errors.ts';
import { validateDocumentContent } from './limits.ts';
import { migrateDocument, openDocument } from './migrate.ts';
import { applyDocumentOperations, type ApplyOperationsOptions, type DocumentOperation } from './operations.ts';
import { EDITOR_SCHEMA_VERSION, type EditorDocument } from './types.ts';
import { normalizeEmptyEditorDocument, validateEditorDocument } from './validation.ts';

/**
 * Versioned-document semantics, independent of any database: optimistic
 * concurrency, an immutable revision per successful write, and restore as a
 * new revision. Persistence is the host's `DocumentStore`.
 */

export type RevisionOperation = 'create' | 'save' | 'restore' | 'archive';

export interface DocumentRecord {
  id: string;
  title: string;
  content: EditorDocument;
  schemaVersion: number;
  /** Increments by one on every write; the optimistic-concurrency token. */
  version: number;
  archivedAt: Date | null;
  createdBy: string;
  updatedBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface DocumentRevision {
  id: string;
  documentId: string;
  version: number;
  operation: RevisionOperation;
  title: string;
  content: EditorDocument;
  schemaVersion: number;
  restoredFromRevisionId: string | null;
  actorId: string;
  createdAt: Date;
}

export interface RevisionPage {
  limit?: number;
  offset?: number;
}

/**
 * Persistence adapter. `insert` and `update` must write the record and its
 * revision atomically (one transaction).
 */
export interface DocumentStore {
  get(id: string): Promise<DocumentRecord | null>;
  insert(record: DocumentRecord, revision: DocumentRevision): Promise<void>;
  /**
   * Compare-and-set: writes only if the stored version still equals
   * `expectedVersion`, returning `false` (and writing nothing) otherwise.
   */
  update(
    record: DocumentRecord,
    revision: DocumentRevision,
    expectedVersion: number
  ): Promise<boolean>;
  /** Newest first. */
  listRevisions(documentId: string, page: Required<RevisionPage>): Promise<DocumentRevision[]>;
  getRevision(documentId: string, revisionId: string): Promise<DocumentRevision | null>;
}

/** Host veto for a write, e.g. "does every referenced resource exist and belong to this actor". */
export type ContentPolicy = (input: {
  operation: 'create' | 'save';
  actorId: string;
  documentId: string | null;
  content: EditorDocument;
}) => void | Promise<void>;

export interface DocumentServiceOptions {
  store: DocumentStore;
  contentPolicy?: ContentPolicy;
  now?: () => Date;
  createId?: () => string;
}

export interface DocumentService {
  create(input: { title: string; content?: unknown; actorId: string; id?: string }): Promise<DocumentRecord>;
  get(id: string): Promise<DocumentRecord>;
  save(input: {
    id: string;
    expectedVersion: number;
    content: unknown;
    title?: string;
    actorId: string;
  }): Promise<DocumentRecord>;
  /** Reads, applies agent operations, and saves against the version the caller read. */
  applyOperations(input: {
    id: string;
    expectedVersion: number;
    operations: readonly DocumentOperation[];
    actorId: string;
    options?: ApplyOperationsOptions;
  }): Promise<DocumentRecord>;
  /** Copies an old revision forward as a new version; also un-archives. */
  restore(input: {
    id: string;
    revisionId: string;
    expectedVersion: number;
    actorId: string;
  }): Promise<DocumentRecord>;
  archive(input: { id: string; expectedVersion: number; actorId: string }): Promise<DocumentRecord>;
  listRevisions(id: string, page?: RevisionPage): Promise<DocumentRevision[]>;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;
const TITLE_MAX_LENGTH = 300;

function cleanTitle(raw: string): string {
  const title = raw.trim();
  if (!title || title.length > TITLE_MAX_LENGTH) {
    throw new DocumentValidationError(`Title must be 1 to ${TITLE_MAX_LENGTH} characters`);
  }
  return title;
}

/** Size-bounds, upgrades and grammar-checks an untrusted document body. */
export function prepareContent(value: unknown): EditorDocument {
  const bounded = validateDocumentContent(openDocument(value));
  const document = normalizeEmptyEditorDocument(bounded);
  const result = validateEditorDocument(document);
  if (!result.success || !result.document) {
    throw new DocumentValidationError(
      result.findings.map((finding) => finding.message).join('; ') || 'Document is invalid'
    );
  }
  return result.document;
}

export function createDocumentService({
  store,
  contentPolicy,
  now = () => new Date(),
  createId = () => globalThis.crypto.randomUUID()
}: DocumentServiceOptions): DocumentService {
  async function load(id: string): Promise<DocumentRecord> {
    const record = await store.get(id);
    if (!record) throw new DocumentNotFoundError(`Document ${id} not found`);
    return record;
  }

  function current(record: DocumentRecord): DocumentRecord {
    return record.schemaVersion === EDITOR_SCHEMA_VERSION
      ? record
      : {
          ...record,
          content: migrateDocument(record.content, record.schemaVersion),
          schemaVersion: EDITOR_SCHEMA_VERSION
        };
  }

  async function policy(
    operation: 'create' | 'save',
    actorId: string,
    documentId: string | null,
    content: EditorDocument
  ): Promise<void> {
    if (!contentPolicy) return;
    try {
      await contentPolicy({ operation, actorId, documentId, content });
    } catch (error) {
      if (error instanceof DocumentError) throw error;
      throw new DocumentValidationError('Document content was rejected by host policy', {
        cause: error
      });
    }
  }

  function revisionOf(
    record: DocumentRecord,
    operation: RevisionOperation,
    actorId: string,
    restoredFromRevisionId: string | null = null
  ): DocumentRevision {
    return {
      id: createId(),
      documentId: record.id,
      version: record.version,
      operation,
      title: record.title,
      content: structuredClone(record.content),
      schemaVersion: record.schemaVersion,
      restoredFromRevisionId,
      actorId,
      createdAt: record.updatedAt
    };
  }

  async function write(
    before: DocumentRecord,
    changes: Partial<Pick<DocumentRecord, 'title' | 'content' | 'archivedAt'>>,
    operation: RevisionOperation,
    expectedVersion: number,
    actorId: string,
    restoredFromRevisionId: string | null = null
  ): Promise<DocumentRecord> {
    const record: DocumentRecord = {
      ...current(before),
      ...changes,
      version: expectedVersion + 1,
      updatedBy: actorId,
      updatedAt: now()
    };
    const revision = revisionOf(record, operation, actorId, restoredFromRevisionId);
    const written =
      before.version === expectedVersion && (await store.update(record, revision, expectedVersion));
    if (!written) throw new DocumentConflictError('Document changed since it was read');
    return record;
  }

  function requireEditable(record: DocumentRecord): void {
    if (record.archivedAt) throw new DocumentReadOnlyError('Archived documents cannot be edited');
  }

  const service: DocumentService = {
    async create({ title, content, actorId, id }) {
      const body = prepareContent(content ?? { type: 'doc' });
      await policy('create', actorId, null, body);
      const at = now();
      const record: DocumentRecord = {
        id: id ?? createId(),
        title: cleanTitle(title),
        content: body,
        schemaVersion: EDITOR_SCHEMA_VERSION,
        version: 1,
        archivedAt: null,
        createdBy: actorId,
        updatedBy: actorId,
        createdAt: at,
        updatedAt: at
      };
      await store.insert(record, revisionOf(record, 'create', actorId));
      return record;
    },

    async get(id) {
      return current(await load(id));
    },

    async save({ id, expectedVersion, content, title, actorId }) {
      const body = prepareContent(content);
      const before = await load(id);
      requireEditable(before);
      await policy('save', actorId, id, body);
      return write(
        before,
        { content: body, ...(title === undefined ? {} : { title: cleanTitle(title) }) },
        'save',
        expectedVersion,
        actorId
      );
    },

    async applyOperations({ id, expectedVersion, operations, actorId, options }) {
      const before = await service.get(id);
      if (before.version !== expectedVersion) {
        throw new DocumentConflictError('Document changed since it was read');
      }
      const content = applyDocumentOperations(before.content, operations, options);
      return service.save({ id, expectedVersion, content, actorId });
    },

    async restore({ id, revisionId, expectedVersion, actorId }) {
      const before = await load(id);
      const revision = await store.getRevision(id, revisionId);
      if (!revision) throw new DocumentNotFoundError(`Revision ${revisionId} not found`);
      const content = migrateDocument(revision.content, revision.schemaVersion);
      return write(
        before,
        { title: revision.title, content, archivedAt: null },
        'restore',
        expectedVersion,
        actorId,
        revision.id
      );
    },

    async archive({ id, expectedVersion, actorId }) {
      const before = await load(id);
      requireEditable(before);
      return write(before, { archivedAt: now() }, 'archive', expectedVersion, actorId);
    },

    async listRevisions(id, page = {}) {
      await load(id);
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(page.limit ?? DEFAULT_LIMIT)));
      const offset = Math.max(0, Math.trunc(page.offset ?? 0));
      return store.listRevisions(id, { limit, offset });
    }
  };
  return service;
}

/** Reference `DocumentStore` for tests, demos and prototypes. Not durable. */
export class MemoryDocumentStore implements DocumentStore {
  private readonly records = new Map<string, DocumentRecord>();
  private readonly revisions = new Map<string, DocumentRevision[]>();

  async get(id: string): Promise<DocumentRecord | null> {
    const record = this.records.get(id);
    return record ? structuredClone(record) : null;
  }

  async insert(record: DocumentRecord, revision: DocumentRevision): Promise<void> {
    if (this.records.has(record.id)) throw new DocumentConflictError('Document already exists');
    this.records.set(record.id, structuredClone(record));
    this.revisions.set(record.id, [structuredClone(revision)]);
  }

  async update(
    record: DocumentRecord,
    revision: DocumentRevision,
    expectedVersion: number
  ): Promise<boolean> {
    if (this.records.get(record.id)?.version !== expectedVersion) return false;
    this.records.set(record.id, structuredClone(record));
    this.revisions.get(record.id)?.unshift(structuredClone(revision));
    return true;
  }

  async listRevisions(id: string, { limit, offset }: Required<RevisionPage>): Promise<DocumentRevision[]> {
    return structuredClone((this.revisions.get(id) ?? []).slice(offset, offset + limit));
  }

  async getRevision(id: string, revisionId: string): Promise<DocumentRevision | null> {
    const found = this.revisions.get(id)?.find((revision) => revision.id === revisionId);
    return found ? structuredClone(found) : null;
  }
}
