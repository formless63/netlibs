'use client';

import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
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
  type ResolvedSource,
  type ViewerProps,
} from '@formless63/viewer-core';

import { loadPdfjs, pdfAssetParams } from './pdfjs.ts';

/** CSS width used before the container has been laid out (jsdom). */
const FALLBACK_WIDTH = 640;
/** US Letter, to size placeholders before a page's real viewport is known. */
const DEFAULT_PAGE_ASPECT = 11 / 8.5;
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

interface LoadedPdf {
  document: PDFDocumentProxy;
  destroy: () => void;
}

async function loadDocument(source: ResolvedSource, signal: AbortSignal): Promise<LoadedPdf> {
  let pdfjs: Awaited<ReturnType<typeof loadPdfjs>>;
  try {
    pdfjs = await loadPdfjs();
  } catch (cause) {
    throw new ViewerError('engine-failed', 'The PDF engine could not load', { cause });
  }
  // A direct URL keeps pdf.js's streaming and range requests; otherwise pass
  // bytes. pdf.js detaches the buffer, which is why the source hands out copies.
  const input = source.canUseUrlDirectly
    ? { url: await source.resolvedUrl() }
    : { data: new Uint8Array(await source.arrayBuffer(signal)) };
  // Document JavaScript never runs: scripting lives in pdf.js's separate
  // viewer/sandbox layer, which this package does not load.
  const task = pdfjs.getDocument({ ...input, ...pdfAssetParams() });
  const onAbort = () => void task.destroy();
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const document = await task.promise;
    return { document, destroy: () => void task.destroy() };
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function disposeDocument(pdf: LoadedPdf): void {
  pdf.destroy();
}

/**
 * Canvas rendering through pdf.js. Pages are lazy: each is a sized placeholder
 * until it nears the viewport, so a 400-page manual never allocates 400 canvases.
 */
export default function PdfCanvasViewer(props: ViewerProps) {
  const { controls = true } = props;
  const { messages } = useViewerContext();
  const source = useResolvedSource(props);
  const { state, retry } = useViewerLoad(source, loadDocument, {
    dispose: disposeDocument,
    onStatusChange: props.onStatusChange,
  });
  const [aspect, setAspect] = useState(DEFAULT_PAGE_ASPECT);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const name = source.file.name;
  const pageCount = state.status === 'ready' ? state.value.document.numPages : 0;

  const goTo = useCallback((next: number) => {
    const el = scrollRef.current?.querySelector(`[data-fv-page='${next}']`);
    el?.scrollIntoView?.({ block: 'start', inline: 'nearest' });
  }, []);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const middle = el.scrollTop + el.clientHeight / 2;
    let current = 1;
    for (const child of el.children) {
      const node = child as HTMLElement;
      if (node.offsetTop <= middle) current = Number(node.dataset.fvPage ?? current);
    }
    setPage(current);
  };

  const zoomIndex = ZOOMS.indexOf(zoom as (typeof ZOOMS)[number]);
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
        <>
          <div
            onScroll={onScroll}
            ref={scrollRef}
            style={{
              position: 'relative',
              boxSizing: 'border-box',
              height: '100%',
              overflow: 'auto',
              padding: '0.5rem',
              background: 'var(--fv-muted)',
            }}
            tabIndex={0}
          >
            {Array.from({ length: pageCount }, (_, index) => (
              <PdfPage
                aspect={aspect}
                document={state.value.document}
                key={index + 1}
                onFirstPageAspect={setAspect}
                pageNumber={index + 1}
                zoom={zoom}
              />
            ))}
          </div>
          {controls ? (
            <ViewerToolbar label='PDF controls'>
              <ViewerButton
                disabled={page <= 1}
                label='Previous page'
                onClick={() => goTo(page - 1)}
              >
                <ViewerIcon name='prev' />
              </ViewerButton>
              <span aria-live='polite' data-fv-page-count={pageCount}>
                {page} / {pageCount}
              </span>
              <ViewerButton
                disabled={page >= pageCount}
                label='Next page'
                onClick={() => goTo(page + 1)}
              >
                <ViewerIcon name='next' />
              </ViewerButton>
              <ViewerButton
                disabled={zoomIndex <= 0}
                label={messages.zoomOut}
                onClick={() => setZoom(ZOOMS[zoomIndex - 1] ?? zoom)}
              >
                <ViewerIcon name='minus' />
              </ViewerButton>
              <ViewerButton
                disabled={zoomIndex >= ZOOMS.length - 1}
                label={messages.zoomIn}
                onClick={() => setZoom(ZOOMS[zoomIndex + 1] ?? zoom)}
              >
                <ViewerIcon name='plus' />
              </ViewerButton>
              <ViewerButton
                disabled={zoom === 1}
                label={messages.resetView}
                onClick={() => setZoom(1)}
              >
                <ViewerIcon name='reset' />
              </ViewerButton>
            </ViewerToolbar>
          ) : null}
        </>
      )}
    </ViewerRoot>
  );
}

function PdfPage({
  document: pdf,
  pageNumber,
  aspect,
  zoom,
  onFirstPageAspect,
}: {
  document: PDFDocumentProxy;
  pageNumber: number;
  aspect: number;
  zoom: number;
  onFirstPageAspect: (aspect: number) => void;
}) {
  const holderRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ownAspect, setOwnAspect] = useState<number | null>(null);

  useEffect(() => {
    if (visible) return;
    const holder = holderRef.current;
    if (!holder) return;
    if (typeof IntersectionObserver === 'undefined') {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: '400px' },
    );
    observer.observe(holder);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    const target = canvasRef.current;
    if (!visible || !target) return;
    let cancelled = false;
    let task: RenderTask | null = null;
    setFailed(false);

    void (async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled) return;
      const unscaled = page.getViewport({ scale: 1 });
      const pageAspect = unscaled.height / unscaled.width;
      setOwnAspect(pageAspect);
      if (pageNumber === 1) onFirstPageAspect(pageAspect);
      const cssWidth = holderRef.current?.clientWidth || FALLBACK_WIDTH;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: (cssWidth / unscaled.width) * dpr });

      // Render off-screen and blit: two pdf.js renders must never share a
      // canvas, and a cancelled one would leave the visible canvas half drawn.
      const buffer = document.createElement('canvas');
      buffer.width = Math.max(1, Math.round(viewport.width));
      buffer.height = Math.max(1, Math.round(viewport.height));
      task = page.render({ canvas: buffer, viewport });
      await task.promise;
      if (cancelled) return;
      target.width = buffer.width;
      target.height = buffer.height;
      const context = target.getContext('2d');
      if (!context) throw new Error('2D canvas context unavailable');
      context.drawImage(buffer, 0, 0);
      target.dataset.fvRendered = 'true';
      page.cleanup();
    })().catch((error: unknown) => {
      if (cancelled) return;
      console.error(`[viewers] PDF page ${pageNumber} failed to render`, error);
      setFailed(true);
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, pageNumber, visible, zoom, onFirstPageAspect]);

  return (
    <div
      data-fv-page={pageNumber}
      ref={holderRef}
      style={{
        width: `${zoom * 100}%`,
        aspectRatio: `1 / ${ownAspect ?? aspect}`,
        margin: '0 auto 0.5rem',
        background: '#fff',
      }}
    >
      {failed ? <ViewerFailure message={`Page ${pageNumber} could not be rendered.`} /> : null}
      <canvas
        aria-label={`Page ${pageNumber}`}
        hidden={failed}
        ref={canvasRef}
        role='img'
        style={{ display: failed ? 'none' : 'block', width: '100%', height: '100%' }}
      />
    </div>
  );
}
