import { DocumentValidationError } from "./errors.ts";
import type { DocumentContent, JsonValue } from "./json.ts";

export const DOCUMENT_CONTENT_MAX_BYTES = 1024 * 1024;
export const DOCUMENT_CONTENT_MAX_DEPTH = 64;
export const DOCUMENT_CONTENT_MAX_NODES = 20_000;

function validateValue(
  value: unknown,
  depth: number,
  counter: { nodes: number },
): asserts value is JsonValue {
  if (depth > DOCUMENT_CONTENT_MAX_DEPTH) {
    throw new DocumentValidationError("Document content exceeds the maximum depth");
  }
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new DocumentValidationError("Document content numbers must be finite");
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const child of value) validateValue(child, depth + 1, counter);
    return;
  }
  if (typeof value !== "object" || value === undefined) {
    throw new DocumentValidationError("Document content must contain only JSON values");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new DocumentValidationError("Document content objects must be plain JSON objects");
  }
  counter.nodes += 1;
  if (counter.nodes > DOCUMENT_CONTENT_MAX_NODES) {
    throw new DocumentValidationError("Document content exceeds the maximum node count");
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    validateValue(child, depth + 1, counter);
  }
}

export function validateDocumentContent(value: unknown): DocumentContent {
  validateValue(value, 0, { nodes: 0 });
  if (Array.isArray(value) || value === null || typeof value !== "object" || value.type !== "doc") {
    throw new DocumentValidationError('Document content root must have type "doc"');
  }
  if (value.content !== undefined && !Array.isArray(value.content)) {
    throw new DocumentValidationError("Document content must be an array when present");
  }
  const serialized = JSON.stringify(value);
  if (new TextEncoder().encode(serialized).byteLength > DOCUMENT_CONTENT_MAX_BYTES) {
    throw new DocumentValidationError("Document content exceeds the maximum byte size");
  }
  return JSON.parse(serialized) as DocumentContent;
}

/**
 * A document body the editor can open. The editor grammar requires
 * at least one block (`doc` is `block+`), so a document whose root has no
 * `content` or an empty `content` array (a title-only create, an emptied
 * save, or a row written before this rule) is treated as one empty
 * paragraph. Any other content is returned unchanged.
 */
export function normalizeEmptyDocumentContent(
  content: DocumentContent,
): DocumentContent {
  if (content.content !== undefined && content.content.length > 0) {
    return content;
  }
  return { ...content, content: [{ type: "paragraph" }] };
}
