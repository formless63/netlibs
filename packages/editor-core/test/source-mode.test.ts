import { describe, expect, it, vi } from 'bun:test';

import {
  buildRichMarkdownReferenceManifest,
  describeRichMarkdownFidelityLosses,
  detectRichMarkdownFidelityFlags,
  joinRichFidelityLossParts,
  EDITOR_VIEW_MODE_STORAGE_KEY,
  richMarkdownFidelityRequiresConfirm,
  parseEditorViewMode,
  readStoredEditorViewMode,
  restoreEditorViewMode,
  writeStoredEditorViewMode
} from '../src/source-mode.ts';
import type { EditorDocument } from '../src/types.ts';

describe('parseEditorViewMode', () => {
  it('accepts every literal mode', () => {
    expect(parseEditorViewMode('source')).toBe('source');
    expect(parseEditorViewMode('richtext-toolbar')).toBe('richtext-toolbar');
    expect(parseEditorViewMode('richtext')).toBe('richtext');
  });

  it.each([null, undefined, '', 'SOURCE', 'RICHTEXT-TOOLBAR', 42, {}])(
    'falls back to richtext for %p',
    (raw) => {
      expect(parseEditorViewMode(raw)).toBe('richtext');
    }
  );
});

describe('readStoredEditorViewMode / writeStoredEditorViewMode', () => {
  it('defaults to richtext when storage is unavailable', () => {
    expect(readStoredEditorViewMode(null)).toBe('richtext');
    expect(readStoredEditorViewMode(undefined)).toBe('richtext');
  });

  it('round-trips through a storage-like object', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value)
    };
    writeStoredEditorViewMode(storage, 'source');
    expect(store.get(EDITOR_VIEW_MODE_STORAGE_KEY)).toBe('source');
    expect(readStoredEditorViewMode(storage)).toBe('source');
  });

  it('degrades to the default when the stored value is malformed', () => {
    const storage = { getItem: () => 'nonsense' };
    expect(readStoredEditorViewMode(storage)).toBe('richtext');
  });

  it('never throws when storage access itself throws (private-mode Safari)', () => {
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError');
      })
    };
    expect(readStoredEditorViewMode(throwingStorage)).toBe('richtext');

    const throwingWrite = {
      setItem: vi.fn(() => {
        throw new Error('QuotaExceededError');
      })
    };
    expect(() => writeStoredEditorViewMode(throwingWrite, 'source')).not.toThrow();
  });
});

function storageWith(value: string) {
  return { getItem: () => value };
}

function resourceCard(attrs: Record<string, unknown>) {
  return {
    type: 'resourceCard',
    attrs: { resourceId: 'r1', title: 'a.pdf', kind: 'file', selector: 'live', ...attrs }
  };
}

describe('restoreEditorViewMode', () => {
  it('degrades a stored "source" to richtext', () => {
    // Source mode may only be entered through enterSourceMode(), which seeds its buffer. Restoring
    // it directly would show an empty buffer over a real document.
    expect(restoreEditorViewMode(storageWith('source'))).toBe('richtext');
  });

  it('passes the rich-text-backed modes through unchanged', () => {
    expect(restoreEditorViewMode(storageWith('richtext'))).toBe('richtext');
    expect(restoreEditorViewMode(storageWith('richtext-toolbar'))).toBe('richtext-toolbar');
  });
});

function doc(content: EditorDocument['content']): EditorDocument {
  return { type: 'doc', content };
}

