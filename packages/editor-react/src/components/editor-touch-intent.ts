'use client';

import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

/**
 * When floating menus may show.
 *
 * ## Touch
 *
 * Menus react to the selection. With a finger, scrolling and dismissing the keyboard also move the
 * selection, so on a coarse pointer menus wait for a deliberate tap:
 *
 * - scrolling disarms, unmounting menus at once;
 * - a gesture ending at least `RICH_TOUCH_MENU_SETTLE_MS` after the last scroll arms;
 * - armed stays armed until the next scroll.
 *
 * Only `scroll` disarms: dragging a selection handle emits `touchmove` too. On a fine pointer this
 * gate is always open and attaches no listeners.
 *
 * Consumers unmount rather than use `shouldShow`, which is only re-evaluated on transactions. The
 * drag-handle and table menus need no gate.
 *
 * ## Dismissal
 *
 * ProseMirror keeps its selection on blur, so a second latch, on every pointer type, dismisses
 * menus:
 *
 * - `Escape` (not already prevented) or a press outside the editor dismisses;
 * - a press on a menu changes nothing;
 * - a press inside the editor, or a selection change, re-arms.
 *
 * Focus returns to the editor only for `Escape`.
 */

/**
 * How long the page must be free of scroll events before a gesture end can
 * arm the gate. Long enough to cover the gap between a flick's `touchend`
 * and the first momentum `scroll` frame; short enough that a deliberate tap
 * after a scroll has visibly stopped feels immediate.
 */
export const RICH_TOUCH_MENU_SETTLE_MS = 400;

export interface RichTouchMenuState {
  /** Whether floating menus may currently appear. */
  armed: boolean;
  /** Timestamp of the most recent scroll event; `null` = none seen yet. */
  lastScrollAt: number | null;
}

export type RichTouchMenuEvent =
  /** Any scroll, in the window or a nested scroller (listened to in capture phase). */
  | { type: 'scroll'; at: number }
  /** A `pointerup`/`touchend` — a gesture that completed rather than being cancelled. */
  | { type: 'gesture-end'; at: number };

export function richTouchMenuInitialState(): RichTouchMenuState {
  return { armed: false, lastScrollAt: null };
}

/**
 * Pure gate state machine — exported so `editor-touch-intent.test.ts`
 * can drive the policy without a DOM or a live editor.
 */
export function richTouchMenuReducer(
  state: RichTouchMenuState,
  event: RichTouchMenuEvent,
  settleMs: number = RICH_TOUCH_MENU_SETTLE_MS
): RichTouchMenuState {
  switch (event.type) {
    case 'scroll':
      return { armed: false, lastScrollAt: event.at };
    case 'gesture-end': {
      // A gesture that ended while the page is still settling from a scroll
      // is the tail of that scroll (flick lift-off, or a tap to halt
      // momentum) — not an intent to open anything.
      const settled = state.lastScrollAt === null || event.at - state.lastScrollAt >= settleMs;
      return settled === state.armed ? state : { ...state, armed: settled };
    }
    default:
      return state;
  }
}

/**
 * Module-level singleton so N mounted menus share ONE set of window
 * listeners (six floating surfaces are mounted at once in a rich-text
 * document) and so the gate survives a menu unmounting and remounting —
 * which is exactly what this gate makes happen.
 *
 * Subscribers are notified only when `armed` actually flips, never on every
 * scroll frame: `lastScrollAt` churns inside the state object but is not
 * part of the published snapshot, so a momentum scroll does not re-render
 * the editor 60 times a second.
 */
let gateState = richTouchMenuInitialState();
const gateListeners = new Set<() => void>();
let detachGateListeners: (() => void) | null = null;

function dispatchGateEvent(event: RichTouchMenuEvent): void {
  const next = richTouchMenuReducer(gateState, event);
  const flipped = next.armed !== gateState.armed;
  gateState = next;
  if (!flipped) return;
  for (const listener of gateListeners) listener();
}

function attachGateListeners(): () => void {
  const onScroll = () => dispatchGateEvent({ type: 'scroll', at: Date.now() });
  const onGestureEnd = () => dispatchGateEvent({ type: 'gesture-end', at: Date.now() });
  // Capture phase: `scroll` does not bubble from a nested scroll container,
  // and the editor lives inside one (`section.overflow-hidden` + the app
  // shell's own scroller).
  window.addEventListener('scroll', onScroll, { capture: true, passive: true });
  window.addEventListener('pointerup', onGestureEnd, { capture: true, passive: true });
  // `touchend` as well as `pointerup`: a touch that the browser converts
  // into a scroll fires `pointercancel` (never `pointerup`) but still fires
  // `touchend`, and we want the settle-window check to run for that case
  // too rather than silently leaving the gate at whatever it was.
  window.addEventListener('touchend', onGestureEnd, { capture: true, passive: true });
  return () => {
    window.removeEventListener('scroll', onScroll, { capture: true });
    window.removeEventListener('pointerup', onGestureEnd, { capture: true });
    window.removeEventListener('touchend', onGestureEnd, { capture: true });
  };
}

