import type { EditorSaveState } from '@formless63/editor-core';

export const EDITOR_SAVE_MESSAGES: Record<EditorSaveState, string> = {
  idle: 'No unsaved changes',
  dirty: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Saved',
  conflict: 'A newer revision exists. Review or reload before saving again.',
  error: 'Save failed. Your changes remain in this editor.'
};

/**
 * Save-failure messages. A rejected document, an expired session and a denied request need
 * different actions from the person reading them.
 */
export const EDITOR_SAVE_ERROR_MESSAGES = {
  invalidContent: 'This document could not be saved because its content is not valid.',
  unavailable: 'This document could not be saved.',
  sessionExpired:
    'Your session has expired. Sign in again, then retry — your changes are still in this editor and have not been lost.'
} as const;

export function canEditorAutosave(state: EditorSaveState): boolean {
  return state !== 'saving' && state !== 'conflict';
}

/**
 * Rebuilds `editor.getJSON()` output from plain objects. ProseMirror creates `attrs` with a null
 * prototype, which some transport encoders degrade to `null`. Use it on everything that is stored,
 * compared or handed to the host.
 */
export function toPlainEditorJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export interface RichSaveVersionTracker {
  editVersion: number;
  savedVersion: number;
  inFlightVersion: number | null;
}

export function createRichSaveVersionTracker(): RichSaveVersionTracker {
  return { editVersion: 0, savedVersion: 0, inFlightVersion: null };
}

export function markEditorEdited(
  tracker: RichSaveVersionTracker
): RichSaveVersionTracker {
  return { ...tracker, editVersion: tracker.editVersion + 1 };
}

export function beginEditorSave(
  tracker: RichSaveVersionTracker
): RichSaveVersionTracker | null {
  if (tracker.inFlightVersion !== null || tracker.editVersion === tracker.savedVersion) {
    return null;
  }
  return { ...tracker, inFlightVersion: tracker.editVersion };
}

export function finishEditorSave(tracker: RichSaveVersionTracker): {
  tracker: RichSaveVersionTracker;
  state: 'saved' | 'dirty';
} {
  if (tracker.inFlightVersion === null) {
    throw new TypeError('Cannot finish a Rich save that is not in flight');
  }
  const capturedVersion = tracker.inFlightVersion;
  const next = {
    ...tracker,
    savedVersion: capturedVersion,
    inFlightVersion: null
  };
  return {
    tracker: next,
    state: next.editVersion > capturedVersion ? 'dirty' : 'saved'
  };
}

/**
 * Sorts keys, for equality checks only: `getJSON()` and stored documents may order keys
 * differently.
 */
function sortForComparison(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForComparison);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortForComparison(child)])
    );
  }
  return value;
}

/**
 * Deterministic, key-order-independent serialization for comparing an
 * editor-produced document against a stored one. Used by the autosave circuit
 * breaker: if the content the editor is about to save is structurally
 * identical to what was last saved, there is nothing to persist, so a save
 * that was only triggered by a spurious editor "update" event (no real
 * content change) does not mint a new revision.
 */
export function stableStringifyRichContent(value: unknown): string {
  return JSON.stringify(sortForComparison(value));
}

/**
 * The autosave circuit breaker's decision function: true when `next` (what the
 * editor is about to save) is structurally identical to `lastSaved` (what the
 * server already has), meaning the save that's about to run has nothing to
 * persist. Extracted as a pure function so the loop-prevention logic itself —
 * not just the string comparison it's built on — has a direct unit test.
 */
export function editorSaveIsRedundant(next: unknown, lastSaved: unknown): boolean {
  return stableStringifyRichContent(next) === stableStringifyRichContent(lastSaved);
}

/** When the current run of unsaved edits began; null when there is none. */
export interface RichAutosaveScheduleState {
  pendingSinceMs: number | null;
}

export function createRichAutosaveScheduleState(): RichAutosaveScheduleState {
  return { pendingSinceMs: null };
}

/** Call once a pending streak has been flushed (a save has started). */
export function resetRichAutosaveScheduleState(): RichAutosaveScheduleState {
  return createRichAutosaveScheduleState();
}

export type RichAutosaveScheduleDecision =
  | { action: 'schedule'; delayMs: number }
  | { action: 'save-now' };

/**
 * What one edit should do to the autosave timer. Every edit resets the idle countdown; once a
 * streak has lasted `maxIntervalMs` it returns `save-now`. Pure: the caller owns the timer and
 * cancels the previous one first.
 */
export function scheduleRichAutosave(
  state: RichAutosaveScheduleState,
  nowMs: number,
  idleDelayMs: number,
  maxIntervalMs: number
): { state: RichAutosaveScheduleState; decision: RichAutosaveScheduleDecision } {
  const pendingSinceMs = state.pendingSinceMs ?? nowMs;
  const elapsedMs = nowMs - pendingSinceMs;

  if (elapsedMs >= maxIntervalMs) {
    return { state: { pendingSinceMs }, decision: { action: 'save-now' } };
  }
  return { state: { pendingSinceMs }, decision: { action: 'schedule', delayMs: idleDelayMs } };
}
