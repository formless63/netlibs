'use client';

import {
  Component,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useViewerContext } from './context.tsx';
import { toViewerError, ViewerError } from './errors.ts';
import { formatBytes } from './format.ts';
import { useResolvedSource } from './hooks.ts';
import { cx, SourceLinks, ViewerButton, ViewerFailure, ViewerIcon, ViewerLoading } from './ui.tsx';
import type { ViewerDefinition, ViewerProps } from './types.ts';

/**
 * Above this size a frame shows "Load preview (NN MB)" instead of loading.
 * 50 MB covers scanned PDFs and typical STL exports while catching huge files.
 */
export const DEFAULT_SIZE_GUARD_BYTES = 50 * 1024 * 1024;

const DEFAULT_ASPECT_RATIO = '4 / 3';

/**
 * A degenerate parse must never collapse the frame to a sliver or stretch it
 * into a page-tall column, so reported ratios are clamped rather than trusted.
 */
const MIN_RATIO = 0.2;
const MAX_RATIO = 20;

/** Clamp a viewer-reported ratio; null for anything unusable. Pure, for tests. */
export function clampAspectRatio(ratio: number | null): number | null {
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, ratio));
}

interface BoundaryProps {
  children: ReactNode;
  resetKey: unknown;
  onError: (error: ViewerError) => void;
  fallback: (error: ViewerError) => ReactNode;
}

/** A viewer that throws degrades to a note, never to the app's error page. */
class ViewerErrorBoundary extends Component<BoundaryProps, { error: ViewerError | null }> {
  override state: { error: ViewerError | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: ViewerError } {
    return { error: toViewerError(error, 'render-failed') };
  }

  override componentDidCatch(error: unknown): void {
    this.props.onError(toViewerError(error, 'render-failed'));
  }

  override componentDidUpdate(previous: BoundaryProps): void {
    if (previous.resetKey !== this.props.resetKey && this.state.error)
      this.setState({ error: null });
  }

  override render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error) : this.props.children;
  }
}

export interface FileViewerProps extends Omit<ViewerProps, 'onIntrinsicAspectRatio'> {
  /** Force a viewer instead of resolving one from the file. */
  viewerKey?: string | undefined;
  /**
   * Auto-load ceiling in bytes. `null` disables the guard. Defaults to
   * `DEFAULT_SIZE_GUARD_BYTES`. Unknown sizes auto-load.
   */
  sizeGuardBytes?: number | null | undefined;
  /** Defer everything, including the viewer chunk, until near the viewport. */
  lazyLoad?: boolean | undefined;
  /** CSS aspect-ratio, or `fill` to take the parent's height. Default: auto. */
  aspectRatio?: string | undefined;
  /** Show a bar with the filename, size, open, download and full screen. */
  header?: boolean | undefined;
  /** Rendered when no viewer handles the file. Defaults to a note with links. */
  fallback?: ReactNode;
}

/**
 * The embedding surface: resolves a viewer from the registry, loads it lazily
 * when visible, guards large files, contains errors, and shapes its box to the
 * artwork.
 */
