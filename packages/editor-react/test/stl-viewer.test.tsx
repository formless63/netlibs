import './test-dom.ts';

import { readFileSync } from 'node:fs';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';

import RichStlViewer, {
  RICH_STL_AUTOLOAD_MAX_BYTES,
  richStlRenderSampling,
  richStlTriangleSummary
} from '../src/viewers/stl-viewer.tsx';
import { RICH_STL_MAX_BYTES } from '../src/viewers/stl-parser.ts';

const RESOURCE_ID = '11111111-1111-4111-8111-111111111111';
const SRC = `/api/v1/library/media/${RESOURCE_ID}`;
const FIXTURE = readFileSync(new URL('./__fixtures__/tetrahedron.stl', import.meta.url));

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let originalCanvasGetContext: typeof window.HTMLCanvasElement.prototype.getContext;
let originalFetch: typeof globalThis.fetch;
let fillCalls = 0;

function installFetch(fetchImplementation: typeof globalThis.fetch): void {
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value: fetchImplementation,
    writable: true
  });
}

function render(node: React.ReactElement): HTMLDivElement {
  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container as HTMLDivElement);
    root.render(node);
  });
  return container;
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
      await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    }
  }
  throw lastError;
}

beforeEach(() => {
  fillCalls = 0;
  originalFetch = globalThis.fetch;
  originalCanvasGetContext = window.HTMLCanvasElement.prototype.getContext;
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: () =>
      ({
        beginPath: () => {},
        clearRect: () => {},
        closePath: () => {},
        fill: () => {
          fillCalls += 1;
        },
        fillStyle: '',
        globalAlpha: 1,
        lineJoin: 'round',
        lineTo: () => {},
        lineWidth: 1,
        moveTo: () => {},
        setTransform: () => {},
        stroke: () => {},
        strokeStyle: ''
      }) as unknown as CanvasRenderingContext2D,
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
  installFetch(originalFetch);
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value: originalCanvasGetContext,
    writable: true
  });
});

describe('RichStlViewer', () => {
  it('caps rendered facets and labels sampled geometry honestly', () => {
    expect(richStlRenderSampling(200_000)).toEqual({
      triangleStride: 7,
      renderedTriangleCount: 28_572,
      isDecimated: true
    });
    expect(richStlTriangleSummary(200_000)).toBe(
      '28,572 of 200,000 triangles shown (sampled preview)'
    );
    expect(richStlTriangleSummary(4)).toBe('4 triangles');
  });

  it('fetches authorized fixture bytes and draws every tetrahedron facet', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(FIXTURE, {
          headers: { 'content-length': String(FIXTURE.byteLength) }
        })
    );
    installFetch(fetchMock as unknown as typeof globalThis.fetch);

    const element = render(<RichStlViewer src={SRC} title='tetrahedron.stl' />);
    await waitForAssertion(() => expect(fillCalls).toBe(4));

    expect(fetchMock).toHaveBeenCalledWith(
      SRC,
      expect.objectContaining({
        credentials: 'same-origin',
        signal: expect.any(AbortSignal)
      })
    );
    expect(element.textContent).toContain('4 triangles');
    expect(element.querySelector('canvas')?.getAttribute('tabindex')).toBe('0');
  });

  it('requires an explicit click before loading a known large model', async () => {
    const fetchMock = vi.fn();
    installFetch(fetchMock as unknown as typeof globalThis.fetch);
    const sizeBytes = RICH_STL_AUTOLOAD_MAX_BYTES + 1;
    const element = render(
      <RichStlViewer sizeBytes={sizeBytes} src={SRC} title='large-part.stl' />
    );
    await waitForAssertion(() => expect(element.textContent).toContain('Load 3D preview (8 MB)'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a known oversized model without fetching it', async () => {
    const fetchMock = vi.fn();
    installFetch(fetchMock as unknown as typeof globalThis.fetch);
    const element = render(
      <RichStlViewer
        sizeBytes={RICH_STL_MAX_BYTES + 1}
        src={SRC}
        title='oversized-part.stl'
      />
    );
    await waitForAssertion(() => expect(element.textContent).toContain('limited to 20 MB'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('aborts an in-flight authorized fetch when the viewer unmounts', async () => {
    const requestState: { signal?: AbortSignal } = {};
    installFetch(
      vi.fn((_url: string | URL | Request, options?: RequestInit) => {
        if (!options) throw new Error('Expected fetch options.');
        requestState.signal = options.signal as AbortSignal;
        return new Promise<Response>(() => {});
      }) as unknown as typeof globalThis.fetch
    );
    render(<RichStlViewer src={SRC} title='slow-part.stl' />);
    await waitForAssertion(() => expect(requestState.signal).toBeDefined());

    act(() => root?.unmount());
    root = null;
    expect(requestState.signal?.aborted).toBe(true);
  });

  it('rejects unsafe URLs before fetching bytes', () => {
    const fetchMock = vi.fn();
    installFetch(fetchMock as unknown as typeof globalThis.fetch);
    const element = render(
      <RichStlViewer src='//example.invalid/part.stl' title='part.stl' />
    );

    expect(element.textContent).toContain('Preview unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
