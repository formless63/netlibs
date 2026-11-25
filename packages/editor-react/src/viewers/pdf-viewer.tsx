import { isSafeMediaUrl } from '@formless63/editor-core';
import { RichPdfJsPreview } from './pdf-js-preview.tsx';

export interface RichPdfViewerProps {
  src: string;
  title: string;
  className?: string;
}

export function RichPdfViewer({ src, title, className }: RichPdfViewerProps) {
  if (!isSafeMediaUrl(src)) {
    return <p role='status'>Preview unavailable for {title}.</p>;
  }

  return <RichPdfJsPreview className={className} src={src} title={title} />;
}
