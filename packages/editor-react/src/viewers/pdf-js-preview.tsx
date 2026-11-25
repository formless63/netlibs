import { useEffect, useRef, useState } from 'react';

import { cn } from '../ui/cn.ts';

import {
  getPdfPreviewConfig,
  loadRichPdfjs,
  type RichPdfDocument,
  type RichPdfjs,
  type RichPdfRenderTask
} from './pdf-js-loader.ts';
import { RichPdfOpenAffordance } from './pdf-open-affordance.tsx';

const FALLBACK_RENDER_WIDTH = 640;
const DEFAULT_PAGE_ASPECT = 11 / 8.5;
const MAX_PDF_PAGES = 500;

function PdfPageCanvas({
  document: pdf,
  pageNumber,
  aspect,
  onFirstPageAspect
}: {
  document: RichPdfDocument;
  pageNumber: number;
  aspect: number;
  onFirstPageAspect?: (aspect: number) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (visible) return;
    const holder = holderRef.current;
    if (!holder) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timeout = window.setTimeout(() => setVisible(true), 0);
      return () => window.clearTimeout(timeout);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let task: RichPdfRenderTask | null = null;

    void (async () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const unscaled = page.getViewport({ scale: 1 });
      if (unscaled.width <= 0 || unscaled.height <= 0) {
        throw new Error('PDF page has invalid dimensions');
      }
      if (pageNumber === 1) onFirstPageAspect?.(unscaled.height / unscaled.width);
      const cssWidth = holderRef.current?.clientWidth || FALLBACK_RENDER_WIDTH;
      const dpr = Math.min(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (cssWidth / unscaled.width) * dpr });
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new Error('2D canvas context unavailable');
      task = page.render({ canvasContext: context, viewport });
      await task.promise;
      if (!cancelled) page.cleanup?.();
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.error(`[rich-editor] PDF.js page ${pageNumber} render failed`, error);
      setFailed(true);
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [onFirstPageAspect, pageNumber, pdf, visible]);

  return (
    <div
      className='ce:w-full ce:bg-background ce:shadow-sm'
      data-pdf-page={pageNumber}
      ref={holderRef}
      style={{ aspectRatio: failed ? undefined : `1 / ${aspect}` }}
    >
      {failed ? (
        <p className='ce:p-3 ce:text-center ce:text-xs ce:text-muted-foreground'>
          Page {pageNumber} couldn&apos;t be rendered here. Use Open PDF above.
        </p>
      ) : (
        <canvas
          aria-label={`PDF page ${pageNumber}`}
          className='ce:block ce:h-auto ce:w-full'
          ref={canvasRef}
        />
      )}
    </div>
  );
}

export interface RichPdfJsPreviewProps {
  src: string;
  title: string;
  className?: string;
}

export function RichPdfJsPreview({ src, title, className }: RichPdfJsPreviewProps) {
  const [preview, setPreview] = useState<{
    src: string;
    pdf: RichPdfDocument | null;
    failed: boolean;
  }>({ src, pdf: null, failed: false });
  const [aspect, setAspect] = useState(DEFAULT_PAGE_ASPECT);
  const pdf = preview.src === src ? preview.pdf : null;
  const failed = preview.src === src && preview.failed;

  useEffect(() => {
    if (!getPdfPreviewConfig()) return;
    let cancelled = false;
    let task: ReturnType<RichPdfjs['getDocument']> | null = null;

    void loadRichPdfjs()
      .then((pdfjs) => {
        if (cancelled) return null;
        const assets = getPdfPreviewConfig();
        task = pdfjs.getDocument({
          url: src,
          cMapUrl: assets?.cMapUrl,
          cMapPacked: true,
          standardFontDataUrl: assets?.standardFontDataUrl,
          wasmUrl: assets?.wasmUrl,
          useWorkerFetch: true,
          isEvalSupported: false,
          enableScripting: false
        });
        return task.promise;
      })
      .then((document_) => {
        if (cancelled || !document_) return;
        if (!Number.isSafeInteger(document_.numPages) || document_.numPages < 1) {
          throw new Error('PDF has no renderable pages');
        }
        if (document_.numPages > MAX_PDF_PAGES) {
          void document_.destroy();
          throw new Error(`PDF exceeds the ${MAX_PDF_PAGES}-page preview limit`);
        }
        setPreview({ src, pdf: document_, failed: false });
      })
      .catch((error: unknown) => {
        console.error('[rich-editor] PDF.js preview unavailable; showing open fallback', error);
        if (!cancelled) setPreview({ src, pdf: null, failed: true });
      });

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [src]);

  if (failed || !getPdfPreviewConfig()) {
    return (
      <RichPdfOpenAffordance
        message={
          failed ? "The built-in PDF renderer couldn't load this file." : undefined
        }
        src={src}
        title={title}
      />
    );
  }

  return (
    <div className={cn('ce:flex ce:h-full ce:w-full ce:flex-col', className)} data-testid='pdf-js-preview'>
      <div className='ce:flex ce:shrink-0 ce:items-center ce:justify-between ce:gap-2 ce:border-b ce:px-2 ce:py-1'>
        <span className='ce:truncate ce:text-xs ce:text-muted-foreground'>
          {pdf ? `${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'}` : 'Loading preview…'}
        </span>
        <a
          aria-label={`Open PDF: ${title}`}
          className='ce:inline-flex ce:shrink-0 ce:items-center ce:rounded-md ce:px-2 ce:py-1 ce:text-xs ce:font-medium ce:text-primary ce:underline-offset-2 ce:hover:underline'
          href={src}
          rel='noopener noreferrer'
          target='_blank'
        >
          Open PDF
        </a>
      </div>
      <div className='ce:min-h-0 ce:flex-1 ce:space-y-2 ce:overflow-auto ce:bg-muted/40 ce:p-2'>
        {pdf
          ? Array.from({ length: pdf.numPages }, (_, index) => (
              <PdfPageCanvas
                aspect={aspect}
                document={pdf}
                key={index + 1}
                onFirstPageAspect={setAspect}
                pageNumber={index + 1}
              />
            ))
          : null}
      </div>
    </div>
  );
}
