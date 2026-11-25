'use client';

import { BubbleMenu } from '@tiptap/react/menus';
import type { ComponentProps } from 'react';
import { useEffect, useRef } from 'react';

export type EditorFloatingMenuProps = ComponentProps<typeof BubbleMenu>;

/**
 * Use instead of Tiptap's `BubbleMenu`. It repairs a StrictMode bug: `BubbleMenu` removes its
 * element in a `requestAnimationFrame` on cleanup, and because refs survive StrictMode's double
 * mount, that callback detaches the element of the live second mount, which then believes it is
 * visible.
 *
 * Only menus whose `shouldShow` is true at registration are affected. One frame after registration,
 * the element is re-attached if the plugin still considers it shown (`visibility: visible`). In
 * production this does nothing.
 *
 * Mounting always and using `shouldShow` would not work here: it is only re-evaluated on
 * transactions, so it cannot hide a menu when a scroll starts.
 */
export function EditorFloatingMenu({
  appendTo,
  editor,
  ref,
  ...props
}: EditorFloatingMenuProps) {
  const elementRef = useRef<HTMLDivElement | null>(null);
  // `BubbleMenu` assigns the ref inline during its own render (not through
  // React's ref lifecycle), so a fresh callback identity per render is safe
  // and never produces a spurious `null` call.
  const captureElement = (node: HTMLDivElement | null) => {
    elementRef.current = node;
    if (typeof ref === 'function') {
      ref(node);
    } else if (ref) {
      ref.current = node;
    }
  };

  useEffect(() => {
    if (!editor) return;
    const frame = requestAnimationFrame(() => {
      const element = elementRef.current;
      if (!element || element.isConnected) return;
      // Not `show()`n by the plugin — nothing to repair, and re-attaching
      // would resurrect a menu the plugin deliberately hid.
      if (element.style.visibility !== 'visible') return;
      // Same host resolution `BubbleMenuView.show()` uses.
      const host =
        (typeof appendTo === 'function' ? appendTo() : appendTo) ?? editor.view.dom.parentElement;
      host?.appendChild(element);
    });
    return () => cancelAnimationFrame(frame);
  }, [appendTo, editor]);

  return <BubbleMenu appendTo={appendTo} editor={editor} ref={captureElement} {...props} />;
}
