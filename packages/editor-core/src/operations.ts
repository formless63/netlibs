import {
  RICH_BLOCK_ID_PATTERN,
  RICH_BLOCK_IDENTITY_NODE_TYPES,
  generateRichBlockId
} from './block-id.ts';
import { DocumentError } from './errors.ts';
import { importMarkdown, type RichMarkdownImportOptions } from './importer.ts';
import { buildRichMarkdownReferenceManifest } from './source-mode.ts';
import type { EditorDocument, EditorNode } from './types.ts';
import { validateEditorDocument } from './validation.ts';

/**
 * Programmatic editing of canonical documents: plain functions over JSON, no
 * editor instance and no DOM. Intended for CLIs, jobs and coding agents, via
 * whatever application code wraps them.
 *
 * Blocks are addressed by `blockId`. Run `ensureBlockIds` once (the editor does
 * this itself on open) so every block is addressable.
 */

const ID_TYPES: ReadonlySet<string> = new Set(RICH_BLOCK_IDENTITY_NODE_TYPES);

export class DocumentOperationError extends DocumentError {
  readonly operationIndex: number | null;

  constructor(message: string, operationIndex: number | null = null) {
    super('VALIDATION', message);
    this.operationIndex = operationIndex;
  }
}

/** New content for an operation: canonical blocks, or Markdown in the full dialect. */
export type BlockSource = { content: EditorNode[] } | { markdown: string };

export type BlockPosition =
  { before: string } | { after: string } | { at: 'start' } | { at: 'end' };

export type DocumentOperation =
  | ({ op: 'insert'; position: BlockPosition } & BlockSource)
  | ({ op: 'replace'; blockId: string } & BlockSource)
  | { op: 'delete'; blockId: string }
  | { op: 'move'; blockId: string; position: BlockPosition }
  /** Merges attributes; `null` clears one. `blockId` itself cannot be changed. */
  | { op: 'setAttrs'; blockId: string; attrs: Record<string, unknown> }
  /** Replaces everything under a heading, up to the next heading of the same or higher level. */
  | ({ op: 'replaceSection'; headingId: string } & BlockSource)
  /**
   * Literal text replacement that preserves marks. Fails unless the number of
   * matches equals `expectedCount` (default 1), so an agent cannot silently
   * edit the wrong place. Pass `'any'` to replace all matches.
   */
  | {
      op: 'replaceText';
      find: string;
      replace: string;
      blockId?: string;
      expectedCount?: number | 'any';
    };

export interface ApplyOperationsOptions {
  /** Metadata for resources/tasks that Markdown operations introduce. */
  markdown?: RichMarkdownImportOptions;
}

export interface BlockSummary {
  blockId: string | null;
  type: string;
  depth: number;
  text: string;
  attrs: Record<string, unknown>;
}

export interface OutlineEntry {
  blockId: string | null;
  anchorId: string | null;
  level: number;
  text: string;
}

function idOf(node: EditorNode): string | null {
  return typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : null;
}

export function nodeText(node: EditorNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(nodeText).join('');
}

/**
 * Returns a copy in which every block has a unique, well-formed `blockId`.
 * Existing valid ids are kept (first occurrence wins), so it is idempotent.
 */
export function ensureBlockIds(doc: EditorDocument): EditorDocument {
  const seen = new Set<string>();
  const visit = (node: EditorNode): EditorNode => {
    let next = node;
    if (ID_TYPES.has(node.type)) {
      let id = idOf(node);
      if (!id || !RICH_BLOCK_ID_PATTERN.test(id) || seen.has(id)) id = generateRichBlockId();
      seen.add(id);
      if (id !== idOf(node)) next = { ...node, attrs: { ...node.attrs, blockId: id } };
    }
    return next.content ? { ...next, content: next.content.map(visit) } : next;
  };
  return visit(doc) as EditorDocument;
}

/** Flat, depth-annotated listing of every addressable block, in document order. */
export function listBlocks(doc: EditorDocument): BlockSummary[] {
  const out: BlockSummary[] = [];
  const visit = (node: EditorNode, depth: number): void => {
    if (ID_TYPES.has(node.type)) {
      const { blockId: _id, ...attrs } = node.attrs ?? {};
      out.push({ blockId: idOf(node), type: node.type, depth, text: nodeText(node), attrs });
    }
    for (const child of node.content ?? []) visit(child, depth + 1);
  };
  for (const child of doc.content ?? []) visit(child, 0);
  return out;
}

