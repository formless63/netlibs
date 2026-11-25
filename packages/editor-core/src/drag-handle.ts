/**
 * Block drag handles: a grip in the left gutter of every top-level block.
 *
 * The gesture uses plain mouse events, not HTML5 drag-and-drop: the handle sits outside the
 * contenteditable DOM, so ProseMirror would never see its `dragstart` and a drop would copy instead
 * of move. On release, `applyRichBlockMove` performs one delete-and-insert, which preserves
 * identity and validity.
 *
 * `@tiptap/extension-drag-handle` is not used because it requires the Yjs packages and commits
 * through native drag-and-drop.
 */

import { Extension, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { DecorationSet, type EditorView } from '@tiptap/pm/view';

import type { DocumentLinkTarget } from './stable-link.ts';
import { applyRichBlockMove } from './block-move.ts';

export const RICH_DRAG_HANDLE_CLASS = 'rich-drag-handle';
export const RICH_DRAG_INDICATOR_CLASS = 'rich-drag-drop-indicator';

/**
 * Clicking the grip (rather than dragging it) opens a menu. This module only detects the click and
 * emits an event; `EditorDragHandleMenu` owns the UI and calls the primitives in `block-move.ts`.
 */
export const RICH_DRAG_HANDLE_MENU_EVENT = 'rich-drag-handle-menu';

export interface RichDragHandleMenuOpenDetail {
  /** Top-level block position the menu's actions should target. */
  pos: number;
  rect: { left: number; bottom: number };
}

/**
 * One step of a "Turn into" transform. `slash` steps run the same commands as the slash menu;
 * two-step sequences lift, then wrap, where one hop is not possible. `lift-callout` runs
 * `unsetRichCallout`, since callouts have no toggle.
 *
 * The matrix is pure so it can be tested without React; the runner lives in the menu component.
 */
export type RichDragHandleTurnIntoStep =
  | { kind: 'slash'; id: string }
  | { kind: 'lift-callout' };

export interface RichDragHandleTurnIntoOption {
  /** Stable option identity for UI keys and tests. */
  id: string;
  label: string;
  steps: readonly RichDragHandleTurnIntoStep[];
}

/**
 * True when the block's inline content is plain text only — no inline atoms
 * (`inlineMath`, etc.). Code blocks hold `text*`, so ProseMirror's
 * `setBlockType` would silently DROP any non-text inline on conversion;
 * rather than offer a lossy transform, "Code block" is withheld from the
 * turn-into options for such content.
 */
function blockInlineContentIsPlainText(node: ProseMirrorNode): boolean {
  let plain = true;
  node.descendants((child) => {
    if (child.isInline && !child.isText) plain = false;
    return plain;
  });
  return plain;
}

/**
 * The "Turn into" transforms valid for `node` (a TOP-LEVEL block — the same
 * node `RichDragHandleMenuOpenDetail.pos` targets). Empty for block types
 * with no sensible conversions (table, details, image, math, resource cards,
 * children index, horizontal rule) — the menu simply omits the section.
 *
 * Matrix rationale:
 * - Textblocks (paragraph / heading / codeBlock) interconvert freely and can
 *   be wrapped into lists, quotes, and callouts — Tiptap's `toggleList`
 *   `clearNodes()`s a heading/codeBlock down to a paragraph first when the
 *   list item can't hold it, so those are one slash step each.
 * - bullet ↔ numbered convert in place (`toggleList` remaps the list node —
 *   both hold `listItem`s, nesting preserved). Conversions involving TASK
 *   lists can't (different item type), so they compose lift-then-wrap: run
 *   the SOURCE list's own toggle (lifts every selected item to paragraphs),
 *   then the target list's toggle (wraps them back). Same two commands the
 *   slash menu ships, sequenced.
 * - blockquote/callout offer paragraph (lift) and each other (lift + wrap).
 *   Headings/lists are NOT offered from containers: their content is block-level
 *   (possibly multiple paragraphs), and a container→heading conversion is not
 *   well-defined for that shape.
 */
const slash = (id: string): RichDragHandleTurnIntoStep => ({ kind: 'slash', id });

export function richDragHandleTurnIntoOptions(
  node: ProseMirrorNode
): RichDragHandleTurnIntoOption[] {
  const type = node.type.name;
  const options: RichDragHandleTurnIntoOption[] = [];
  const push = (id: string, label: string, ...steps: RichDragHandleTurnIntoStep[]): void => {
    options.push({ id, label, steps });
  };

  switch (type) {
    case 'paragraph':
    case 'heading':
    case 'codeBlock': {
      // "Paragraph" for a non-paragraph textblock = toggle the source's own
      // slash command off (toggleHeading/toggleCodeBlock semantics).
      if (type === 'heading') {
        push('paragraph', 'Paragraph', slash(`heading-${node.attrs.level as number}`));
      }
      if (type === 'codeBlock') push('paragraph', 'Paragraph', slash('code-block'));
      for (const level of [1, 2, 3] as const) {
        if (type === 'heading' && node.attrs.level === level) continue;
        push(`heading-${level}`, `Heading ${level}`, slash(`heading-${level}`));
      }
      push('bullet-list', 'Bulleted list', slash('bullet-list'));
      push('numbered-list', 'Numbered list', slash('numbered-list'));
      push('task-list', 'Task list', slash('task-list'));
      push('quote', 'Quote', slash('quote'));
      push('callout', 'Callout', slash('callout-note'));
      if (type !== 'codeBlock' && blockInlineContentIsPlainText(node)) {
        push('code-block', 'Code block', slash('code-block'));
      }
      return options;
    }
    case 'bulletList':
      push('paragraph', 'Paragraph', slash('bullet-list'));
      push('numbered-list', 'Numbered list', slash('numbered-list'));
      push('task-list', 'Task list', slash('bullet-list'), slash('task-list'));
      return options;
    case 'orderedList':
      push('paragraph', 'Paragraph', slash('numbered-list'));
      push('bullet-list', 'Bulleted list', slash('bullet-list'));
      push('task-list', 'Task list', slash('numbered-list'), slash('task-list'));
      return options;
    case 'taskList':
      push('paragraph', 'Paragraph', slash('task-list'));
      push('bullet-list', 'Bulleted list', slash('task-list'), slash('bullet-list'));
      push('numbered-list', 'Numbered list', slash('task-list'), slash('numbered-list'));
      return options;
    case 'blockquote':
      push('paragraph', 'Paragraph', slash('quote'));
      push('callout', 'Callout', slash('quote'), slash('callout-note'));
      return options;
    case 'callout':
      push('paragraph', 'Paragraph', { kind: 'lift-callout' });
      push('quote', 'Quote', { kind: 'lift-callout' }, slash('quote'));
      return options;
    default:
      return [];
  }
}

/** Inserts an empty paragraph beside the top-level block at `pos` and places the caret in it. */
export function insertRichBlockAdjacentParagraph(
  editor: Editor,
  pos: number,
  side: 'above' | 'below'
): boolean {
  if (pos < 0 || pos >= editor.state.doc.content.size) return false;
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return false;
  const at = side === 'above' ? pos : pos + node.nodeSize;
  return editor
    .chain()
    .insertContentAt(at, { type: 'paragraph' }, { updateSelection: false })
    .setTextSelection(at + 1)
    .focus()
    .run();
}

/**
 * Stable link target for one block: its document plus the block's `blockId`
 * as the anchor. The host resolver turns it into a URL, and the renderer can
 * emit matching anchors (`blockAnchors`). Null when the block carries no id.
 */
export function richBlockLinkTarget(
  documentId: string,
  node: ProseMirrorNode
): DocumentLinkTarget | null {
  const blockId = node.attrs?.blockId;
  if (typeof blockId !== 'string' || blockId.length === 0) return null;
  return { documentId, anchor: blockId };
}

/** Euclidean pointer travel, in CSS px, below which a mousedown→mouseup pair counts as a click rather than a drag. */
const DRAG_CLICK_THRESHOLD_PX = 4;

/**
 * Whether `target` is the handle or inside it. The handle is a sibling of `view.dom`, so a
 * descendant check alone cannot tell.
 */
export function isRichDragHandleHoverTarget(target: Node, handle: HTMLElement): boolean {
  return target === handle || handle.contains(target);
}

const richDragHandlePluginKey = new PluginKey('richBlockDragHandle');

/**
 * The document position of the top-level block rendered by a direct child of `view.dom`, or null.
 *
 * `view.posAtDOM(el, 0)` alone is off by one for elements with content: it points inside the block,
 * so `nodeAt` returns the first child. `resolve(raw).before(1)` maps back to the block; a depth-0
 * result is already right.
 */
export function resolveRichTopLevelBlockPos(view: EditorView, el: HTMLElement): number | null {
  const raw = view.posAtDOM(el, 0);
  if (raw < 0 || raw > view.state.doc.content.size) return null;
  const $pos = view.state.doc.resolve(raw);
  const pos = $pos.depth > 0 ? $pos.before(1) : raw;
  return view.state.doc.nodeAt(pos) ? pos : null;
}

/**
 * Vertical slack, in CSS px, for the gutter-hover fallback below: hovering
 * the left gutter/padding at a Y within this distance of a block still
 * anchors the handle to that block (covers the margin strips between
 * blocks so the handle doesn't flicker off while traveling the gutter).
 */
const GUTTER_HOVER_SLACK_PX = 24;

/**
 * The block index in `blocks` a gutter-hover at host-relative `hostY` should
 * anchor the handle to, or `null` when the pointer is vertically nowhere
 * near any block (beyond `GUTTER_HOVER_SLACK_PX` of every block's extent).
 * Pure — exported for unit coverage like the other geometry helpers here.
 */
export function findRichGutterHoverIndex(
  blocks: readonly TopLevelBlockRect[],
  hostY: number
): number | null {
  let best: number | null = null;
  let bestDistance = Infinity;
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    if (hostY >= block.top && hostY <= block.bottom) return index;
    const distance = hostY < block.top ? block.top - hostY : hostY - block.bottom;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return bestDistance <= GUTTER_HOVER_SLACK_PX ? best : null;
}

interface TopLevelBlockRect {
  pos: number;
  size: number;
  top: number;
  bottom: number;
}

/** Every direct child of `doc`, in document order, with its viewport-relative vertical extent within `hostRect`. */
function collectTopLevelBlocks(view: EditorView, hostRect: DOMRect): TopLevelBlockRect[] {
  const blocks: TopLevelBlockRect[] = [];
  view.state.doc.forEach((node, offset) => {
    const dom = view.nodeDOM(offset);
    if (!(dom instanceof HTMLElement)) return;
    const rect = dom.getBoundingClientRect();
    blocks.push({
      pos: offset,
      size: node.nodeSize,
      top: rect.top - hostRect.top,
      bottom: rect.bottom - hostRect.top
    });
  });
  return blocks;
}

/**
 * Index into `blocks` the pointer at `clientY` (already host-relative) is
 * hovering the "insert before" gap for — `blocks.length` means "insert at
 * the very end." Exported for the pure unit test coverage; takes already-host-relative
 * `hostY` rather than raw `clientY` so it needs no DOM/EditorView at all.
 */
export function computeRichDropIndex(
  blocks: readonly TopLevelBlockRect[],
  hostY: number
): number {
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index]!;
    const midpoint = block.top + (block.bottom - block.top) / 2;
    if (hostY < midpoint) return index;
  }
  return blocks.length;
}

