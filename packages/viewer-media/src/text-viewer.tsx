'use client';

import { useState } from 'react';

import {
  loadViewerText,
  useResolvedSource,
  useViewerLoad,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ViewerProps,
} from '@formless63/viewer-core';

export interface TextViewerProps extends ViewerProps {
  /** Characters rendered before "Show all". Huge text nodes stall layout. */
  maxCharacters?: number | undefined;
  /** Wrap long lines. Defaults to true. */
  wrap?: boolean | undefined;
}

/** Plain text, shown verbatim. No highlighting and no interpretation. */
export default function TextViewer({
  maxCharacters = 200_000,
  wrap = true,
  ...props
}: TextViewerProps) {
  const source = useResolvedSource(props);
  const { state, retry } = useViewerLoad(source, loadViewerText, {
    onStatusChange: props.onStatusChange,
  });
  const [expanded, setExpanded] = useState<string | null>(null);
  const name = source.file.name;

  return (
    <ViewerRoot
      className={props.className}
      label={name ? `Text: ${name}` : 'Text'}
      status={state.status}
      style={props.style}
      viewer='text'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : state.status === 'loading' ? (
        <ViewerLoading />
      ) : (
        <div style={{ height: '100%', overflow: 'auto' }} tabIndex={0}>
          <pre
            style={{
              margin: 0,
              padding: '0.75rem',
              font: '0.75rem/1.5 ui-monospace, monospace',
              whiteSpace: wrap ? 'pre-wrap' : 'pre',
              overflowWrap: wrap ? 'anywhere' : 'normal',
            }}
          >
            {expanded === state.value ? state.value : state.value.slice(0, maxCharacters)}
          </pre>
          {state.value.length > maxCharacters && expanded !== state.value ? (
            <button
              className='fv-text-button'
              onClick={() => setExpanded(state.value)}
              style={{ padding: '0.75rem' }}
              type='button'
            >
              Show all {state.value.length.toLocaleString()} characters
            </button>
          ) : null}
        </div>
      )}
    </ViewerRoot>
  );
}
