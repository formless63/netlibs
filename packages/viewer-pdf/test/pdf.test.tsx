// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, mount, registerCleanup, waitFor } from '../../../scripts/test-utils.tsx';

const engine = vi.hoisted(() => ({
  getDocument: vi.fn(),
  destroy: vi.fn(),
  rendered: [] as number[],
  GlobalWorkerOptions: { workerPort: null as unknown, workerSrc: '' },
}));
vi.mock('pdfjs-dist', () => ({
  getDocument: engine.getDocument,
  GlobalWorkerOptions: engine.GlobalWorkerOptions,
}));

const { configurePdf, browserRendersPdfInline, pdfDefinition, PdfViewer } =
  await import('../src/index.ts');

registerCleanup();

function setNative(value: boolean) {
  Object.defineProperty(navigator, 'pdfViewerEnabled', { configurable: true, value });
}

beforeEach(() => {
  engine.rendered = [];
  engine.destroy.mockReset();
  engine.getDocument.mockReset().mockImplementation(() => ({
    destroy: engine.destroy,
    promise: Promise.resolve({
      numPages: 3,
      getPage: async (n: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: 612 * scale,
          height: 792 * scale,
        }),
        render: () => ({
          promise: Promise.resolve().then(() => void engine.rendered.push(n)),
          cancel() {},
        }),
        cleanup() {},
      }),
    }),
  }));
  configurePdf({ workerSrc: '/pdf.worker.mjs' });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as never);
});

describe('PdfViewer renderer choice', () => {
  it('uses the browser viewer with the direct URL, and never loads pdf.js for it', async () => {
    setNative(true);
    expect(browserRendersPdfInline()).toBe(true);
    const el = await mount(<PdfViewer source='/a.pdf' />);
    await waitFor(() => el.querySelector('object') !== null);
    expect(el.querySelector('object')!.getAttribute('data')).toBe('/a.pdf');
    expect(engine.getDocument).not.toHaveBeenCalled();
  });

  it('types blobs as PDF for the native path, or browsers download them', async () => {
    setNative(true);
    const created: Blob[] = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => (created.push(b as Blob), 'blob:1'));
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const el = await mount(<PdfViewer source={fixture('three-pages.pdf')} />);
    await waitFor(() => el.querySelector('object') !== null);
    expect(created[0]!.type).toBe('application/pdf');
  });

  it('uses pdf.js where the browser cannot, with streaming URLs and asset params', async () => {
    setNative(false);
    configurePdf({ workerSrc: '/w.mjs', assetBaseUrl: '/pdfjs' });
    const el = await mount(<PdfViewer source='/a.pdf' />);
    await waitFor(() => engine.rendered.length === 3);
    expect(engine.getDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/a.pdf',
        standardFontDataUrl: '/pdfjs/standard_fonts/',
        wasmUrl: '/pdfjs/wasm/',
      }),
    );
    expect(engine.GlobalWorkerOptions.workerSrc).toBe('/w.mjs');
    expect(el.querySelector('[data-fv-page-count="3"]')).not.toBeNull();
  });

  it('passes bytes for in-memory sources and destroys the document on unmount', async () => {
    const el = await mount(<PdfViewer mode='canvas' source={fixture('three-pages.pdf')} />);
    await waitFor(() => engine.rendered.length === 3);
    expect(engine.getDocument.mock.calls[0]![0].data).toHaveLength(
      fixture('three-pages.pdf').length,
    );
    await el.rerender(<></>);
    expect(engine.destroy).toHaveBeenCalled();
  });

  it('steps zoom and returns to fit', async () => {
    const el = await mount(<PdfViewer mode='canvas' source={fixture('three-pages.pdf')} />);
    await waitFor(() => el.querySelector('[data-fv-page]') !== null);
    const button = (label: string) =>
      el.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    const width = () => el.querySelector<HTMLElement>('[data-fv-page="1"]')!.style.width;
    await act(async () => button('Zoom in').click());
    expect(width()).toBe('125%');
    await act(async () => button('Reset view').click());
    expect(width()).toBe('100%');
  });

  it('degrades to an actionable failure on a corrupt file', async () => {
    engine.getDocument.mockImplementation(() => ({
      destroy: engine.destroy,
      promise: Promise.reject(new Error('Invalid PDF')),
    }));
    const el = await mount(<PdfViewer mode='canvas' source='/bad.pdf' />);
    await waitFor(() => el.querySelector('[data-fv-error="parse-failed"]') !== null);
    expect(el.querySelector('a')?.getAttribute('href')).toBe('/bad.pdf');
  });
});

it('sniffs PDFs', () => {
  expect(pdfDefinition.sniff!(fixture('three-pages.pdf'))).toBe(true);
  expect(pdfDefinition.sniff!(fixture('sample.md'))).toBe(false);
});
