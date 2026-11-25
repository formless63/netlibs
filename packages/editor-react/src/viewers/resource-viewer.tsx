import { lazy, Suspense, type ComponentPropsWithoutRef } from 'react';
import { RichPdfViewer } from './pdf-viewer.tsx';

import { isSafeMediaUrl, type RichViewerKind } from '@formless63/editor-core';

export interface RichResourceViewerProps {
  kind: RichViewerKind;
  src: string;
  title: string;
  sizeBytes?: number | null;
  className?: string;
}

const RichStlViewer = lazy(() => import('./stl-viewer.tsx'));

function MediaFallback({ title }: Pick<RichResourceViewerProps, 'title'>) {
  return <p role='status'>Preview unavailable for {title}.</p>;
}

export function RichResourceViewer({
  kind,
  src,
  title,
  sizeBytes,
  className
}: RichResourceViewerProps) {
  if (!isSafeMediaUrl(src)) return <MediaFallback title={title} />;

  const commonProps: ComponentPropsWithoutRef<'img'> = {
    className,
    src,
    title,
    referrerPolicy: 'no-referrer'
  };

  if (kind === 'image') {
    return <img {...commonProps} alt={title} loading='lazy' decoding='async' />;
  }
  if (kind === 'audio') {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <audio className={className} src={src} controls preload='metadata' />;
  }
  if (kind === 'video') {
    // eslint-disable-next-line jsx-a11y/media-has-caption
    return <video className={className} src={src} controls preload='metadata' playsInline />;
  }
  if (kind === 'pdf') {
    return <RichPdfViewer className={className} src={src} title={title} />;
  }
  if (kind === 'stl') {
    return (
      <Suspense fallback={<p role='status'>Loading 3D viewer…</p>}>
        <RichStlViewer className={className} sizeBytes={sizeBytes} src={src} title={title} />
      </Suspense>
    );
  }

  return <MediaFallback title={title} />;
}
