'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';

import { useViewerContext } from './context.tsx';
import { cx, ViewerButton, ViewerIcon, ViewerToolbar } from './ui.tsx';

export interface PanZoomView {
  scale: number;
  x: number;
  y: number;
}

const IDENTITY: PanZoomView = { scale: 1, x: 0, y: 0 };
const STEP = 1.4;

/**
 * Zoom about a point, never below fit. Returning to scale 1 recentres, so the
 * artwork cannot be lost off-screen. Pure, for tests.
 */
export function zoomAbout(
  view: PanZoomView,
  factor: number,
  px: number,
  py: number,
  maxScale: number,
): PanZoomView {
  const scale = Math.min(maxScale, Math.max(1, view.scale * factor));
  if (scale === 1) return IDENTITY;
  const k = scale / view.scale;
  return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** Keep at least part of the content inside the viewport. */
export function clampPan(view: PanZoomView, width: number, height: number): PanZoomView {
  const clamp = (value: number, size: number) =>
    Math.min(size / 2, Math.max(size / 2 - size * view.scale, value));
  return { ...view, x: clamp(view.x, width), y: clamp(view.y, height) };
}

export interface PanZoomProps {
  children: ReactNode;
  /** Names the toolbar, e.g. `Board view`. */
  label: string;
  controls?: boolean | undefined;
  maxScale?: number | undefined;
  className?: string | undefined;
  /** Extra toolbar items, before the zoom buttons. */
  toolbar?: ReactNode;
}

/**
 * Pan/zoom for fit-to-frame artwork. Ctrl/Cmd + wheel (and trackpad pinch) to
 * zoom so page scrolling is never hijacked, drag to pan once zoomed, `+`/`-`/`0`
 * and arrow keys when focused, double-click to toggle.
 */
export function PanZoom({
  children,
  label,
  controls = true,
  maxScale = 40,
  className,
  toolbar,
}: PanZoomProps) {
  const { messages } = useViewerContext();
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PanZoomView>(IDENTITY);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);

  const apply = useCallback((next: (view: PanZoomView) => PanZoomView) => {
    setView((current) => {
      const el = ref.current;
      const moved = next(current);
      return el && moved.scale > 1 ? clampPan(moved, el.clientWidth, el.clientHeight) : moved;
    });
  }, []);

  const zoomCentre = useCallback(
    (factor: number) => {
      const el = ref.current;
      const px = (el?.clientWidth ?? 0) / 2;
      const py = (el?.clientHeight ?? 0) / 2;
      apply((current) => zoomAbout(current, factor, px, py, maxScale));
    },
    [apply, maxScale],
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // React attaches wheel passively; preventDefault needs a real listener.
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      const factor = Math.exp(-event.deltaY * 0.005);
      apply((current) =>
        zoomAbout(current, factor, event.clientX - rect.left, event.clientY - rect.top, maxScale),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [apply, maxScale]);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (view.scale === 1 || event.button !== 0) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    drag.current = { id: start.id, x: event.clientX, y: event.clientY };
    apply((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
  };
  const endDrag = () => {
    drag.current = null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    const pan = (dx: number, dy: number) =>
      apply((current) => ({ ...current, x: current.x + dx, y: current.y + dy }));
    switch (event.key) {
      case '+':
      case '=':
        zoomCentre(STEP);
        break;
      case '-':
        zoomCentre(1 / STEP);
        break;
      case '0':
        setView(IDENTITY);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        if (view.scale === 1) return;
        pan(
          event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0,
          event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0,
        );
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className={cx('fv-panzoom', className)}>
      <div
        aria-label={label}
        className='fv-panzoom-viewport'
        data-fv-zoomed={view.scale > 1}
        onDoubleClick={() => (view.scale > 1 ? setView(IDENTITY) : zoomCentre(2))}
        onKeyDown={onKeyDown}
        onPointerCancel={endDrag}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        ref={ref}
        role='group'
        tabIndex={0}
      >
        <div
          className='fv-panzoom-content'
          data-fv-scale={view.scale}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        >
          {children}
        </div>
      </div>
      {controls ? (
        <ViewerToolbar label={label}>
          {toolbar}
          <ViewerButton
            disabled={view.scale >= maxScale}
            label={messages.zoomIn}
            onClick={() => zoomCentre(STEP)}
          >
            <ViewerIcon name='plus' />
          </ViewerButton>
          <ViewerButton
            disabled={view.scale === 1}
            label={messages.zoomOut}
            onClick={() => zoomCentre(1 / STEP)}
          >
            <ViewerIcon name='minus' />
          </ViewerButton>
          <ViewerButton
            disabled={view.scale === 1}
            label={messages.resetView}
            onClick={() => setView(IDENTITY)}
          >
            <ViewerIcon name='reset' />
          </ViewerButton>
        </ViewerToolbar>
      ) : toolbar ? (
        <ViewerToolbar label={label}>{toolbar}</ViewerToolbar>
      ) : null}
    </div>
  );
}
