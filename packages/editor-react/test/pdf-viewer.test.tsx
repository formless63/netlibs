import './test-dom.ts';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { configurePdfPreview, loadRichPdfjs, type RichPdfjs } from '../src/viewers/pdf-js-loader.ts';
import { RichPdfViewer } from '../src/viewers/pdf-viewer.tsx';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const RESOURCE_ID = '11111111-1111-4111-8111-111111111111';
const SRC = `/api/v1/library/media/${RESOURCE_ID}`;

const ASSETS = {
  workerSrc: '/pdfjs/worker.mjs',
  cMapUrl: '/pdfjs/cmaps/',
  standardFontDataUrl: '/pdfjs/fonts/',
  wasmUrl: '/pdfjs/wasm/',
  load: (): Promise<RichPdfjs> => Promise.reject(new Error('unavailable'))
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let originalCanvasGetContext: typeof window.HTMLCanvasElement.prototype.getContext;

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(node);
  });
  return container;
}

async function flushAsync(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

async function waitForAssertion(assertion: () => void, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await flushAsync();
    }
  }
  throw lastError;
}

interface RenderCall {
  pageNumber: number;
  width: number;
  height: number;
}

function stubPdfjs(
  numPages: number,
  calls: RenderCall[],
  getDocumentCalls: unknown[]
): RichPdfjs {
  return {
    GlobalWorkerOptions: { workerSrc: '' },
    getDocument: (params: Record<string, unknown>) => {
      getDocumentCalls.push(params);
      return {
        destroy: () => {},
        promise: Promise.resolve({
          numPages,
          destroy: () => {},
          getPage: (pageNumber: number) =>
            Promise.resolve({
              getViewport: ({ scale }: { scale: number }) => ({
                width: 612 * scale,
                height: 792 * scale
              }),
              render: ({ viewport }: { viewport: { width: number; height: number } }) => ({
                cancel: () => {},
                promise: Promise.resolve().then(() => {
                  calls.push({ pageNumber, width: viewport.width, height: viewport.height });
                })
              })
            })
        })
      };
    }
  };
}

beforeEach(() => {
  configurePdfPreview(ASSETS);
  originalCanvasGetContext = window.HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () => ({}) as CanvasRenderingContext2D,
    writable: true
  });
});

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
    root = null;
  }
  container?.remove();
  container = null;
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: originalCanvasGetContext,
    writable: true
  });
});

describe('RichPdfViewer', () => {
  it('renders visible pages through the configured PDF.js', async () => {
    const calls: RenderCall[] = [];
    const getDocumentCalls: unknown[] = [];
    const pdfjs = stubPdfjs(2, calls, getDocumentCalls);
    configurePdfPreview({ ...ASSETS, load: () => Promise.resolve(pdfjs) });

    const element = render(
      <RichPdfViewer className='viewer-size' src={SRC} title='manual.pdf' />
    );
    await waitForAssertion(() => expect(calls).toHaveLength(2));

    expect(pdfjs.GlobalWorkerOptions.workerSrc).toBe(ASSETS.workerSrc);
    expect(getDocumentCalls).toEqual([
      {
        url: SRC,
        cMapUrl: ASSETS.cMapUrl,
        cMapPacked: true,
        standardFontDataUrl: ASSETS.standardFontDataUrl,
        wasmUrl: ASSETS.wasmUrl,
        useWorkerFetch: true,
        isEvalSupported: false,
        enableScripting: false
      }
    ]);
    expect(
      element.querySelector('[data-testid="pdf-js-preview"]')?.classList.contains('viewer-size')
    ).toBe(true);
    expect(element.textContent).toContain('2 pages');
    expect(element.querySelectorAll('canvas')).toHaveLength(2);
    expect(element.querySelector('canvas')?.classList.contains('ce:block')).toBe(true);
    expect(calls.map((call) => call.pageNumber).toSorted()).toEqual([1, 2]);
    expect(calls[0]?.width).toBeGreaterThan(0);
    expect(element.querySelector('iframe')).toBeNull();
    expect(element.querySelector('object')).toBeNull();
  });

  it('shows actionable open and download controls when PDF.js cannot load', async () => {
    const originalConsoleError = console.error;
    console.error = () => {};
    try {
      const element = render(<RichPdfViewer src={SRC} title='manual.pdf' />);
      await waitForAssertion(() => expect(element.querySelectorAll('a')).toHaveLength(2));

      const anchors = [...element.querySelectorAll<HTMLAnchorElement>('a')];
      expect(anchors.map((anchor) => anchor.textContent?.trim())).toEqual(['Open PDF', 'Download']);
      expect(anchors.every((anchor) => anchor.getAttribute('href') === SRC)).toBe(true);
      expect(anchors[0]?.target).toBe('_blank');
      expect(anchors[1]?.hasAttribute('download')).toBe(true);
      expect(element.querySelector('canvas')).toBeNull();
    } finally {
      console.error = originalConsoleError;
    }
  });

  it('refuses an unsafe URL', async () => {
    const element = render(
      <RichPdfViewer src='javascript:alert(1)' title='manual.pdf' />
    );
    await flushAsync();

    expect(element.textContent).toContain('Preview unavailable');
    expect(element.querySelector('a')).toBeNull();
  });
});

describe('PDF.js loader', () => {
  it('shares concurrent loads and retries after a failure', async () => {
    let attempts = 0;
    configurePdfPreview({
      ...ASSETS,
      load: () => {
        attempts += 1;
        return attempts === 1
          ? Promise.reject(new Error('network'))
          : Promise.resolve(stubPdfjs(1, [], []));
      }
    });
    const first = loadRichPdfjs();
    expect(loadRichPdfjs()).toBe(first);
    await expect(first).rejects.toThrow('network');
    expect((await loadRichPdfjs()).GlobalWorkerOptions.workerSrc).toBe(ASSETS.workerSrc);
    expect(attempts).toBe(2);
  });
});
