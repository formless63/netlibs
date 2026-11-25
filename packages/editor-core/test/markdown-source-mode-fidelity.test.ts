import { describe, expect, it } from 'bun:test';

import { importMarkdown } from '../src/importer.ts';
import { serializeMarkdown } from '../src/serializer.ts';
import {
  buildRichMarkdownReferenceManifest,
  detectRichMarkdownFidelityFlags,
  richMarkdownFidelityRequiresConfirm
} from '../src/source-mode.ts';
import type { EditorDocument } from '../src/types.ts';
import { validateEditorDocument } from '../src/validation.ts';

/**
 * Verifies, by round-tripping Markdown, what source mode preserves: image width survives; comment
 * marks and table column widths do not, so the editor asks before discarding them.
 */
function roundTrip(doc: EditorDocument): EditorDocument {
  const markdown = serializeMarkdown(doc);
  const referenceManifest = buildRichMarkdownReferenceManifest(doc);
  const result = importMarkdown(markdown, { referenceManifest });
  expect(result.canCommit, `import findings: ${JSON.stringify(result.findings)}`).toBe(true);
  const validation = validateEditorDocument(result.document);
  expect(validation.success, `validation findings: ${JSON.stringify(validation.findings)}`).toBe(
    true
  );
  return result.document;
}

describe('markdown source mode fidelity — image width', () => {
  it('SURVIVES a serialize -> import round trip (the ` =WIDTH` title-slot convention)', () => {
    const original: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            resourceId: 'res-image-1',
            title: 'A diagram',
            alt: 'A diagram',
            description: null,
            width: 480
          }
        }
      ]
    };

    const before = detectRichMarkdownFidelityFlags(original);
    expect(before.resizedImageCount).toBe(1);

    const reimported = roundTrip(original);
    const imageNode = reimported.content?.[0];
    expect(imageNode?.type).toBe('image');
    expect(imageNode?.attrs?.width).toBe(480);

    const after = detectRichMarkdownFidelityFlags(reimported);
    expect(after.resizedImageCount).toBe(1);
  });
});

describe('markdown source mode fidelity — table column widths', () => {
  it('is DESTROYED by a serialize -> import round trip (no Markdown form exists)', () => {
    const original: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableHeader',
                  attrs: { colwidth: [320] },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Wide column' }] }]
                },
                {
                  type: 'tableHeader',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Other' }] }]
                }
              ]
            },
            {
              type: 'tableRow',
              content: [
                {
                  type: 'tableCell',
                  attrs: { colwidth: [320] },
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }]
                },
                {
                  type: 'tableCell',
                  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }]
                }
              ]
            }
          ]
        }
      ]
    };

    const before = detectRichMarkdownFidelityFlags(original);
    expect(before.tableColumnWidthCount).toBe(2);

    const reimported = roundTrip(original);

    // Cell text content survives (it's what the Markdown table actually
    // encodes) — only the width metadata is gone.
    const table = reimported.content?.[0];
    expect(table?.type).toBe('table');

    const after = detectRichMarkdownFidelityFlags(reimported);
    expect(after.tableColumnWidthCount).toBe(0);
  });
});

describe('markdown source mode fidelity — image alignment', () => {
  it('is DESTROYED by a serialize -> import round trip (no Markdown form exists)', () => {
    const original: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: {
            resourceId: 'res-image-1',
            title: 'A diagram',
            alt: 'A diagram',
            description: null,
            width: 480,
            align: 'center'
          }
        }
      ]
    };

    const before = detectRichMarkdownFidelityFlags(original);
    expect(before.alignedImageCount).toBe(1);
    expect(richMarkdownFidelityRequiresConfirm(before)).toBe(true);

    const reimported = roundTrip(original);
    const imageNode = reimported.content?.[0];
    expect(imageNode?.type).toBe('image');
    // Width still survives (the ` =WIDTH` title slot); alignment does not.
    expect(imageNode?.attrs?.width).toBe(480);
    expect(imageNode?.attrs?.align).toBeUndefined();

    const after = detectRichMarkdownFidelityFlags(reimported);
    expect(after.alignedImageCount).toBe(0);
  });
});

// Superscript/subscript round-tripping lives in `editor-contract.test.ts`
// ('round-trips a %s mark through the %s Markdown form'), which also pins the
// on-wire delimiter. It carried no fidelity-flag assertion here, so it was the
// one case in this file that did not tie the flag detector to actual loss.

describe('markdown source mode fidelity — comment marks', () => {
  it('is DESTROYED by a serialize -> import round trip (no Markdown form exists)', () => {
    const original: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Please review ' },
            {
              type: 'text',
              text: 'this clause',
              marks: [
                { type: 'comment', attrs: { commentId: '11111111-1111-4111-8111-111111111111' } }
              ]
            },
            { type: 'text', text: ' before shipping.' }
          ]
        }
      ]
    };

    const before = detectRichMarkdownFidelityFlags(original);
    expect(before.commentMarkCount).toBe(1);

    const reimported = roundTrip(original);

    // The surrounding text survives (readable in source mode); the comment
    // annotation itself does not.
    const markdown = serializeMarkdown(reimported);
    expect(markdown).toContain('this clause');

    const after = detectRichMarkdownFidelityFlags(reimported);
    expect(after.commentMarkCount).toBe(0);
  });
});

describe('markdown source mode fidelity — custom emoji', () => {
  it('SURVIVES the round trip losslessly, so it needs NO fidelity flag and NO confirm gate', () => {
    const original: EditorDocument = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Reviewed by ' },
            { type: 'customEmoji', attrs: { name: 'octocat' } }
          ]
        }
      ]
    };

    const flags = detectRichMarkdownFidelityFlags(original);
    expect(flags).toEqual({
      commentMarkCount: 0,
      tableColumnWidthCount: 0,
      alignedImageCount: 0,
      resizedImageCount: 0,
      previewFileCardCount: 0,
      flattenedTableCellCount: 0
    });
    expect(richMarkdownFidelityRequiresConfirm(flags)).toBe(false);

    const reimported = roundTrip(original);
    expect(reimported).toEqual(original);
  });
});
