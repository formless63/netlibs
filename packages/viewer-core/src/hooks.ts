'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useViewerContext } from './context.tsx';
import { isAbortError, toViewerError, type ViewerError, type ViewerErrorCode } from './errors.ts';
import { ResolvedSource } from './source.ts';
import { useLatest } from './use-latest.ts';
import type { ViewerFileInfo, ViewerProps, ViewerStatus } from './types.ts';

export function useResolvedSource(
  props: ViewerFileInfo & Pick<ViewerProps, 'source'>,
): ResolvedSource {
  const { adapter } = useViewerContext();
  const { source, name, contentType, sizeBytes } = props;
  return useMemo(
    () => new ResolvedSource(source, { name, contentType, sizeBytes }, adapter),
    [source, name, contentType, sizeBytes, adapter],
  );
}

export type AsyncState<T> =
  | { status: 'loading'; value: null; error: null }
  | { status: 'ready'; value: T; error: null }
  | { status: 'error'; value: null; error: ViewerError };

const LOADING = { status: 'loading', value: null, error: null } as const;

export interface UseViewerLoadResult<T> {
  state: AsyncState<T>;
  retry: () => void;
  /** Report a failure that happens after loading (an engine's error event). */
  fail: (error: unknown) => void;
}

/**
 * The load lifecycle every viewer shares: run `load`, abort when the source or
 * deps change, normalise failures, and report status to the host.
 *
 * `load` must be referentially stable (module-level or `useCallback`).
 * `dispose` is called for a value that is replaced, unmounted, or arrives after
 * the effect was cancelled, so blob URLs and documents never leak.
 */
export function useViewerLoad<T>(
  source: ResolvedSource,
  load: (source: ResolvedSource, signal: AbortSignal) => Promise<T>,
  options: {
    errorCode?: ViewerErrorCode;
    dispose?: (value: T) => void;
    onStatusChange?: ((status: ViewerStatus, error?: ViewerError) => void) | undefined;
    /** When true, `ready` is reported by the viewer, not when `load` resolves. */
    deferReady?: boolean;
  } = {},
): UseViewerLoadResult<T> {
  const { adapter } = useViewerContext();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AsyncState<T>>(LOADING);
  const { errorCode = 'parse-failed', dispose, deferReady = false } = options;

  const onStatus = useLatest(options.onStatusChange);
  const disposeRef = useLatest(dispose);

  const report = useCallback(
    (error: ViewerError) => {
      adapter.onError?.(error, source.file);
      onStatus.current?.('error', error);
    },
    [adapter, source, onStatus],
  );

  useEffect(() => {
    const controller = new AbortController();
    let held: { value: T } | null = null;
    setState(LOADING);
    onStatus.current?.('loading');
    load(source, controller.signal).then(
      (value) => {
        if (controller.signal.aborted) {
          disposeRef.current?.(value);
          return;
        }
        held = { value };
        setState({ status: 'ready', value, error: null });
        if (!deferReady) onStatus.current?.('ready');
      },
      (cause: unknown) => {
        if (controller.signal.aborted || isAbortError(cause)) return;
        const error = toViewerError(cause, errorCode);
        setState({ status: 'error', value: null, error });
        report(error);
      },
    );
    return () => {
      controller.abort();
      // Deliberately the newest callback, not the one captured at load time.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      if (held) disposeRef.current?.(held.value);
    };
  }, [source, load, attempt, errorCode, deferReady, report, onStatus, disposeRef]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const fail = useCallback(
    (cause: unknown) => {
      const error = toViewerError(cause, 'engine-failed');
      setState({ status: 'error', value: null, error });
      report(error);
    },
    [report],
  );
  return { state, retry, fail };
}

export interface ViewerUrl {
  url: string;
  /** Revoke, for URLs this hook created. */
  revoke: (() => void) | null;
}

/**
 * A URL an engine can load: the real one when allowed, else a `blob:` URL.
 * Pass as `load` with `dispose: disposeViewerUrl`.
 */
export async function loadViewerUrl(
  source: ResolvedSource,
  signal: AbortSignal,
): Promise<ViewerUrl> {
  if (source.canUseUrlDirectly) return { url: await source.resolvedUrl(), revoke: null };
  const blob = await source.blob(signal);
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}

export function disposeViewerUrl(value: ViewerUrl): void {
  value.revoke?.();
}

export function loadViewerText(source: ResolvedSource, signal: AbortSignal): Promise<string> {
  return source.text(signal);
}
