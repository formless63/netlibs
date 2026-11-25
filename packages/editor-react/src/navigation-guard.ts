import type { EditorSaveState } from '@formless63/editor-core';

export function editorSourceBufferIsDirty(input: {
  active: boolean;
  initialBuffer: string | null;
  currentBuffer: string;
}): boolean {
  return (
    input.active && input.initialBuffer !== null && input.currentBuffer !== input.initialBuffer
  );
}

export function editorHasUnsavedChanges(input: {
  saveState: EditorSaveState;
  sourceBufferDirty: boolean;
}): boolean {
  return (
    input.sourceBufferDirty ||
    input.saveState === 'dirty' ||
    input.saveState === 'saving' ||
    input.saveState === 'conflict' ||
    input.saveState === 'error'
  );
}
