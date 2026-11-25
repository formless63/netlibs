// @vitest-environment jsdom
import { act, StrictMode, useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { mount, registerCleanup, waitFor } from '../../../scripts/test-utils.tsx';
import {
  createViewerRegistry,
  disposeViewerUrl,
  FileViewer,
  loadViewerText,
  loadViewerUrl,
  useResolvedSource,
  useViewerLoad,
  ViewerFailure,
  ViewerProvider,
  ViewerRoot,
  type FileViewerProps,
  type ViewerAdapter,
  type ViewerDefinition,
  type ViewerProps,
} from '../src/index.ts';

registerCleanup();
const MB = 1024 * 1024;

function Echo(props: ViewerProps) {
  const source = useResolvedSource(props);
  const { state, retry } = useViewerLoad(source, loadViewerText, {
    onStatusChange: props.onStatusChange,
  });
  return (
    <ViewerRoot label='echo' status={state.status} viewer='echo'>
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : (
        state.value
      )}
    </ViewerRoot>
  );
}
function Ratio({ onIntrinsicAspectRatio }: ViewerProps) {
  useEffect(() => onIntrinsicAspectRatio?.(3), [onIntrinsicAspectRatio]);
  return <i data-ratio />;
}
let shouldThrow = true;
function Thrower() {
  if (shouldThrow) throw new Error('boom');
  return <i data-recovered />;
}
const def = (
  key: string,
  Component: ViewerDefinition extends never ? never : (p: ViewerProps) => React.ReactNode,
  extra: Partial<ViewerDefinition> = {},
): ViewerDefinition => ({
  key,
  label: key,
  extensions: [key],
  contentTypes: [],
  load: async () => ({ default: Component as never }),
  ...extra,
});
const registry = createViewerRegistry([
  def('echo', Echo, { sniff: (head) => head[0] === 69 }),
  def('ratio', Ratio),
  def('thrower', Thrower),
]);

function show(props: FileViewerProps, adapter?: ViewerAdapter) {
  return (
    <ViewerProvider adapter={adapter} registry={registry}>
      <FileViewer {...props} />
    </ViewerProvider>
  );
}
const blob = new Blob(['Echo body']);

