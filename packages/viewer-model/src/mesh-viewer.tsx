'use client';

import type { EmbeddedViewer } from 'online-3d-viewer';
import { useEffect, useRef, useState } from 'react';

import {
  observeThemeChange,
  resolveThemeColor,
  useLatest,
  useResolvedSource,
  useViewerContext,
  useViewerLoad,
  ViewerButton,
  ViewerError,
  ViewerFailure,
  ViewerIcon,
  ViewerLoading,
  ViewerRoot,
  ViewerToolbar,
  type ResolvedSource,
  type ViewerProps,
} from '@formless63/viewer-core';

import { resolveMeshExtension } from './mesh-format.ts';

export interface MeshViewerProps extends ViewerProps {
  /** CSS variable for the surface of models with no material. */
  colorVariable?: string | undefined;
  /** CSS variable for line geometry. */
  lineColorVariable?: string | undefined;
  /**
   * Files the model references (an OBJ's `.mtl` and textures), matched by name.
   * Keep a stable reference: a new array reloads the model.
   */
  companions?: readonly File[] | undefined;
}

async function loadMeshFile(source: ResolvedSource, signal: AbortSignal): Promise<File> {
  const buffer = await source.arrayBuffer(signal);
  const ext = resolveMeshExtension(
    source.file,
    new Uint8Array(buffer, 0, Math.min(1024, buffer.byteLength)),
  );
  // Our own name, not the caller's: o3dv only needs the extension.
  return new File([buffer], `model.${ext}`);
}

/**
 * STL and friends through online-3d-viewer's `EmbeddedViewer` (orbit, zoom, fit
 * to model). The surface colour follows the host theme, clamped so near-black
 * or near-white themes still shade legibly.
 */
export default function MeshViewer({
  colorVariable = '--fv-accent',
  lineColorVariable = '--fv-muted-fg',
  companions,
  ...props
}: MeshViewerProps) {
  const { messages } = useViewerContext();
  const source = useResolvedSource(props);
  const { onStatusChange, controls = true } = props;
  const { state, retry, fail } = useViewerLoad(source, loadMeshFile, {
    onStatusChange,
    deferReady: true,
  });
  const hostRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<EmbeddedViewer | null>(null);
  const statusRef = useLatest(onStatusChange);
  const [modelReady, setModelReady] = useState(false);
  // Bumped on theme change to re-create the viewer with fresh colours. The
  // bytes are already in memory, so this costs a re-import, not a download.
  const [themeEpoch, setThemeEpoch] = useState(0);
  useEffect(() => observeThemeChange(() => setThemeEpoch((n) => n + 1)), []);

  const file = state.value;
  useEffect(() => {
    const el = hostRef.current;
    if (!el || !file) return;
    let disposed = false;
    let viewer: EmbeddedViewer | null = null;
    let observer: ResizeObserver | null = null;
    setModelReady(false);

    void (async () => {
      try {
        const OV = await import('online-3d-viewer');
        if (disposed) return;
        const band = { minLuminance: 0.25, maxLuminance: 0.78 };
        const surface = resolveThemeColor(el, colorVariable, band);
        const line = resolveThemeColor(el, lineColorVariable, band);
        viewer = new OV.EmbeddedViewer(el, {
          backgroundColor: new OV.RGBAColor(255, 255, 255, 0),
          ...(surface ? { defaultColor: new OV.RGBColor(surface.r, surface.g, surface.b) } : {}),
          ...(line ? { defaultLineColor: new OV.RGBColor(line.r, line.g, line.b) } : {}),
          onModelLoaded: () => {
            if (disposed) return;
            setModelReady(true);
            statusRef.current?.('ready');
          },
          onModelLoadFailed: () => {
            if (!disposed) fail(new ViewerError('parse-failed', 'The model could not be read'));
          },
        });
        viewerRef.current = viewer;
        const embedded = viewer;
        embedded.LoadModelFromFileList([file, ...(companions ?? [])]);
        if (typeof ResizeObserver !== 'undefined') {
          // o3dv only listens to window resizes, not its container's.
          observer = new ResizeObserver(() => embedded.Resize());
          observer.observe(el);
        }
      } catch (error) {
        if (!disposed)
          fail(new ViewerError('engine-failed', 'The 3D engine could not start', { cause: error }));
      }
    })();

    return () => {
      disposed = true;
      observer?.disconnect();
      if (viewer) destroyViewer(viewer);
      viewerRef.current = null;
      el.replaceChildren();
    };
  }, [file, companions, themeEpoch, colorVariable, lineColorVariable, fail, statusRef]);

  const resetView = () => {
    const viewer = viewerRef.current?.GetViewer();
    if (!viewer) return;
    viewer.SetUpVector(1, false); // Direction.Y, the orientation models load in
    viewer.FitSphereToWindow(
      viewer.GetBoundingSphere(() => true),
      false,
    );
  };

  const name = source.file.name;
  const status = state.status === 'ready' && !modelReady ? 'loading' : state.status;
  return (
    <ViewerRoot
      className={props.className}
      label={name ? `3D model: ${name}` : '3D model'}
      status={status}
      style={props.style}
      viewer='mesh'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : (
        <>
          <div className='fv-fill fv-mesh-host' ref={hostRef} />
          {status === 'loading' ? (
            <div className='fv-overlay'>
              <ViewerLoading />
            </div>
          ) : null}
          {controls && modelReady ? (
            <ViewerToolbar label='3D view'>
              <ViewerButton label={messages.resetView} onClick={resetView}>
                <ViewerIcon name='reset' />
              </ViewerButton>
            </ViewerToolbar>
          ) : null}
        </>
      )}
    </ViewerRoot>
  );
}

/**
 * `EmbeddedViewer.Destroy()` leaves two leaks: its window `resize` listener
 * keeps firing into the destroyed renderer, and the WebGL context survives
 * until GC. Browsers cap live contexts at about 16, so a few theme switches
 * would blank every other model on the page.
 */
function destroyViewer(viewer: EmbeddedViewer): void {
  try {
    const { renderer } = viewer.GetViewer() as { renderer?: { forceContextLoss?: () => void } };
    viewer.Destroy();
    viewer.Resize = () => {};
    renderer?.forceContextLoss?.();
  } catch (error) {
    console.error('[viewers] 3D viewer teardown failed', error);
  }
}
