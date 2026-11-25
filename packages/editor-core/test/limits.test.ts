import { describe, expect, it } from 'bun:test';
import {
  DOCUMENT_CONTENT_MAX_BYTES,
  DOCUMENT_CONTENT_MAX_NODES,
  normalizeEmptyDocumentContent,
  validateDocumentContent,
} from '../src/limits.ts';
import { DocumentValidationError } from '../src/errors.ts';

describe("validateDocumentContent", () => {
  it("preserves unknown rich-node payloads exactly", () => {
    const input = {
      type: "doc",
      futureRootField: { enabled: true },
      content: [
        {
          type: "futureEmbed",
          attrs: {
            opaque: { nested: [1, false, null, "value"] },
          },
          marks: [{ type: "futureMark", attrs: { tone: "warm" } }],
        },
      ],
    };
    expect(validateDocumentContent(input)).toEqual(input as never);
  });

  it("rejects invalid roots, excessive depth, nodes, and bytes", () => {
    expect(() => validateDocumentContent({ type: "paragraph" })).toThrow(DocumentValidationError);

    let deep: unknown = { type: "doc" };
    for (let index = 0; index < 70; index += 1) deep = { type: "doc", content: [deep] };
    expect(() => validateDocumentContent(deep)).toThrow(/maximum depth/);

    const manyNodes = Array.from({ length: DOCUMENT_CONTENT_MAX_NODES + 1 }, () => ({
      type: "paragraph",
    }));
    expect(() => validateDocumentContent({ type: "doc", content: manyNodes })).toThrow(
      /maximum node count/,
    );

    expect(() =>
      validateDocumentContent({
        type: "doc",
        text: "x".repeat(DOCUMENT_CONTENT_MAX_BYTES),
      }),
    ).toThrow(/maximum byte size/);
  });

  it("rejects non-JSON values without silently dropping them", () => {
    expect(() => validateDocumentContent({ type: "doc", content: undefined })).toThrow(
      /only JSON values/,
    );
    expect(() => validateDocumentContent({ type: "doc", value: Number.NaN })).toThrow(/finite/);
  });
});

describe("normalizeEmptyDocumentContent", () => {
  it("reads a document with no blocks as one empty paragraph", () => {
    expect(normalizeEmptyDocumentContent({ type: "doc" })).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
    expect(normalizeEmptyDocumentContent({ type: "doc", content: [] })).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });

  it("returns non-empty content unchanged", () => {
    const content = { type: "doc" as const, content: [{ type: "heading" }] };
    expect(normalizeEmptyDocumentContent(content)).toBe(content);
  });
});
