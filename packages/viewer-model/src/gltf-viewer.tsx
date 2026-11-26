'use client';

import type { ModelViewerElement } from '@google/model-viewer';
import { createElement, useEffect, useRef, useState } from 'react';

import {
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
  disposeViewerUrl,
  loadViewerUrl,
  type ViewerProps,
} from '@formless63/viewer-core';

export interface GltfViewerProps extends ViewerProps {
  /**
   * Offer AR. Off by default: Android's Scene Viewer sends the model URL to a
   * Google app, and AR cannot reach `blob:` or authenticated URLs.
   */
  ar?: boolean | undefined;
  autoRotate?: boolean | undefined;
}

export interface GltfConfig {
  /**
   * Self-hosted decoder directories. model-viewer otherwise downloads the Draco
   * and KTX2 decoders from a Google CDN when a model needs them.
   */
  dracoDecoderLocation?: string | undefined;
  ktx2TranscoderLocation?: string | undefined;
  meshoptDecoderLocation?: string | undefined;
}

let config: GltfConfig = {};

/** Call before the first model renders. */
export function configureGltf(next: GltfConfig): void {
  config = { ...next };
}

async function loadEngine(): Promise<void> {
  // Registers the custom element at evaluation, so it must never run on the server.
  const { ModelViewerElement: element } = await import('@google/model-viewer');
  const statics = element as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined) statics[key] = value;
  }
}

const loadModel: typeof loadViewerUrl = async (source, signal) => {
  try {
    await loadEngine();
  } catch (cause) {
    throw new ViewerError('engine-failed', 'The 3D engine could not load', { cause });
  }
  return loadViewerUrl(source, signal);
};

/** GLB/glTF through Google's `<model-viewer>`, with the file's own materials. */
export default function GltfViewer({ ar = false, autoRotate = false, ...props }: GltfViewerProps) {
  const { messages } = useViewerContext();
  const source = useResolvedSource(props);
  const { onStatusChange, controls = true } = props;
  const { state, retry, fail } = useViewerLoad(source, loadModel, {
    dispose: disposeViewerUrl,
    onStatusChange,
    deferReady: true,
  });
  const hostRef = useRef<HTMLDivElement>(null);
  const statusRef = useLatest(onStatusChange);
  const [ready, setReady] = useState(false);
  const url = state.value?.url;

  useEffect(() => {
    const el = hostRef.current?.querySelector('model-viewer');
    if (!el || !url) return;
    setReady(false);
    const onLoad = () => {
      setReady(true);
      statusRef.current?.('ready');
    };
    const onError = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; sourceError?: unknown }>).detail;
      const code = detail?.type === 'webglcontextlost' ? 'engine-failed' : 'parse-failed';
      fail(
        new ViewerError(code, 'The model could not be displayed', { cause: detail?.sourceError }),
      );
    };
    el.addEventListener('load', onLoad);
    el.addEventListener('error', onError);
    if ((el as ModelViewerElement).loaded) onLoad();
    return () => {
      el.removeEventListener('load', onLoad);
      el.removeEventListener('error', onError);
    };
  }, [url, fail, statusRef]);

  const resetView = () => {
    const el = hostRef.current?.querySelector<ModelViewerElement>('model-viewer');
    if (!el) return;
    el.cameraOrbit = 'auto auto auto';
    el.cameraTarget = 'auto auto auto';
    el.fieldOfView = 'auto';
    el.resetTurntableRotation(0);
    el.jumpCameraToGoal();
  };

  const name = source.file.name;
  const status = state.status === 'ready' && !ready ? 'loading' : state.status;
  return (
    <ViewerRoot
      className={props.className}
      label={name ? `3D model: ${name}` : '3D model'}
      status={status}
      style={props.style}
      viewer='gltf'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : (
        <>
          <div className='fv-fill' ref={hostRef}>
            {/* createElement sidesteps JSX intrinsic typing for the custom tag. */}
            {url
              ? createElement('model-viewer', {
                  key: url,
                  alt: name ? `3D model: ${name}` : '3D model',
                  'camera-controls': true,
                  draggable: false,
                  'shadow-intensity': '1',
                  src: url,
                  style: { display: 'block', height: '100%', width: '100%' },
                  ...(ar ? { ar: true } : {}),
                  ...(autoRotate ? { 'auto-rotate': true } : {}),
                })
              : null}
          </div>
          {status === 'loading' ? (
            <div className='fv-overlay' style={{ pointerEvents: 'none' }}>
              <ViewerLoading />
            </div>
          ) : null}
          {controls && ready ? (
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
