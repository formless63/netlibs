'use client';

import { useEffect, useState } from 'react';

import {
  disposeViewerUrl,
  useResolvedSource,
  useViewerLoad,
  loadViewerUrl,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ViewerProps,
} from '@formless63/viewer-core';

import { browserRendersPdfInline } from './native-support.ts';
import PdfCanvasViewer from './pdf-canvas-viewer.tsx';

export interface PdfViewerProps extends ViewerProps {
  /**
   * `auto` (default) uses the browser's own PDF viewer where it has one (full
   * fidelity, search and print for zero bytes) and pdf.js where it does not,
   * which is every phone. `native` and `canvas` force one path.
   */
  mode?: 'auto' | 'native' | 'canvas' | undefined;
}

export default function PdfViewer({ mode = 'auto', ...props }: PdfViewerProps) {
  // Decided in an effect so server and client first paint agree. One empty
  // frame beats mounting the wrong renderer and swapping it out.
  const [native, setNative] = useState<boolean | null>(null);
  useEffect(() => {
    setNative(mode === 'native' || (mode === 'auto' && browserRendersPdfInline()));
  }, [mode]);

  if (native === null) {
    return (
      <ViewerRoot
        className={props.className}
        label='PDF'
        status='loading'
        style={props.style}
        viewer='pdf'
      />
    );
  }
  return native ? <PdfNativeViewer {...props} /> : <PdfCanvasViewer {...props} />;
}

/**
 * `<object>` rather than `<iframe>`: in a browser without a PDF viewer an
 * iframe can trigger a download, where `<object>` renders its children. No
 * `sandbox`, because Chrome's PDF plugin is blocked inside sandboxed frames.
 */
export function PdfNativeViewer(props: ViewerProps) {
  const source = useResolvedSource(props);
  const { state, retry } = useViewerLoad(source, loadPdfUrl, {
    dispose: disposeViewerUrl,
    onStatusChange: props.onStatusChange,
  });
  const name = source.file.name;

  return (
    <ViewerRoot
      className={props.className}
      label={name ? `PDF: ${name}` : 'PDF'}
      status={state.status}
      style={props.style}
      viewer='pdf'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : state.status === 'loading' ? (
        <ViewerLoading />
      ) : (
        <object
          aria-label={name ? `PDF: ${name}` : 'PDF'}
          className='fv-fill'
          data={state.value.url}
          type='application/pdf'
        >
          <ViewerFailure message='This browser cannot preview PDFs inline.' source={source} />
        </object>
      )}
    </ViewerRoot>
  );
}

/** A `blob:` URL without a PDF type renders as text or downloads. */
const loadPdfUrl: typeof loadViewerUrl = async (source, signal) => {
  if (source.canUseUrlDirectly) return loadViewerUrl(source, signal);
  const blob = await source.blob(signal);
  const typed =
    blob.type === 'application/pdf' ? blob : blob.slice(0, blob.size, 'application/pdf');
  const url = URL.createObjectURL(typed);
  return { url, revoke: () => URL.revokeObjectURL(url) };
};