export function getDocumentOutline(doc: EditorDocument): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  const visit = (node: EditorNode): void => {
    if (node.type === 'heading') {
      out.push({
        blockId: idOf(node),
        anchorId: typeof node.attrs?.anchorId === 'string' ? node.attrs.anchorId : null,
        level: Number(node.attrs?.level ?? 1),
        text: nodeText(node)
      });
    }
    for (const child of node.content ?? []) visit(child);
  };
  visit(doc);
  return out;
}

export function findBlock(doc: EditorDocument, blockId: string): EditorNode | null {
  const visit = (node: EditorNode): EditorNode | null => {
    if (idOf(node) === blockId) return node;
    for (const child of node.content ?? []) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  return visit(doc);
}

interface Located {
  parent: EditorNode;
  index: number;
}

/** Finds a block's parent in a working copy that the caller owns (it is mutated in place). */
function locate(root: EditorNode, blockId: string): Located {
  const visit = (parent: EditorNode): Located | null => {
    for (const [index, child] of (parent.content ?? []).entries()) {
      if (idOf(child) === blockId) return { parent, index };
      const found = visit(child);
      if (found) return found;
    }
    return null;
  };
  const found = visit(root);
  if (!found) throw new DocumentOperationError(`Block ${blockId} not found`);
  return found;
}

function contains(node: EditorNode, blockId: string): boolean {
  return idOf(node) === blockId || (node.content ?? []).some((child) => contains(child, blockId));
}

function insertAt(root: EditorNode, position: BlockPosition, nodes: EditorNode[]): void {
  if ('at' in position) {
    root.content ??= [];
    if (position.at === 'start') root.content.unshift(...nodes);
    else root.content.push(...nodes);
    return;
  }
  const anchor = 'before' in position ? position.before : position.after;
  const { parent, index } = locate(root, anchor);
  parent.content!.splice('before' in position ? index : index + 1, 0, ...nodes);
}

function resolveSource(
  root: EditorDocument,
  source: BlockSource,
  options: ApplyOperationsOptions
): EditorNode[] {
  if ('content' in source) return structuredClone(source.content);
  if (source.markdown.trim() === '') return [];
  const existing = buildRichMarkdownReferenceManifest(root);
  const extra = options.markdown?.referenceManifest;
  const result = importMarkdown(source.markdown, {
    ...options.markdown,
    referenceManifest: {
      resources: [...(extra?.resources ?? []), ...(existing.resources ?? [])],
      tasks: [...(extra?.tasks ?? []), ...(existing.tasks ?? [])]
    }
  });
  if (!result.canCommit) {
    throw new DocumentOperationError(
      `Markdown cannot be imported: ${result.findings.map((finding) => finding.message).join('; ')}`
    );
  }
  return result.document.content ?? [];
}

function replaceTextIn(node: EditorNode, find: string, replace: string): number {
  if (!node.content) return 0;
  let count = 0;
  const out: EditorNode[] = [];
  let run: EditorNode[] = [];
  const flush = (): void => {
    if (run.length === 0) return;
    const text = run.map((part) => part.text ?? '').join('');
    const starts: number[] = [];
    for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) {
      starts.push(at);
    }
    count += starts.length;
    if (starts.length === 0) {
      out.push(...run);
      run = [];
      return;
    }
    // Each match is removed from every text node it spans; the replacement
    // takes the marks of the character where the match began.
    let offset = 0;
    for (const part of run) {
      const value = part.text ?? '';
      const end = offset + value.length;
      let next = '';
      let cursor = offset;
      for (const start of starts) {
        const stop = start + find.length;
        if (stop <= offset || start >= end) continue;
        if (start > cursor) next += value.slice(cursor - offset, start - offset);
        if (start >= offset) next += replace;
        cursor = Math.min(end, stop);
      }
      next += value.slice(cursor - offset);
      if (next) out.push({ ...part, text: next });
      offset = end;
    }
    run = [];
  };
  for (const child of node.content) {
    if (child.type === 'text') run.push(child);
    else {
      flush();
      count += replaceTextIn(child, find, replace);
      out.push(child);
    }
  }
  flush();
  if (out.length > 0) node.content = out;
  else delete node.content;
  return count;
}

