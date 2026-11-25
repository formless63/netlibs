'use client';

import {
  loadViewerText,
  useResolvedSource,
  useViewerLoad,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ViewerProps,
} from '@formless63/viewer-core';

import { Markdown, type MarkdownProps } from './markdown.tsx';

export interface MarkdownViewerProps
  extends ViewerProps, Pick<MarkdownProps, 'codeRenderers' | 'transformUrl'> {}

export default function MarkdownViewer({
  codeRenderers,
  transformUrl,
  ...props
}: MarkdownViewerProps) {
  const source = useResolvedSource(props);
  const { state, retry } = useViewerLoad(source, loadViewerText, {
    onStatusChange: props.onStatusChange,
  });
  const name = source.file.name;
  return (
    <ViewerRoot
      className={props.className}
      label={name ? `Markdown: ${name}` : 'Markdown'}
      status={state.status}
      style={props.style}
      viewer='markdown'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : state.status === 'loading' ? (
        <ViewerLoading />
      ) : (
        <div
          style={{ height: '100%', overflow: 'auto', padding: '1rem', boxSizing: 'border-box' }}
          tabIndex={0}
        >
          <Markdown
            codeRenderers={codeRenderers}
            content={state.value}
            transformUrl={transformUrl}
          />
        </div>
      )}
    </ViewerRoot>
  );
}
