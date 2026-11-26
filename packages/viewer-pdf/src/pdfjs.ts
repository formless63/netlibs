import type * as PdfjsModule from 'pdfjs-dist';

export type Pdfjs = typeof PdfjsModule;

export interface PdfConfig {
  /** Supply the pdf.js worker (a fresh one per call). Overrides the bundled worker. */
  createWorker?: (() => Worker) | undefined;
  /** URL of a hosted `pdf.worker.min.mjs`, for hosts that serve it statically. */
  workerSrc?: string | undefined;
  /**
   * Directory URL holding pdf.js's `standard_fonts/`, `cmaps/`, `wasm/` and
   * `iccs/` (copy them with the `viewer-pdf-assets` CLI). Without it, PDFs
   * that rely on non-embedded base-14 fonts use system fonts, and CJK CMaps,
   * JBIG2/JPEG2000 images and ICC colour may not render.
   */
  assetBaseUrl?: string | undefined;
}

let config: PdfConfig = {};

/** Process-wide pdf.js settings. Call once, before the first PDF renders. */
export function configurePdf(next: PdfConfig): void {
  config = { ...next };
  worker?.terminate();
  worker = null;
}

let worker: Worker | null = null;

function ensureWorker(pdfjs: Pdfjs): void {
  if (config.workerSrc && !config.createWorker) {
    pdfjs.GlobalWorkerOptions.workerSrc = config.workerSrc;
    return;
  }
  if (worker) return;
  worker = config.createWorker
    ? config.createWorker()
    : new Worker(new URL('./pdf-worker.js', import.meta.url), { type: 'module' });
  worker.addEventListener('error', () => {
    // Let the next document try a fresh worker rather than a dead one.
    if (worker) pdfjs.GlobalWorkerOptions.workerPort = null;
    worker = null;
  });
  pdfjs.GlobalWorkerOptions.workerPort = worker;
}

/** Lazy engine import. Never evaluated on the server. */
export async function loadPdfjs(): Promise<Pdfjs> {
  const pdfjs = await import('pdfjs-dist');
  ensureWorker(pdfjs);
  return pdfjs;
}

export function pdfAssetParams(): Record<string, string | boolean> {
  if (!config.assetBaseUrl) return {};
  const base = config.assetBaseUrl.replace(/\/*$/, '/');
  return {
    standardFontDataUrl: `${base}standard_fonts/`,
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    wasmUrl: `${base}wasm/`,
    iccUrl: `${base}iccs/`,
  };
}
