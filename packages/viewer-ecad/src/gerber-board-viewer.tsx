'use client';

import type { LayerIdentity } from '@tracespace/identify-layers';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  PanZoom,
  ResolvedSource,
  toViewerError,
  useViewerContext,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ViewerError,
  type ViewerInput,
  type ViewerProps,
} from '@formless63/viewer-core';

import { gerberLayerStyle, renderGerberLayer, unionViewBox, type GerberLayer } from './gerber.ts';
import { GerberLayerGroup, useReportRatio } from './gerber-viewer.tsx';

export interface GerberBoardFile {
  /** Filename. Layer type and side are identified from it. */
  name: string;
  source: ViewerInput;
}

export interface GerberBoardViewerProps {
  /** Keep a stable reference: a new array reloads every layer. */
  files: readonly GerberBoardFile[];
  controls?: boolean | undefined;
  background?: string | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  onStatusChange?: ViewerProps['onStatusChange'];
  onIntrinsicAspectRatio?: ViewerProps['onIntrinsicAspectRatio'];
}

interface BoardLayer {
  name: string;
  identity: LayerIdentity | undefined;
  layer: GerberLayer | null;
  error: ViewerError | null;
}

/**
 * Several layers overlaid, with per-layer visibility. This is a translucent
 * X-ray stack for checking alignment and contents, not a photorealistic board.
 */
export function GerberBoardViewer({
  files,
  controls = true,
  background = '#0a0a0a',
  className,
  style,
  onStatusChange,
  onIntrinsicAspectRatio,
}: GerberBoardViewerProps) {
  const { adapter } = useViewerContext();
  const [layers, setLayers] = useState<BoardLayer[] | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLayers(null);
    setHidden(new Set());
    onStatusChange?.('loading');
    void (async () => {
      const { identifyLayers } = await import('@tracespace/identify-layers');
      const identities = identifyLayers(files.map((file) => file.name));
      const loaded = await Promise.all(
        files.map(async (file): Promise<BoardLayer> => {
          const identity = identities[file.name];
          const source = new ResolvedSource(file.source, { name: file.name }, adapter);
          try {
            const layer = await renderGerberLayer(await source.text(controller.signal));
            return { name: file.name, identity, layer, error: null };
          } catch (cause) {
            return {
              name: file.name,
              identity,
              layer: null,
              error: toViewerError(cause, 'parse-failed'),
            };
          }
        }),
      );
      if (controller.signal.aborted) return;
      for (const item of loaded) if (item.error) adapter.onError?.(item.error, { name: item.name });
      setLayers(loaded);
      const firstError = loaded.find((item) => item.error)?.error ?? undefined;
      const usable = loaded.some((item) => item.layer);
      onStatusChange?.(usable ? 'ready' : 'error', usable ? undefined : firstError);
    })().catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      const error = toViewerError(cause, 'engine-failed');
      setLayers(
        files.map((file) => ({ name: file.name, identity: undefined, layer: null, error })),
      );
      onStatusChange?.('error', error);
    });
    return () => controller.abort();
    // Status is reported per load, not per callback identity.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [files, adapter, attempt]);

  const drawable = useMemo(
    () =>
      (layers ?? [])
        .flatMap((item) =>
          item.layer ? [{ ...item, layer: item.layer, look: gerberLayerStyle(item.identity) }] : [],
        )
        .sort((a, b) => a.look.order - b.look.order),
    [layers],
  );
  const view = useMemo(() => unionViewBox(drawable.map((item) => item.layer)), [drawable]);
  useReportRatio(view, onIntrinsicAspectRatio);
  const failed = (layers ?? []).filter((item) => item.error);
  const status = layers === null ? 'loading' : view ? 'ready' : 'error';

  return (
    <ViewerRoot
      className={className}
      label='Board layers'
      status={status}
      style={{ background, ...style }}
      viewer='gerber-board'
    >
      {status === 'loading' ? (
        <ViewerLoading message='Rendering layers…' />
      ) : !view ? (
        <ViewerFailure
          error={failed[0]?.error ?? null}
          onRetry={() => setAttempt((n) => n + 1)}
          message='No layer could be rendered.'
        />
      ) : (
        <>
          <PanZoom controls={controls} label='Board view'>
            <svg
              aria-label='Board layers'
              className='fv-fill'
              preserveAspectRatio='xMidYMid meet'
              role='img'
              viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
            >
              {drawable.map((item) =>
                hidden.has(item.name) ? null : (
                  <GerberLayerGroup
                    color={item.look.color}
                    key={item.name}
                    layer={item.layer}
                    opacity={item.look.opacity}
                  />
                ),
              )}
            </svg>
          </PanZoom>
          {controls ? (
            <fieldset className='fv-layer-list'>
              <legend>Layers</legend>
              {[...drawable].reverse().map((item) => (
                <label key={item.name} title={item.name}>
                  <input
                    checked={!hidden.has(item.name)}
                    onChange={() =>
                      setHidden((current) => {
                        const next = new Set(current);
                        if (!next.delete(item.name)) next.add(item.name);
                        return next;
                      })
                    }
                    type='checkbox'
                  />
                  <span aria-hidden='true' style={{ background: item.look.color }} />
                  {item.look.label}
                </label>
              ))}
              {failed.map((item) => (
                <small key={item.name} title={item.error?.message}>
                  {item.name}: not readable
                </small>
              ))}
            </fieldset>
          ) : null}
        </>
      )}
    </ViewerRoot>
  );
}