describe('detectRichMarkdownFidelityFlags', () => {
  it('reports all-zero flags for a plain document', () => {
    const flags = detectRichMarkdownFidelityFlags(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }])
    );
    expect(flags).toEqual({
      commentMarkCount: 0,
      tableColumnWidthCount: 0,
      alignedImageCount: 0,
      resizedImageCount: 0,
      previewFileCardCount: 0,
      flattenedTableCellCount: 0
    });
  });

  it('counts comment marks anywhere in the tree', () => {
    const flags = detectRichMarkdownFidelityFlags(
      doc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'annotated',
              marks: [{ type: 'comment', attrs: { commentId: 'x' } }]
            }
          ]
        },
        {
          type: 'blockquote',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'nested',
                  marks: [{ type: 'comment', attrs: { commentId: 'y' } }]
                }
              ]
            }
          ]
        }
      ])
    );
    expect(flags.commentMarkCount).toBe(2);
  });

  it('counts table cells/headers carrying a colwidth array', () => {
    const flags = detectRichMarkdownFidelityFlags(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [
                { type: 'tableHeader', attrs: { colwidth: [200] }, content: [] },
                { type: 'tableHeader', content: [] }
              ]
            },
            {
              type: 'tableRow',
              content: [
                { type: 'tableCell', attrs: { colwidth: [200] }, content: [] },
                { type: 'tableCell', content: [] }
              ]
            }
          ]
        }
      ])
    );
    expect(flags.tableColumnWidthCount).toBe(2);
  });

  it('does not count an empty colwidth array', () => {
    const flags = detectRichMarkdownFidelityFlags(
      doc([
        {
          type: 'table',
          content: [
            {
              type: 'tableRow',
              content: [{ type: 'tableCell', attrs: { colwidth: [] }, content: [] }]
            }
          ]
        }
      ])
    );
    expect(flags.tableColumnWidthCount).toBe(0);
  });

  it('counts images with a persisted width', () => {
    const flags = detectRichMarkdownFidelityFlags(
      doc([
        {
          type: 'image',
          attrs: { resourceId: 'r1', title: 'A', alt: 'A', width: 480 }
        },
        {
          type: 'image',
          attrs: { resourceId: 'r2', title: 'B', alt: 'B' }
        }
      ])
    );
    expect(flags.resizedImageCount).toBe(1);
  });

  it('counts resourceCards carrying ANY preview-presentation attr and skips default cards', () => {
    const flags = detectRichMarkdownFidelityFlags(
      doc([
        resourceCard({ presentation: 'preview' }),
        resourceCard({ width: 480 }),
        resourceCard({ align: 'center' }),
        resourceCard({ caption: 'Cap' }),
        // Pinned preview height is lost on export, like the other presentation attrs.
        resourceCard({ height: 420 }),
        resourceCard({}),
        resourceCard({
          presentation: 'card',
          width: null,
          height: null,
          align: null,
          caption: null
        })
      ])
    );
    expect(flags.previewFileCardCount).toBe(5);
  });
});

describe('richMarkdownFidelityRequiresConfirm', () => {
  it('is false when only resized images are present (they round-trip losslessly)', () => {
    expect(
      richMarkdownFidelityRequiresConfirm({
        commentMarkCount: 0,
        tableColumnWidthCount: 0,
        alignedImageCount: 0,
        resizedImageCount: 3,
        previewFileCardCount: 0,
      flattenedTableCellCount: 0
      })
    ).toBe(false);
  });

  it('is true when comment marks are present', () => {
    expect(
      richMarkdownFidelityRequiresConfirm({
        commentMarkCount: 1,
        tableColumnWidthCount: 0,
        alignedImageCount: 0,
        resizedImageCount: 0,
        previewFileCardCount: 0,
      flattenedTableCellCount: 0
      })
    ).toBe(true);
  });

  it('is true when table column widths are present', () => {
    expect(
      richMarkdownFidelityRequiresConfirm({
        commentMarkCount: 0,
        tableColumnWidthCount: 1,
        alignedImageCount: 0,
        resizedImageCount: 0,
        previewFileCardCount: 0,
      flattenedTableCellCount: 0
      })
    ).toBe(true);
  });

  it('is true when aligned images are present (schema v3 — alignment has no Markdown form)', () => {
    expect(
      richMarkdownFidelityRequiresConfirm({
        commentMarkCount: 0,
        tableColumnWidthCount: 0,
        alignedImageCount: 1,
        resizedImageCount: 0,
        previewFileCardCount: 0,
      flattenedTableCellCount: 0
      })
    ).toBe(true);
  });

  it('is true when preview file cards are present (schema v5 — presentation attrs have no Markdown form)', () => {
    expect(
      richMarkdownFidelityRequiresConfirm({
        commentMarkCount: 0,
        tableColumnWidthCount: 0,
        alignedImageCount: 0,
        resizedImageCount: 0,
        previewFileCardCount: 1,
      flattenedTableCellCount: 0
      })
    ).toBe(true);
  });
});

