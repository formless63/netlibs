import { describe, expect, it, vi } from 'vitest';

import { ResolvedSource, safeHref, ViewerError } from '../src/index.ts';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('ResolvedSource inputs', () => {
  it('reads every in-memory kind', async () => {
    const data = bytes('hello');
    const padded = new Uint8Array([0, ...data, 0]).subarray(1, 6);
    for (const input of [new Blob([data]), new File([data], 'a.txt'), data.buffer, data, padded]) {
      const source = new ResolvedSource(input as ArrayBuffer, {});
      expect(await source.text()).toBe('hello');
      expect(source.file.sizeBytes).toBe(5);
      expect(source.href).toBeNull();
    }
  });

  it('hands out copies, because engines detach the buffer they are given', async () => {
    const data = bytes('abc');
    const source = new ResolvedSource(data.buffer, {});
    const first = await source.arrayBuffer();
    structuredClone(first, { transfer: [first] });
    expect(first.byteLength).toBe(0);
    expect(data.byteLength).toBe(3);
    expect(await source.text()).toBe('abc');
  });

  it('infers names from files and URL paths, not from opaque URLs', () => {
    const name = (input: string | URL | File) => new ResolvedSource(input, {}).file.name;
    expect(name(new File([], 'part.stl'))).toBe('part.stl');
    expect(name('/files/my%20board.kicad_pcb?v=2#x')).toBe('my board.kicad_pcb');
    expect(name(new URL('https://x.test/a/b.pdf'))).toBe('b.pdf');
    expect(name('/api/resources/123/content')).toBeUndefined();
    expect(name('blob:https://x.test/uuid.pdf')).toBeUndefined();
    expect(name('/bad%zz.pdf')).toBe('bad%zz.pdf');
  });

  it('gives an untyped blob the known content type', async () => {
    const source = new ResolvedSource(new Blob(['x']), { contentType: 'image/png' });
    expect((await source.blob()).type).toBe('image/png');
  });
});

describe('ResolvedSource URLs and adapters', () => {
  it('uses the adapter fetch and resolveUrl, and stops allowing direct URLs', async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => new Response('ok'));
    const source = new ResolvedSource('file:42', {}, { fetch, resolveUrl: (u) => `/signed/${u}` });
    expect(source.canUseUrlDirectly).toBe(false);
    expect(await source.text()).toBe('ok');
    expect(fetch.mock.calls[0]?.[0]).toBe('/signed/file:42');
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'same-origin' });
    expect(new ResolvedSource('/a.pdf', {}).canUseUrlDirectly).toBe(true);
  });

  it('reports HTTP failures and network failures distinctly', async () => {
    const http = new ResolvedSource(
      '/a',
      {},
      { fetch: async () => new Response('', { status: 403 }) },
    );
    await expect(http.text()).rejects.toMatchObject({ code: 'http-status', status: 403 });
    const net = new ResolvedSource(
      '/a',
      {},
      {
        fetch: async () => {
          throw new TypeError('offline');
        },
      },
    );
    await expect(net.text()).rejects.toMatchObject({ code: 'fetch-failed' });
  });

  it('lets aborts through untouched', async () => {
    const source = new ResolvedSource(
      '/a',
      {},
      {
        fetch: async () => {
          throw new DOMException('aborted', 'AbortError');
        },
      },
    );
    await expect(source.text()).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('enforces maxBytes on blobs, declared lengths and undeclared streams', async () => {
    const maxBytes = 4;
    const tooLarge = { code: 'too-large' };
    await expect(
      new ResolvedSource(new Blob(['12345']), {}, { maxBytes }).text(),
    ).rejects.toMatchObject(tooLarge);
    await expect(
      new ResolvedSource(
        '/a',
        {},
        { maxBytes, fetch: async () => new Response('x', { headers: { 'content-length': '99' } }) },
      ).text(),
    ).rejects.toMatchObject(tooLarge);
    const stream = () =>
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < 3; i++) controller.enqueue(new Uint8Array(3));
          controller.close();
        },
      });
    await expect(
      new ResolvedSource('/a', {}, { maxBytes, fetch: async () => new Response(stream()) }).text(),
    ).rejects.toMatchObject(tooLarge);
    expect(
      await new ResolvedSource(
        '/a',
        {},
        { maxBytes, fetch: async () => new Response('1234') },
      ).text(),
    ).toBe('1234');
  });

  it('keeps an adapter ViewerError as thrown', async () => {
    const error = new ViewerError('unsupported', 'no');
    const source = new ResolvedSource('/a', {}, { fetch: () => Promise.reject(error) });
    await expect(source.text()).rejects.toBe(error);
  });
});

describe('safeHref', () => {
  it('allows relative, http(s) and blob, and nothing else', () => {
    for (const ok of [
      '/a',
      'a/b.pdf',
      '?x=1',
      'https://x.test/a',
      'HTTP://x',
      'blob:https://x/1',
    ]) {
      expect(safeHref(ok)).toBe(ok);
    }
    for (const bad of [
      'javascript:alert(1)',
      ' java\nscript:alert(1)',
      'data:text/html,x',
      'vbscript:x',
      '',
      null,
    ]) {
      expect(safeHref(bad)).toBeNull();
    }
  });
});
