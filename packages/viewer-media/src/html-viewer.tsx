'use client';

import {
  loadViewerText,
  useResolvedSource,
  useViewerLoad,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ViewerInput,
  type ViewerProps,
} from '@formless63/viewer-core';

import ImageViewer from './image-viewer.tsx';

export interface HtmlViewerProps extends ViewerProps {
  /** Image shown when the HTML cannot be loaded, e.g. a page screenshot. */
  fallbackImage?: ViewerInput | undefined;
  /**
   * Let the document request remote images, styles and fonts. Off by default:
   * stored emails carry tracking pixels, and captured pages are usually inlined.
   */
  remoteContent?: boolean | undefined;
}

const LOCAL_ONLY_CSP =
  "default-src 'none'; img-src data: blob:; media-src data: blob:; font-src data:; style-src 'unsafe-inline' data:";

/** Add a CSP after any doctype: content before it would force quirks mode. */
export function withLocalOnlyPolicy(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${LOCAL_ONLY_CSP}">`;
  const lead = /^(?:\uFEFF|\s|<!--[\s\S]*?-->)*<!doctype[^>]*>/i.exec(html)?.[0] ?? '';
  return lead + meta + html.slice(lead.length);
}

/**
 * Untrusted HTML (captured pages, stored email bodies) in a sandboxed frame.
 *
 * SECURITY (load-bearing): `sandbox=""` is EMPTY. Without `allow-scripts` and
 * `allow-same-origin` the browser forces an opaque origin with scripting off,
 * so the document cannot run code or reach the host's DOM, cookies or storage.
 * Do not add tokens.
 */
export default function HtmlViewer({
  fallbackImage,
  remoteContent = false,
  ...props
}: HtmlViewerProps) {
  const source = useResolvedSource(props);
  const { state, retry } = useViewerLoad(source, loadViewerText, {
    onStatusChange: props.onStatusChange,
  });
  const name = source.file.name;

  if (state.status === 'error' && fallbackImage !== undefined) {
    return <ImageViewer {...props} contentType={undefined} source={fallbackImage} />;
  }
  return (
    <ViewerRoot
      className={props.className}
      label={name ? `HTML: ${name}` : 'HTML document'}
      status={state.status}
      style={props.style}
      viewer='html'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : state.status === 'loading' ? (
        <ViewerLoading />
      ) : (
        <iframe
          className='fv-fill'
          referrerPolicy='no-referrer'
          sandbox=''
          srcDoc={remoteContent ? state.value : withLocalOnlyPolicy(state.value)}
          style={{ background: '#fff' }}
          title={name ?? 'HTML document'}
        />
      )}
    </ViewerRoot>
  );
}
