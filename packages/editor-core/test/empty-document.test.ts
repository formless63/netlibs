import { describe, expect, it } from 'bun:test';
import { normalizeEmptyEditorDocument, validateEditorDocument } from '../src/validation.ts';

describe('normalizeEmptyEditorDocument', () => {
  it('turns a title-only document into one the grammar accepts', () => {
    for (const empty of [{ type: 'doc' }, { type: 'doc', content: [] }]) {
      expect(validateEditorDocument(empty).success).toBe(false);
      const normalized = normalizeEmptyEditorDocument(empty);
      expect(normalized).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
      expect(validateEditorDocument(normalized).success).toBe(true);
    }
  });

  it('leaves non-empty and non-document values unchanged', () => {
    const document = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'kept' }] }]
    };
    expect(normalizeEmptyEditorDocument(document)).toBe(document);
    expect(normalizeEmptyEditorDocument(null)).toBeNull();
    const notADoc = { type: 'paragraph', content: [] };
    expect(normalizeEmptyEditorDocument(notADoc)).toBe(notADoc);
  });
});