/** The raw pre-drag document position `dropIndex` resolves to (see `applyRichBlockMove`'s `targetPos`). */
export function resolveRichDropTargetPos(
  blocks: readonly TopLevelBlockRect[],
  dropIndex: number,
  docContentSize: number
): number {
  if (dropIndex >= blocks.length) {
    const last = blocks[blocks.length - 1];
    return last ? last.pos + last.size : docContentSize;
  }
  return blocks[dropIndex]!.pos;
}

function createRichDragHandleView(view: EditorView, isEditable: () => boolean) {
  const host = view.dom.parentElement;
  if (!host) return {};
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';

  const handle = document.createElement('div');
  handle.className = RICH_DRAG_HANDLE_CLASS;
  handle.contentEditable = 'false';
  handle.setAttribute('role', 'button');
  handle.setAttribute('aria-label', 'Drag to reorder block');
  handle.tabIndex = -1;
  handle.style.display = 'none';
  const grip = document.createElement('span');
  grip.setAttribute('aria-hidden', 'true');
  grip.textContent = '⠿';
  handle.appendChild(grip);
  host.appendChild(handle);

  const indicator = document.createElement('div');
  indicator.className = RICH_DRAG_INDICATOR_CLASS;
  indicator.style.display = 'none';
  host.appendChild(indicator);

  let hoveredPos: number | null = null;
  let dragging = false;
  let blocksSnapshot: TopLevelBlockRect[] = [];
  let dropIndex = -1;
  // Click-vs-drag detection for the context menu (see
  // `RICH_DRAG_HANDLE_MENU_EVENT` above) — reset on every mousedown,
  // latched true the first time the pointer travels past the click
  // threshold. A plain click (never latched) opens the menu instead of
  // committing a (no-op) move.
  let downClientX = 0;
  let downClientY = 0;
  let movedPastClickThreshold = false;

  function hideHandle(): void {
    if (dragging) return;
    handle.style.display = 'none';
    hoveredPos = null;
  }

  function onHoverMove(event: MouseEvent): void {
    if (!isEditable() || dragging) return;
    const target = event.target as HTMLElement | null;
    if (!target) {
      hideHandle();
      return;
    }
    // The handle is a sibling of `view.dom`, so it never matches the descendant walk below. Keep
    // the current anchor, or it would hide as the pointer reaches it.
    if (isRichDragHandleHoverTarget(target, handle)) return;
    let el: HTMLElement | null = target;
    while (el && el.parentElement !== view.dom) el = el.parentElement;
    if (!el || !view.dom.contains(el)) {
      // The pointer may be in the gutter or between blocks. Anchor to the block at its Y position
      // so the path to the handle stays live; hide only when no block is near.
      if (!host!.contains(target)) {
        hideHandle();
        return;
      }
      const hostRect = host!.getBoundingClientRect();
      const blocks = collectTopLevelBlocks(view, hostRect);
      const index = findRichGutterHoverIndex(blocks, event.clientY - hostRect.top);
      if (index === null) {
        hideHandle();
        return;
      }
      const block = blocks[index]!;
      hoveredPos = block.pos;
      handle.style.display = 'flex';
      handle.style.top = `${block.top}px`;
      return;
    }
    const pos = resolveRichTopLevelBlockPos(view, el);
    if (pos === null) {
      hideHandle();
      return;
    }
    hoveredPos = pos;
    const rect = el.getBoundingClientRect();
    const hostRect = host!.getBoundingClientRect();
    handle.style.display = 'flex';
    handle.style.top = `${rect.top - hostRect.top}px`;
  }

  function renderIndicator(index: number): void {
    if (blocksSnapshot.length === 0) {
      indicator.style.display = 'none';
      return;
    }
    const top =
      index >= blocksSnapshot.length
        ? blocksSnapshot[blocksSnapshot.length - 1]!.bottom
        : blocksSnapshot[index]!.top;
    indicator.style.display = 'block';
    indicator.style.top = `${top}px`;
  }

  function commitMove(sourcePos: number, targetIndex: number): void {
    const { state, dispatch } = view;
    const targetPos = resolveRichDropTargetPos(
      blocksSnapshot,
      targetIndex,
      state.doc.content.size
    );
    const tr = state.tr;
    if (!applyRichBlockMove(tr, sourcePos, targetPos)) return;
    const selectionPos = Math.min(tr.mapping.map(targetPos), tr.doc.content.size);
    const resolved = tr.doc.resolve(selectionPos);
    const nodeAfter = resolved.nodeAfter as ProseMirrorNode | null;
    if (nodeAfter) tr.setSelection(NodeSelection.create(tr.doc, selectionPos));
    dispatch(tr);
    view.focus();
  }

  /** Reads `hoveredPos` (the block the grip is currently anchored to) and the grip's own live rect — dispatched on a plain click, never a drag. */
  function openContextMenu(): void {
    if (hoveredPos === null) return;
    const rect = handle.getBoundingClientRect();
    const detail: RichDragHandleMenuOpenDetail = {
      pos: hoveredPos,
      rect: { left: rect.left, bottom: rect.bottom }
    };
    view.dom.dispatchEvent(
      new CustomEvent<RichDragHandleMenuOpenDetail>(RICH_DRAG_HANDLE_MENU_EVENT, { detail })
    );
  }

  function endDrag(commit: boolean): void {
    const sourcePos = hoveredPos;
    dragging = false;
    indicator.style.display = 'none';
    handle.classList.remove(`${RICH_DRAG_HANDLE_CLASS}--active`);
    window.removeEventListener('mousemove', onDragMove);
    window.removeEventListener('mouseup', onDragEnd);
    if (commit && sourcePos !== null && dropIndex >= 0) commitMove(sourcePos, dropIndex);
    hideHandle();
  }

  function onDragMove(event: MouseEvent): void {
    if (!movedPastClickThreshold) {
      const dx = event.clientX - downClientX;
      const dy = event.clientY - downClientY;
      if (Math.hypot(dx, dy) > DRAG_CLICK_THRESHOLD_PX) movedPastClickThreshold = true;
    }
    const hostRect = host!.getBoundingClientRect();
    dropIndex = computeRichDropIndex(blocksSnapshot, event.clientY - hostRect.top);
    renderIndicator(dropIndex);
  }

  function onDragEnd(): void {
    // A plain click (pointer never traveled past the threshold) opens the
    // context menu instead of committing a move — read the rect BEFORE
    // `endDrag` hides the handle. `endDrag(false)` still runs the full
    // cleanup (listeners, active class, indicator) without dispatching the
    // (would-be no-op-anyway, since dropIndex never moved) move transaction.
    if (!movedPastClickThreshold) {
      openContextMenu();
      endDrag(false);
      return;
    }
    endDrag(true);
  }

  function onHandleMouseDown(event: MouseEvent): void {
    if (!isEditable() || hoveredPos === null) return;
    event.preventDefault();
    event.stopPropagation();
    dragging = true;
    movedPastClickThreshold = false;
    downClientX = event.clientX;
    downClientY = event.clientY;
    handle.classList.add(`${RICH_DRAG_HANDLE_CLASS}--active`);
    const hostRect = host!.getBoundingClientRect();
    blocksSnapshot = collectTopLevelBlocks(view, hostRect);
    dropIndex = computeRichDropIndex(blocksSnapshot, event.clientY - hostRect.top);
    renderIndicator(dropIndex);
    window.addEventListener('mousemove', onDragMove);
    window.addEventListener('mouseup', onDragEnd);
  }

  handle.addEventListener('mousedown', onHandleMouseDown);
  // Bound to `host`, which encloses both `view.dom` and the handle, so moving between them is not a
  // mouseleave.
  host.addEventListener('mousemove', onHoverMove);
  host.addEventListener('mouseleave', hideHandle);

  return {
    destroy() {
      host.removeEventListener('mousemove', onHoverMove);
      host.removeEventListener('mouseleave', hideHandle);
      window.removeEventListener('mousemove', onDragMove);
      window.removeEventListener('mouseup', onDragEnd);
      handle.remove();
      indicator.remove();
    }
  };
}

/**
 * Renders no handle, and ignores gestures, while the editor is not editable. CSS hides it on coarse
 * pointers.
 */
export const RichBlockDragHandle = Extension.create({
  name: 'richBlockDragHandle',

  addProseMirrorPlugins() {
    // Destructure `editor` off `this` rather than aliasing `this` itself
    // (`typescript-eslint/no-this-alias`) — the `Editor` instance reference
    // is stable for the extension's lifetime, and `.isEditable` is read
    // fresh on every `isEditable()` call below, so this loses nothing.
    const { editor } = this;
    return [
      new Plugin({
        key: richDragHandlePluginKey,
        view(editorView) {
          return createRichDragHandleView(editorView, () => editor.isEditable);
        },
        props: {
          decorations() {
            return DecorationSet.empty;
          }
        }
      })
    ];
  }
});
