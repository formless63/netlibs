import { describe, expect, it } from 'bun:test';

import {
  editorHasUnsavedChanges,
  editorSourceBufferIsDirty
} from '../src/navigation-guard.ts';

describe('library editor navigation guard', () => {
  it.each(['dirty', 'saving', 'conflict', 'error'] as const)(
    'blocks navigation while the save state is %s',
    (saveState) => {
      expect(editorHasUnsavedChanges({ saveState, sourceBufferDirty: false })).toBe(true);
    }
  );

  it.each(['idle', 'saved'] as const)(
    'allows navigation while the save state is %s',
    (saveState) => {
      expect(editorHasUnsavedChanges({ saveState, sourceBufferDirty: false })).toBe(false);
    }
  );

  it('blocks an uncommitted Markdown source change independently of save state', () => {
    expect(editorHasUnsavedChanges({ saveState: 'saved', sourceBufferDirty: true })).toBe(
      true
    );
  });

  it('only treats a changed active source buffer as dirty', () => {
    expect(
      editorSourceBufferIsDirty({
        active: true,
        initialBuffer: '# Before',
        currentBuffer: '# After'
      })
    ).toBe(true);
    expect(
      editorSourceBufferIsDirty({
        active: false,
        initialBuffer: '# Before',
        currentBuffer: '# After'
      })
    ).toBe(false);
    expect(
      editorSourceBufferIsDirty({
        active: true,
        initialBuffer: null,
        currentBuffer: '# After'
      })
    ).toBe(false);
  });
});