function subscribeToTouchGate(listener: () => void): () => void {
  gateListeners.add(listener);
  if (gateListeners.size === 1 && typeof window !== 'undefined') {
    detachGateListeners = attachGateListeners();
  }
  return () => {
    gateListeners.delete(listener);
    if (gateListeners.size === 0 && detachGateListeners) {
      detachGateListeners();
      detachGateListeners = null;
      // Start the next editor closed rather than armed from a page the user has left.
      gateState = richTouchMenuInitialState();
    }
  };
}

function getTouchGateSnapshot(): boolean {
  return gateState.armed;
}

/** Fine-pointer (and SSR) snapshot: the gate does not exist. */
function getOpenSnapshot(): boolean {
  return true;
}

function subscribeNever(): () => void {
  return () => {};
}

/* ------------------------------------------------------------------ *
 * Dismissal latch — see the module comment's
 * "The dismissal latch" table for the policy this implements.
 * ------------------------------------------------------------------ */

/** Where a `pointerdown` landed, relative to the editor's surfaces. */
export type EditorMenuPointerRegion =
  /** On a floating menu itself (`[data-editor-menu]`). */
  | 'menu'
  /** Inside a registered editor content surface. */
  | 'editor'
  /** Anywhere else on the page. */
  | 'outside';

export type EditorMenuDismissEvent =
  | { type: 'escape' }
  | { type: 'pointer-down'; region: EditorMenuPointerRegion }
  /** The selection changed. */
  | { type: 'selection-change' };

export interface EditorMenuDismissState {
  /**
   * `null` = menus may show. The cause is retained because only the
   * `'escape'` path returns focus to the editor.
   */
  dismissedBy: 'escape' | 'outside' | null;
}

export function editorMenuDismissInitialState(): EditorMenuDismissState {
  return { dismissedBy: null };
}

/**
 * Pure dismissal state machine — exported so the policy is testable without
 * a DOM or a live editor, exactly like `richTouchMenuReducer` above.
 */
export function editorMenuDismissReducer(
  state: EditorMenuDismissState,
  event: EditorMenuDismissEvent
): EditorMenuDismissState {
  switch (event.type) {
    case 'escape':
      return state.dismissedBy === 'escape' ? state : { dismissedBy: 'escape' };
    case 'selection-change':
      return state.dismissedBy === null ? state : { dismissedBy: null };
    case 'pointer-down':
      switch (event.region) {
        // Pressing a menu's own buttons is not a dismissal.
        case 'menu':
          return state;
        case 'editor':
          return state.dismissedBy === null ? state : { dismissedBy: null };
        case 'outside':
          return state.dismissedBy === 'outside' ? state : { dismissedBy: 'outside' };
        default:
          return state;
      }
    default:
      return state;
  }
}

/** Marker attribute every gated floating surface puts on its root element. */
export const EDITOR_MENU_ATTR = 'data-editor-menu';

/**
 * Classify a pointer target. `hosts` is the set of live editor content DOMs
 * (`editor.view.dom`) registered by mounted menus — a Set rather than a
 * single element because a page can hold more than one editor surface, and
 * because the hook that registers them is per-menu.
 */
export function classifyEditorMenuPointerRegion(
  target: EventTarget | null,
  hosts: Iterable<HTMLElement>
): EditorMenuPointerRegion {
  const node = target instanceof Node ? target : null;
  if (!node) return 'outside';
  const element = node instanceof Element ? node : node.parentElement;
  if (element?.closest(`[${EDITOR_MENU_ATTR}]`)) return 'menu';
  for (const host of hosts) {
    if (host.contains(node)) return 'editor';
  }
  return 'outside';
}

let dismissState = editorMenuDismissInitialState();
const dismissListeners = new Set<() => void>();
const editorHosts = new Set<HTMLElement>();
let detachDismissListeners: (() => void) | null = null;

function dispatchDismissEvent(event: EditorMenuDismissEvent): void {
  const next = editorMenuDismissReducer(dismissState, event);
  if (next === dismissState) return;
  dismissState = next;
  for (const listener of dismissListeners) listener();
}

function attachDismissListeners(): () => void {
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || event.isComposing) return;
    // Bubble phase, and `defaultPrevented` is respected: a field inside a menu handles Escape
    // itself.
    if (event.defaultPrevented) return;
    dispatchDismissEvent({ type: 'escape' });
  };
  const onPointerDown = (event: PointerEvent) => {
    dispatchDismissEvent({
      type: 'pointer-down',
      region: classifyEditorMenuPointerRegion(event.target, editorHosts)
    });
  };
  window.addEventListener('keydown', onKeyDown);
  // Capture phase: the click that lands inside the editor has to re-arm the
  // gate BEFORE ProseMirror resolves it into a selection, or the transaction
  // it produces would be evaluated against a still-dismissed latch.
  window.addEventListener('pointerdown', onPointerDown, { capture: true, passive: true });
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('pointerdown', onPointerDown, { capture: true });
  };
}

