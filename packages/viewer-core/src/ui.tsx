'use client';

import type { CSSProperties, MouseEvent, ReactNode } from 'react';

import { useViewerContext } from './context.tsx';
import type { ViewerError } from './errors.ts';
import { ResolvedSource, safeHref } from './source.ts';
import type { ViewerStatus } from './types.ts';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export interface ViewerRootProps {
  /** Viewer key, for styling and test hooks. */
  viewer: string;
  status: ViewerStatus;
  /** Accessible name. */
  label: string;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  children?: ReactNode;
}

/**
 * Wrapper every viewer renders into.
 *
 * `draggable={false}` plus the `dragstart` guard is load-bearing: when a viewer
 * sits inside something natively draggable (ProseMirror marks a selected block
 * `draggable`), orbiting a model or panning a board would otherwise start an
 * HTML5 drag of the whole block. A non-draggable descendant ends the browser's
 * search for a drag source.
 */
export function ViewerRoot({ viewer, status, label, className, style, children }: ViewerRootProps) {
  return (
    <div
      aria-busy={status === 'loading'}
      aria-label={label}
      className={cx('fv-root', className)}
      data-fv-status={status}
      data-fv-viewer={viewer}
      draggable={false}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      role='group'
      style={style}
    >
      {children}
    </div>
  );
}

export function ViewerLoading({ message }: { message?: string | undefined }) {
  const { messages } = useViewerContext();
  return (
    <span className='fv-message' role='status'>
      {message ?? messages.loading}
    </span>
  );
}

export interface ViewerFailureProps {
  /** Null for "nothing to preview" states without a file to offer. */
  source?: ResolvedSource | null | undefined;
  error?: ViewerError | null | undefined;
  message?: string | undefined;
  onRetry?: (() => void) | undefined;
}

/** Every dead end stays actionable: retry, open, download. */
export function ViewerFailure({ source, error, message, onRetry }: ViewerFailureProps) {
  const { messages } = useViewerContext();
  const text =
    message ?? (error?.code === 'unsupported' ? messages.unsupported : messages.loadFailed);
  return (
    <div className='fv-message' data-fv-error={error?.code ?? 'unsupported'} role='alert'>
      <span>{text}</span>
      {error && error.code !== 'unsupported' ? (
        <span className='fv-message-detail'>{error.message}</span>
      ) : null}
      <span className='fv-message-actions'>
        {onRetry ? (
          <button className='fv-text-button' onClick={onRetry} type='button'>
            {messages.retry}
          </button>
        ) : null}
        {source ? <SourceLinks className='fv-text-button' source={source} /> : null}
      </span>
    </div>
  );
}

/** Open / Download for a source, honouring the adapter. */
export function SourceLinks({
  source,
  className,
}: {
  source: ResolvedSource;
  className?: string | undefined;
}) {
  const { adapter, messages } = useViewerContext();
  const { href, file } = source;
  const label = file.name ? `: ${file.name}` : '';

  if (href === null) {
    return (
      <button
        aria-label={`${messages.download}${label}`}
        className={className}
        onClick={() => void downloadSource(source)}
        type='button'
      >
        {messages.download}
      </button>
    );
  }
  const open = safeHref(adapter.getOpenHref ? adapter.getOpenHref(href, file) : href);
  const download = safeHref(adapter.getDownloadHref ? adapter.getDownloadHref(href, file) : href);
  // A plain link cannot carry the adapter's credentials. Without an explicit
  // href to use instead, download through the adapter.
  const viaAdapter = adapter.fetch !== undefined && !adapter.getDownloadHref;
  return (
    <>
      {open && (!adapter.fetch || adapter.getOpenHref) ? (
        <a
          aria-label={`${messages.open}${label}`}
          className={className}
          href={open}
          rel='noopener noreferrer'
          target='_blank'
        >
          {messages.open}
        </a>
      ) : null}
      {viaAdapter ? (
        <button
          aria-label={`${messages.download}${label}`}
          className={className}
          onClick={() => void downloadSource(source)}
          type='button'
        >
          {messages.download}
        </button>
      ) : download ? (
        <a
          aria-label={`${messages.download}${label}`}
          className={className}
          download={file.name ?? ''}
          href={download}
          rel='noopener noreferrer'
        >
          {messages.download}
        </a>
      ) : null}
    </>
  );
}

/** Save a source through the adapter, via a short-lived object URL. */
export async function downloadSource(source: ResolvedSource): Promise<void> {
  try {
    const url = URL.createObjectURL(await source.blob());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = source.file.name ?? 'download';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (error) {
    console.error('[viewers] download failed', error);
  }
}

export function ViewerToolbar({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div aria-label={label} className='fv-toolbar' role='toolbar'>
      {children}
    </div>
  );
}

export interface ViewerButtonProps {
  label: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean | undefined;
  pressed?: boolean | undefined;
  children: ReactNode;
}

export function ViewerButton({ label, onClick, disabled, pressed, children }: ViewerButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className='fv-button'
      disabled={disabled}
      onClick={onClick}
      title={label}
      type='button'
    >
      {children}
    </button>
  );
}

const PATHS = {
  plus: 'M8 3v10M3 8h10',
  minus: 'M3 8h10',
  reset: 'M3.5 8a4.5 4.5 0 1 0 1.6-3.4M3 2.5V5.5H6',
  expand: 'M9.5 2.5h4v4M6.5 13.5h-4v-4M13.5 2.5 9 7M2.5 13.5 7 9',
  prev: 'M10 3 5 8l5 5',
  next: 'm6 3 5 5-5 5',
  palette:
    'M8 2a6 6 0 1 0 0 12c1 0 1.5-.7 1.5-1.4 0-1-.9-1.2-.9-2 0-.7.6-1.1 1.3-1.1H11a3 3 0 0 0 3-3C14 4 11.3 2 8 2ZM5 8h.01M6.5 5h.01M9.8 5h.01',
} as const;

export type ViewerIconName = keyof typeof PATHS;

export function ViewerIcon({ name }: { name: ViewerIconName }) {
  return (
    <svg
      aria-hidden='true'
      fill='none'
      height='14'
      stroke='currentColor'
      strokeLinecap='round'
      strokeLinejoin='round'
      strokeWidth='1.5'
      viewBox='0 0 16 16'
      width='14'
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