describe('buildRichMarkdownReferenceManifest', () => {
  it('collects image/resourceCard resources and taskReference tasks, deduped by id', () => {
    const manifest = buildRichMarkdownReferenceManifest(
      doc([
        {
          type: 'image',
          attrs: { resourceId: 'res-1', title: 'Diagram', alt: 'Diagram', description: 'A picture' }
        },
        {
          type: 'resourceCard',
          attrs: {
            resourceId: 'res-2',
            title: 'Datasheet',
            description: null,
            kind: 'file',
            selector: 'pinned'
          }
        },
        // Same resourceId referenced twice — only the first occurrence should land in the manifest.
        {
          type: 'image',
          attrs: { resourceId: 'res-1', title: 'Diagram (again)', alt: 'Diagram' }
        },
        {
          type: 'taskReference',
          attrs: { taskId: 'task-1', fallbackTitle: 'Ship the thing' }
        }
      ])
    );
    expect(manifest.resources).toEqual([
      {
        resourceId: 'res-1',
        title: 'Diagram',
        description: 'A picture',
        kind: 'file',
        selector: 'latest-approved'
      },
      {
        resourceId: 'res-2',
        title: 'Datasheet',
        description: null,
        kind: 'file',
        selector: 'pinned'
      }
    ]);
    expect(manifest.tasks).toEqual([{ taskId: 'task-1', fallbackTitle: 'Ship the thing' }]);
  });

  it('returns empty arrays for a document with no references', () => {
    const manifest = buildRichMarkdownReferenceManifest(
      doc([{ type: 'paragraph', content: [{ type: 'text', text: 'no refs here' }] }])
    );
    expect(manifest).toEqual({ resources: [], tasks: [] });
  });

  it('collects inline resourceChip references and lets a later card fill a chip-claimed description', () => {
    const manifest = buildRichMarkdownReferenceManifest(
      doc([
        {
          type: 'paragraph',
          content: [
            {
              type: 'resourceChip',
              attrs: {
                resourceId: 'res-3',
                title: 'Example cable',
                kind: 'app_product',
                selector: 'live'
              }
            }
          ]
        },
        // Same resource ALSO embedded as a card carrying a description — the
        // chip claimed the manifest entry first, but the card's description
        // must still land so the card's reimport stays lossless.
        {
          type: 'resourceCard',
          attrs: {
            resourceId: 'res-3',
            title: 'Example cable',
            description: 'Catalog product',
            kind: 'app_product',
            selector: 'live'
          }
        }
      ])
    );
    expect(manifest.resources).toEqual([
      {
        resourceId: 'res-3',
        title: 'Example cable',
        description: 'Catalog product',
        kind: 'app_product',
        selector: 'live'
      }
    ]);
  });
});

describe('describeRichMarkdownFidelityLosses + joinRichFidelityLossParts', () => {
  it('enumerates every destroyed construct with correct pluralization', () => {
    expect(
      describeRichMarkdownFidelityLosses({
        commentMarkCount: 1,
        tableColumnWidthCount: 2,
        alignedImageCount: 1,
        resizedImageCount: 5,
        previewFileCardCount: 2,
      flattenedTableCellCount: 0
      })
    ).toEqual([
      '1 inline comment',
      '2 resized table columns',
      '1 aligned image',
      '2 file preview layouts'
    ]);
  });

  it('never lists resized images (they round-trip losslessly)', () => {
    expect(
      describeRichMarkdownFidelityLosses({
        commentMarkCount: 0,
        tableColumnWidthCount: 0,
        alignedImageCount: 0,
        resizedImageCount: 4,
        previewFileCardCount: 0,
      flattenedTableCellCount: 0
      })
    ).toEqual([]);
  });

  it('joins naturally for one, two, and three parts', () => {
    expect(joinRichFidelityLossParts([])).toBe('');
    expect(joinRichFidelityLossParts(['a'])).toBe('a');
    expect(joinRichFidelityLossParts(['a', 'b'])).toBe('a and b');
    expect(joinRichFidelityLossParts(['a', 'b', 'c'])).toBe('a, b, and c');
  });
});