describe('FileViewer', () => {
  it('resolves by name and renders the lazy viewer', async () => {
    const onStatusChange = vi.fn();
    const el = await mount(show({ source: blob, name: 'a.echo', onStatusChange }));
    await waitFor(() => el.textContent?.includes('Echo body') === true);
    expect(onStatusChange.mock.calls.map((c) => c[0])).toEqual(['loading', 'ready']);
  });

  it('sniffs unnamed in-memory inputs and gives up cleanly', async () => {
    const el = await mount(show({ source: blob }));
    await waitFor(() => el.textContent?.includes('Echo body') === true);
    const other = await mount(show({ source: new Blob(['zzz']) }));
    await waitFor(() => other.querySelector('[data-fv-error="unsupported"]') !== null);
  });

  it('guards large files until asked, and only for that file', async () => {
    const el = await mount(show({ source: '/x', name: 'a.echo', sizeBytes: 60 * MB }));
    const button = el.querySelector('button')!;
    expect(button.textContent).toBe('Load preview (60 MB)');
    vi.stubGlobal('fetch', async () => new Response('loaded'));
    await act(async () => button.click());
    await waitFor(() => el.textContent?.includes('loaded') === true);
    await el.rerender(show({ source: '/y', name: 'b.echo', sizeBytes: 70 * MB }));
    expect(el.querySelector('.fv-guard')).not.toBeNull();
  });

  it('honours a custom guard, null for none, and unknown sizes', async () => {
    vi.stubGlobal('fetch', async () => new Response('ok'));
    const guarded = async (props: Partial<FileViewerProps>) =>
      (await mount(show({ source: '/x', name: 'a.echo', ...props }))).querySelector(
        '.fv-guard',
      ) !== null;
    expect(await guarded({ sizeBytes: 2 * MB, sizeGuardBytes: MB })).toBe(true);
    expect(await guarded({ sizeBytes: 500 * MB, sizeGuardBytes: null })).toBe(false);
    expect(await guarded({})).toBe(false);
  });

  it('takes the shape a viewer reports', async () => {
    const el = await mount(show({ source: blob, name: 'a.ratio' }));
    const body = el.querySelector<HTMLElement>('.fv-frame-body')!;
    await waitFor(() => body.style.aspectRatio.startsWith('3'));
  });

  it('contains a throwing viewer and recovers on retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    shouldThrow = true;
    const onError = vi.fn();
    const el = await mount(show({ source: blob, name: 'a.thrower' }, { onError }));
    await waitFor(() => el.querySelector('[data-fv-error="render-failed"]') !== null);
    expect(onError).toHaveBeenCalled();
    shouldThrow = false;
    const retry = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Try again')!;
    await act(async () => retry.click());
    await waitFor(() => el.querySelector('[data-recovered]') !== null);
  });

  it('offers retry, open and download when a fetch fails', async () => {
    let ok = false;
    vi.stubGlobal('fetch', async () => new Response('second time', { status: ok ? 200 : 503 }));
    const el = await mount(show({ source: '/files/a.echo' }));
    await waitFor(() => el.querySelector('[data-fv-error="http-status"]') !== null);
    expect([...el.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/files/a.echo',
      '/files/a.echo',
    ]);
    ok = true;
    await act(async () => el.querySelector('button')!.click());
    await waitFor(() => el.textContent?.includes('second time') === true);
  });

  it('never links to a script URL, and never links past an authenticated adapter', async () => {
    const bad = await mount(show({ source: 'javascript:alert(1)//a.zzz' }));
    expect(bad.querySelector('a')).toBeNull();
    const auth = await mount(show({ source: '/a.zzz' }, { fetch: async () => new Response('') }));
    expect(auth.querySelector('a')).toBeNull();
    expect(auth.querySelector('button')?.textContent).toBe('Download');
    const mapped = await mount(
      show(
        { source: '/a.zzz' },
        {
          fetch: async () => new Response(''),
          getDownloadHref: (u) => `${u}?download=1`,
          getOpenHref: () => null,
        },
      ),
    );
    expect([...mapped.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([
      '/a.zzz?download=1',
    ]);
  });

  it('stops native drags from escaping into a draggable ancestor', async () => {
    const onDragStart = vi.fn();
    const el = await mount(
      <div draggable onDragStart={onDragStart}>
        {show({ source: blob, name: 'a.echo' })}
      </div>,
    );
    await waitFor(() => el.querySelector('.fv-root') !== null);
    const root = el.querySelector<HTMLElement>('.fv-root')!;
    expect(root.getAttribute('draggable')).toBe('false');
    const event = new Event('dragstart', { bubbles: true, cancelable: true });
    root.firstChild!.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(onDragStart).not.toHaveBeenCalled();
  });

  it('loads nothing until it nears the viewport', async () => {
    let trigger: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          trigger = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const load = vi.fn(async () => ({ default: Echo as never }));
    const lazyRegistry = createViewerRegistry([{ ...def('echo', Echo), load }]);
    const el = await mount(
      <ViewerProvider registry={lazyRegistry}>
        <FileViewer name='a.echo' source={blob} />
      </ViewerProvider>,
    );
    expect(load).not.toHaveBeenCalled();
    await act(async () => trigger!([{ isIntersecting: true }]));
    await waitFor(() => el.textContent?.includes('Echo body') === true);
  });
});

describe('useViewerLoad lifecycle', () => {
  function UrlProbe(props: ViewerProps) {
    const { state } = useViewerLoad(useResolvedSource(props), loadViewerUrl, {
      dispose: disposeViewerUrl,
    });
    return <i data-url={state.value?.url} />;
  }
  it('revokes every object URL it creates, under StrictMode and source changes', async () => {
    const live = new Set<string>();
    let n = 0;
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      const url = `blob:${n++}`;
      live.add(url);
      return url;
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void live.delete(url));
    const el = await mount(
      <StrictMode>
        <UrlProbe source={blob} />
      </StrictMode>,
    );
    await waitFor(() => el.querySelector('[data-url]') !== null);
    expect(live.size).toBe(1);
    await el.rerender(
      <StrictMode>
        <UrlProbe source={new Blob(['2'])} />
      </StrictMode>,
    );
    await waitFor(() => live.size === 1);
    await el.rerender(<></>);
    expect(live.size).toBe(0);
  });
});