export function FileViewer({
  viewerKey,
  sizeGuardBytes = DEFAULT_SIZE_GUARD_BYTES,
  lazyLoad = true,
  aspectRatio,
  header = false,
  fallback,
  className,
  style,
  onStatusChange,
  ...viewerProps
}: FileViewerProps) {
  const { registry, adapter, messages } = useViewerContext();
  const source = useResolvedSource(viewerProps);
  const { file } = source;
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const visible = useVisible(bodyRef, lazyLoad);
  const [allowed, setAllowed] = useState<object | null>(null);
  const [attempt, setAttempt] = useState(0);
  const definition = useDefinition(viewerKey, source);

  const [ratio, setRatio] = useState<number | null>(null);
  useEffect(() => setRatio(null), [source, definition]);
  const reportRatio = useCallback((next: number | null) => {
    setRatio((current) => {
      const clamped = clampAspectRatio(next);
      // A viewer may report on every pass; bail out on an equal value.
      return clamped !== null && current !== null && Math.abs(current - clamped) < 0.001
        ? current
        : clamped;
    });
  }, []);

  const unsupported = definition === null;
  useEffect(() => {
    if (!unsupported) return;
    const error = new ViewerError('unsupported', messages.unsupported);
    adapter.onError?.(error, file);
    onStatusChange?.('error', error);
    // Report once per file, not once per callback identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [unsupported, source]);

  const guarded =
    sizeGuardBytes !== null &&
    typeof file.sizeBytes === 'number' &&
    file.sizeBytes > sizeGuardBytes &&
    allowed !== source;

  let content: ReactNode = null;
  if (definition === null) {
    content = fallback ?? (
      <ViewerFailure error={new ViewerError('unsupported', messages.unsupported)} source={source} />
    );
  } else if (definition === undefined || !visible) {
    content = visible ? <ViewerLoading /> : null;
  } else if (guarded) {
    content = (
      <button className='fv-guard' onClick={() => setAllowed(source)} type='button'>
        {messages.loadPreview(formatBytes(file.sizeBytes ?? 0))}
      </button>
    );
  } else {
    const Viewer = registry.component(definition.key);
    const retry = () => {
      registry.resetComponent(definition.key);
      setAttempt((n) => n + 1);
    };
    content = Viewer ? (
      <ViewerErrorBoundary
        fallback={(error) => <ViewerFailure error={error} onRetry={retry} source={source} />}
        onError={(error) => {
          console.error('[viewers] viewer failed to render', error);
          adapter.onError?.(error, file);
          onStatusChange?.('error', error);
        }}
        resetKey={`${attempt}:${definition.key}`}
      >
        <Suspense fallback={<ViewerLoading />}>
          <Viewer
            {...viewerProps}
            contentType={file.contentType}
            name={file.name}
            onIntrinsicAspectRatio={reportRatio}
            onStatusChange={onStatusChange}
          />
        </Suspense>
      </ViewerErrorBoundary>
    ) : null;
  }

  const fill = aspectRatio === 'fill';
  return (
    <div
      className={cx('fv-frame', fill && 'fv-frame-fill', className)}
      data-fv-frame={definition?.key ?? (unsupported ? 'unsupported' : 'resolving')}
      ref={rootRef}
      style={style}
    >
      {header ? (
        <div className='fv-header'>
          <span className='fv-header-name' title={file.name}>
            {file.name ?? definition?.label ?? ''}
          </span>
          {typeof file.sizeBytes === 'number' ? (
            <span className='fv-header-size'>{formatBytes(file.sizeBytes)}</span>
          ) : null}
          <SourceLinks className='fv-text-button' source={source} />
          <ViewerButton
            label={messages.fullscreen}
            onClick={() => void toggleFullscreen(rootRef.current)}
          >
            <ViewerIcon name='expand' />
          </ViewerButton>
        </div>
      ) : null}
      <div
        className='fv-frame-body'
        ref={bodyRef}
        style={
          fill
            ? undefined
            : {
                aspectRatio:
                  aspectRatio ??
                  (ratio !== null
                    ? String(ratio)
                    : (definition?.aspectRatio ?? DEFAULT_ASPECT_RATIO)),
              }
        }
      >
        {content}
      </div>
    </div>
  );
}

/** `undefined` while sniffing, `null` when nothing handles the file. */
function useDefinition(
  viewerKey: string | undefined,
  source: ReturnType<typeof useResolvedSource>,
): ViewerDefinition | null | undefined {
  const { registry } = useViewerContext();
  const known = viewerKey ? registry.get(viewerKey) : registry.resolve(source.file);
  const canSniff = !known && !viewerKey && source.href === null;
  const [sniffed, setSniffed] = useState<{
    source: object;
    definition: ViewerDefinition | null;
  } | null>(null);

  useEffect(() => {
    if (!canSniff) return;
    let cancelled = false;
    source
      .head()
      .then((head) => (head ? registry.sniff(head) : null))
      .catch(() => null)
      .then((definition) => {
        if (!cancelled) setSniffed({ source, definition });
      });
    return () => {
      cancelled = true;
    };
  }, [canSniff, registry, source]);

  if (known || !canSniff) return known;
  return sniffed?.source === source ? sniffed.definition : undefined;
}

function useVisible(ref: { current: HTMLElement | null }, enabled: boolean): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!enabled || typeof IntersectionObserver === 'undefined' || !el) {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [enabled, ref, visible]);
  return visible;
}

async function toggleFullscreen(el: HTMLElement | null): Promise<void> {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await el?.requestFullscreen();
  } catch (error) {
    console.warn('[viewers] full screen unavailable', error);
  }
}
