import { describe, expect, it } from 'bun:test';

import {
  createRichAutosaveScheduleState,
  resetRichAutosaveScheduleState,
  scheduleRichAutosave,
  toPlainEditorJson
} from '../src/save-state.ts';

/**
 * `toPlainEditorJson`: ProseMirror's null-prototype `attrs` can be degraded to `null` by structured
 * transports.
 */
describe('toPlainEditorJson', () => {
  it('rebuilds a null-prototype object into an ordinary Object.prototype object', () => {
    const nullProto = Object.assign(Object.create(null), { level: 1, anchorId: null });
    expect(Object.getPrototypeOf(nullProto)).toBeNull();

    const plain = toPlainEditorJson({ attrs: nullProto });
    expect(Object.getPrototypeOf(plain.attrs)).toBe(Object.prototype);
    expect(plain.attrs).toEqual({ level: 1, anchorId: null });
  });

  it('is a no-op for content that is already an ordinary plain object', () => {
    const value = { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: null } }] };
    expect(toPlainEditorJson(value)).toEqual(value);
  });
});

/**
 * A completed self-save's only two reachable outcomes are `'saved'` and
 * `'dirty'` (never `'idle'`, never a distinct "reinitializing" state) — see
 * `EditorSaveState` in `./types` and `finishEditorSave` below.
 * That closed state space is what makes it safe for
 * `rich-document-editor.tsx` to apply a self-save's result in place
 * (adopting `result.revisionId` into a ref) instead of remounting: nothing in
 * this machine ever asks the caller to throw away and recreate the Tiptap
 * instance. The actual remount trigger this fix removes lived one layer up,
 * in `rich-editor-actions.ts`'s `saveRichDocumentRevision` — it no
 * longer calls `revalidatePath` on the reader route the editor is mounted on,
 * so the Server Component never re-renders with a new `revision.id` mid-save,
 * and `rich-document-reader.tsx`'s `key={view.revision.id}` on
 * `<RichDocumentEditor>` never changes value during a self-save. (It still
 * changes — intentionally — for `restoreRichDocumentRevisionAction`, which
 * pairs its own `revalidatePath` with an explicit client `router.refresh()`
 * because discarding the live buffer is exactly what a restore should do.)
 */
/**
 * The autosave scheduler. Every edit resets the idle timer, and a long unbroken streak still forces
 * a checkpoint.
 */
describe('scheduleRichAutosave', () => {
  it('schedules the full idle delay for the first edit in a streak', () => {
    const state = createRichAutosaveScheduleState();
    const { state: next, decision } = scheduleRichAutosave(state, 0, 1500, 30_000);

    expect(decision).toEqual({ action: 'schedule', delayMs: 1500 });
    expect(next.pendingSinceMs).toBe(0);
  });

  it('resets to the full idle delay on every subsequent edit, not the remaining time', () => {
    let state = createRichAutosaveScheduleState();
    ({ state } = scheduleRichAutosave(state, 0, 1500, 30_000));

    // A keystroke 200ms later — well before the first edit's 1500ms timer
    // would have fired. A naive "don't touch a live timer" bug would let the
    // original deadline (t=1500) stand; the correct idle contract instead
    // reports the full delay again from *this* edit (effectively t=1700),
    // which is what lets the caller cancel-and-restart its real setTimeout.
    const second = scheduleRichAutosave(state, 200, 1500, 30_000);
    expect(second.decision).toEqual({ action: 'schedule', delayMs: 1500 });

    // The streak's start time is unchanged — only the max-interval clock
    // tracks streak age; the idle delay itself is always the full amount.
    expect(second.state.pendingSinceMs).toBe(0);
  });

  it('keeps returning schedule for a burst of edits under the max interval', () => {
    let state = createRichAutosaveScheduleState();
    let decision;
    for (const t of [0, 500, 1000, 5000, 10_000, 20_000, 29_999]) {
      ({ state, decision } = scheduleRichAutosave(state, t, 1500, 30_000));
      expect(decision).toEqual({ action: 'schedule', delayMs: 1500 });
    }
  });

  it('forces a save once the streak has run for the max interval, even mid-typing', () => {
    let state = createRichAutosaveScheduleState();
    ({ state } = scheduleRichAutosave(state, 0, 1500, 30_000));

    const atLimit = scheduleRichAutosave(state, 30_000, 1500, 30_000);
    expect(atLimit.decision).toEqual({ action: 'save-now' });

    const pastLimit = scheduleRichAutosave(state, 45_000, 1500, 30_000);
    expect(pastLimit.decision).toEqual({ action: 'save-now' });
  });

  it('starts a fresh max-interval clock after a reset (a save has flushed the streak)', () => {
    let state = createRichAutosaveScheduleState();
    ({ state } = scheduleRichAutosave(state, 0, 1500, 30_000));
    ({ state } = scheduleRichAutosave(state, 30_000, 1500, 30_000));
    expect(state.pendingSinceMs).toBe(0);

    state = resetRichAutosaveScheduleState();
    expect(state.pendingSinceMs).toBeNull();

    // The next edit after a reset starts a brand new streak at its own
    // timestamp, not still counting from the flushed streak's start.
    const afterReset = scheduleRichAutosave(state, 30_100, 1500, 30_000);
    expect(afterReset.decision).toEqual({ action: 'schedule', delayMs: 1500 });
    expect(afterReset.state.pendingSinceMs).toBe(30_100);
  });

  it('treats a streak resumed with no active pending state as starting now', () => {
    const state = createRichAutosaveScheduleState();
    const { state: next, decision } = scheduleRichAutosave(state, 12_345, 1500, 30_000);

    expect(decision).toEqual({ action: 'schedule', delayMs: 1500 });
    expect(next.pendingSinceMs).toBe(12_345);
  });
});