function subscribeToDismissLatch(listener: () => void): () => void {
  dismissListeners.add(listener);
  if (dismissListeners.size === 1 && typeof window !== 'undefined') {
    detachDismissListeners = attachDismissListeners();
  }
  return () => {
    dismissListeners.delete(listener);
    if (dismissListeners.size === 0 && detachDismissListeners) {
      detachDismissListeners();
      detachDismissListeners = null;
      dismissState = editorMenuDismissInitialState();
    }
  };
}

function getDismissSnapshot(): EditorMenuDismissState['dismissedBy'] {
  return dismissState.dismissedBy;
}

function getDismissServerSnapshot(): EditorMenuDismissState['dismissedBy'] {
  return null;
}

/** Test seam — resets the module singletons between cases. */
export function resetRichTouchMenuGateForTests(): void {
  gateState = richTouchMenuInitialState();
  dismissState = editorMenuDismissInitialState();
  editorHosts.clear();
}

/**
 * `(pointer: coarse)` + `(hover: none)` is the touch signal, not a width
 * breakpoint (see the module comment). `hover: none` is ORed rather than
 * ANDed so a hybrid touch laptop — coarse primary pointer but a real hover
 * capability — still counts as touch for menu-triggering purposes, which is
 * the conservative direction: worst case a laptop user needs one extra tap.
 *
 * Defaults to `false` (desktop, no gating) whenever `matchMedia` is
 * unavailable — jsdom does not implement it, and the surrounding editor
 * components are mounted bare in several composition tests.
 */
export function useRichCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    let queries: MediaQueryList[];
    try {
      queries = [window.matchMedia('(pointer: coarse)'), window.matchMedia('(hover: none)')];
    } catch {
      return;
    }
    const update = () => setCoarse(queries.some((query) => query.matches));
    update();
    for (const query of queries) query.addEventListener('change', update);
    return () => {
      for (const query of queries) query.removeEventListener('change', update);
    };
  }, []);
  return coarse;
}

export interface EditorMenuGate {
  /** True when the current pointer is touch-like and the arming policy applies. */
  coarsePointer: boolean;
  /** False = the caller must render nothing at all this frame. */
  allowed: boolean;
}

/**
 * The hook every auto-appearing floating menu in the editor consumes.
 *
 * Pass the live editor: it registers `editor.view.dom` as a pointer host (so
 * a click inside the document re-arms rather than dismisses) and clears the
 * dismissal latch on the editor's own `selectionUpdate`. Called without one
 * (or before the editor exists) the dismissal policy still works — the
 * editor's whole surface just classifies as `'outside'`, which is the
 * conservative direction: a stray click closes the menu.
 */
export function useEditorMenuGate(editor?: Editor | null): EditorMenuGate {
  const coarsePointer = useRichCoarsePointer();
  const subscribe = useCallback(
    (listener: () => void) => (coarsePointer ? subscribeToTouchGate(listener) : subscribeNever()),
    [coarsePointer]
  );
  const getSnapshot = useCallback(
    () => (coarsePointer ? getTouchGateSnapshot() : true),
    [coarsePointer]
  );
  const armed = useSyncExternalStore(subscribe, getSnapshot, getOpenSnapshot);
  const dismissedBy = useSyncExternalStore(
    subscribeToDismissLatch,
    getDismissSnapshot,
    getDismissServerSnapshot
  );

  useEffect(() => {
    if (!editor) return;
    const host = editor.view.dom as HTMLElement;
    editorHosts.add(host);
    const onSelectionUpdate = () => dispatchDismissEvent({ type: 'selection-change' });
    editor.on('selectionUpdate', onSelectionUpdate);
    return () => {
      editorHosts.delete(host);
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [editor]);

  // Escape must not strand focus on `<body>` when the focused field unmounts. An outside click must
  // not pull focus back.
  useEffect(() => {
    if (dismissedBy !== 'escape' || !editor) return;
    const host = editor.view.dom as HTMLElement;
    const active = typeof document === 'undefined' ? null : document.activeElement;
    if (active && host.contains(active)) return;
    editor.commands.focus();
  }, [dismissedBy, editor]);

  return { coarsePointer, allowed: armed && dismissedBy === null };
}

export interface RichMarksMenuVisibilityInput {
  /** `state.selection.empty` — a collapsed caret. */
  selectionEmpty: boolean;
  /** `selection instanceof NodeSelection` — a whole node is selected, not text. */
  nodeSelection: boolean;
  isTable: boolean;
  isLink: boolean;
  isImage: boolean;
}

/**
 * When the selection toolbar shows. One menu per kind of selection, and never for a node selection:
 * atoms have no text to format, and a block drag leaves one behind.
 */
export function richMarksMenuShouldShow(input: RichMarksMenuVisibilityInput): boolean {
  if (input.selectionEmpty) return false;
  if (input.isTable || input.isLink || input.isImage) return false;
  if (input.nodeSelection) return false;
  return true;
}
