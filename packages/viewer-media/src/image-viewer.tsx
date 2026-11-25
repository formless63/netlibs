'use client';

import {
  disposeViewerUrl,
  loadViewerUrl,
  PanZoom,
  useResolvedSource,
  useViewerLoad,
  ViewerError,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ViewerProps,
} from '@formless63/viewer-core';

/**
 * Raster and SVG images, fit to the frame with pan/zoom. SVGs go through
 * `<img>`, which never executes their scripts or loads external resources.
 */
export default function ImageViewer(props: ViewerProps) {
  const { controls, className, style, onStatusChange, onIntrinsicAspectRatio } = props;
  const source = useResolvedSource(props);
  const { state, retry, fail } = useViewerLoad(source, loadViewerUrl, {
    dispose: disposeViewerUrl,
    onStatusChange,
    deferReady: true,
  });
  const name = source.file.name;

  return (
    <ViewerRoot
      className={className}
      label={name ? `Image: ${name}` : 'Image'}
      status={state.status}
      style={style}
      viewer='image'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : state.status === 'loading' ? (
        <ViewerLoading />
      ) : (
        <PanZoom controls={controls} label='Image view'>
          <img
            alt={name ?? 'Image preview'}
            className='fv-fill'
            draggable={false}
            onError={() => fail(new ViewerError('parse-failed', 'The image could not be decoded'))}
            onLoad={(event) => {
              const { naturalWidth, naturalHeight } = event.currentTarget;
              if (naturalWidth > 0 && naturalHeight > 0) {
                onIntrinsicAspectRatio?.(naturalWidth / naturalHeight);
              }
              onStatusChange?.('ready');
            }}
            src={state.value.url}
            style={{ objectFit: 'contain' }}
          />
        </PanZoom>
      )}
    </ViewerRoot>
  );
}
