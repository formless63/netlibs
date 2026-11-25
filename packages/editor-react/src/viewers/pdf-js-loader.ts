/**
 * PDF.js loading. The host decides where the library and its assets come from;
 * nothing here falls back to a CDN. `pdfjs-dist` is an optional peer.
 */

export interface RichPdfViewport {
  width: number;
  height: number;
}

export interface RichPdfRenderTask {
  promise: Promise<void>;
  cancel: () => void;
}

export interface RichPdfPage {
  getViewport: (params: { scale: number }) => RichPdfViewport;
  render: (params: {
    canvasContext: CanvasRenderingContext2D;
    viewport: RichPdfViewport;
  }) => RichPdfRenderTask;
  cleanup?: () => void;
}

export interface RichPdfDocument {
  numPages: number;
  getPage: (pageNumber: number) => Promise<RichPdfPage>;
  destroy: () => Promise<void> | void;
}

export interface RichPdfjs {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (params: Record<string, unknown>) => {
    promise: Promise<RichPdfDocument>;
    destroy: () => Promise<void> | void;
  };
}

export interface RichPdfjsConfig {
  /** Resolves the PDF.js module. Default: `import('pdfjs-dist')`. */
  load?: () => Promise<RichPdfjs>;
  /** Worker URL, e.g. Vite's `import url from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`. */
  workerSrc: string;
  /** Directory URLs (with a trailing slash) for the assets copied out of `pdfjs-dist`. */
  cMapUrl?: string;
  standardFontDataUrl?: string;
  wasmUrl?: string;
}

let config: RichPdfjsConfig | null = null;
let loadPromise: Promise<RichPdfjs> | null = null;

/** Enables inline PDF previews. Until it is called, PDFs show open/download links. */
export function configurePdfPreview(next: RichPdfjsConfig): void {
  config = next;
  loadPromise = null;
}

export function getPdfPreviewConfig(): RichPdfjsConfig | null {
  return config;
}

export function loadRichPdfjs(): Promise<RichPdfjs> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('PDF.js requires a browser environment'));
  }
  if (!config) return Promise.reject(new Error('PDF preview is not configured'));
  const { workerSrc, load } = config;
  loadPromise ??= (
    load?.() ?? (import('pdfjs-dist') as unknown as Promise<RichPdfjs>)
  ).then(
    (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;
      return pdfjs;
    },
    (error: unknown) => {
      loadPromise = null;
      throw error;
    }
  );
  return loadPromise;
}
