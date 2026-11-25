'use client';

import { useCallback, useEffect } from 'react';

import {
  PanZoom,
  useResolvedSource,
  useViewerLoad,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ResolvedSource,
  type ViewerProps,
} from '@formless63/viewer-core';

import { renderGerberLayer, unionViewBox, type GerberLayer, type GerberViewBox } from './gerber.ts';

export interface GerberViewerProps extends ViewerProps {
  /** Trace colour. */
  color?: string | undefined;
  background?: string | undefined;
}

async function loadLayer(source: ResolvedSource, signal: AbortSignal): Promise<GerberLayer> {
  return renderGerberLayer(await source.text(signal));
}

/** One Gerber or Excellon drill layer as SVG, fit to the frame. */
export default function GerberViewer({
  color = '#f59e0b',
  background = '#0a0a0a',
  ...props
}: GerberViewerProps) {
  const source = useResolvedSource(props);
  const { state, retry } = useViewerLoad(source, loadLayer, {
    onStatusChange: props.onStatusChange,
  });
  const view = state.value ? unionViewBox([state.value]) : null;
  useReportRatio(view, props.onIntrinsicAspectRatio);
  const name = source.file.name;

  return (
    <ViewerRoot
      className={props.className}
      label={name ? `Gerber: ${name}` : 'Gerber layer'}
      status={state.status}
      style={{ background, color, ...props.style }}
      viewer='gerber'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : state.status === 'loading' || !view ? (
        <ViewerLoading message='Rendering Gerber…' />
      ) : (
        <PanZoom controls={props.controls} label='Layer view'>
          <svg
            aria-label={name ?? 'Gerber layer'}
            className='fv-fill'
            preserveAspectRatio='xMidYMid meet'
            role='img'
            viewBox={`${view.minX} ${view.minY} ${view.width} ${view.height}`}
          >
            <GerberLayerGroup color={color} layer={state.value} opacity={1} />
          </svg>
        </PanZoom>
      )}
    </ViewerRoot>
  );
}

/** Scales a layer's own units to mm. tracespace has already flipped y to SVG's down. */
export function GerberLayerGroup({
  layer,
  color,
  opacity,
}: {
  layer: GerberLayer;
  color: string;
  opacity: number;
}) {
  const k = layer.units === 'in' ? 25.4 : 1;
  return (
    <g
      dangerouslySetInnerHTML={{ __html: layer.markup }}
      // tracespace's BASE_IMAGE_PROPS, which only its full-document `render` adds.
      clipRule='evenodd'
      fill='currentColor'
      fillRule='evenodd'
      opacity={opacity}
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth={0}
      style={{ color }}
      transform={`scale(${k})`}
    />
  );
}

export function useReportRatio(
  view: GerberViewBox | null,
  report: ((ratio: number | null) => void) | undefined,
): void {
  const ratio = view && view.height > 0 ? view.width / view.height : null;
  const stable = useCallback((value: number) => report?.(value), [report]);
  useEffect(() => {
    if (ratio !== null) stable(ratio);
  }, [ratio, stable]);
}