function applyOne(
  root: EditorDocument,
  operation: DocumentOperation,
  options: ApplyOperationsOptions
): void {
  switch (operation.op) {
    case 'insert':
      insertAt(root, operation.position, resolveSource(root, operation, options));
      return;
    case 'replace': {
      const nodes = resolveSource(root, operation, options);
      const { parent, index } = locate(root, operation.blockId);
      // A single same-type replacement is an edit of that block, so it keeps the id.
      const first = nodes[0];
      if (nodes.length === 1 && first && first.type === parent.content![index]!.type && !idOf(first)) {
        first.attrs = { ...first.attrs, blockId: operation.blockId };
      }
      parent.content!.splice(index, 1, ...nodes);
      return;
    }
    case 'delete': {
      const { parent, index } = locate(root, operation.blockId);
      parent.content!.splice(index, 1);
      return;
    }
    case 'move': {
      const { parent, index } = locate(root, operation.blockId);
      const node = parent.content![index]!;
      if (!('at' in operation.position)) {
        const anchor = 'before' in operation.position ? operation.position.before : operation.position.after;
        if (contains(node, anchor)) {
          throw new DocumentOperationError('A block cannot be moved relative to itself or its contents');
        }
      }
      parent.content!.splice(index, 1);
      insertAt(root, operation.position, [node]);
      return;
    }
    case 'setAttrs': {
      if ('blockId' in operation.attrs) {
        throw new DocumentOperationError('blockId cannot be changed');
      }
      const { parent, index } = locate(root, operation.blockId);
      const node = parent.content![index]!;
      node.attrs = { ...node.attrs, ...structuredClone(operation.attrs) };
      return;
    }
    case 'replaceSection': {
      const nodes = resolveSource(root, operation, options);
      const { parent, index } = locate(root, operation.headingId);
      const heading = parent.content![index]!;
      if (heading.type !== 'heading') {
        throw new DocumentOperationError(`Block ${operation.headingId} is not a heading`);
      }
      const level = Number(heading.attrs?.level ?? 1);
      let end = index + 1;
      while (end < parent.content!.length) {
        const sibling = parent.content![end]!;
        if (sibling.type === 'heading' && Number(sibling.attrs?.level ?? 1) <= level) break;
        end += 1;
      }
      parent.content!.splice(index + 1, end - index - 1, ...nodes);
      return;
    }
    case 'replaceText': {
      if (operation.find.length === 0) throw new DocumentOperationError('find must not be empty');
      const expected = operation.expectedCount ?? 1;
      let target: EditorNode = root;
      if (operation.blockId) {
        const { parent, index } = locate(root, operation.blockId);
        target = parent.content![index]!;
      }
      const count = replaceTextIn(target, operation.find, operation.replace);
      if (expected !== 'any' && count !== expected) {
        throw new DocumentOperationError(`Expected ${expected} match(es) for text, found ${count}`);
      }
    }
  }
}

/**
 * Applies operations in order and returns a new, validated document with block
 * ids assigned. All-or-nothing: any failure throws and the input is untouched.
 */
export function applyDocumentOperations(
  doc: EditorDocument,
  operations: readonly DocumentOperation[],
  options: ApplyOperationsOptions = {}
): EditorDocument {
  const working = structuredClone(doc);
  operations.forEach((operation, index) => {
    try {
      applyOne(working, operation, options);
    } catch (error) {
      if (error instanceof DocumentOperationError) {
        throw new DocumentOperationError(`Operation ${index} (${operation.op}): ${error.message}`, index);
      }
      throw error;
    }
  });
  if (!working.content?.length) working.content = [{ type: 'paragraph' }];
  const result = ensureBlockIds(working);
  const validation = validateEditorDocument(result);
  if (!validation.success) {
    throw new DocumentOperationError(
      `Result is not a valid document: ${validation.findings.map((finding) => finding.message).join('; ')}`
    );
  }
  return result;
}
