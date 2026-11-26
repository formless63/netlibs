// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { fixture, mount, registerCleanup, waitFor } from '../../../scripts/test-utils.tsx';
import { HtmlViewer, imageDefinition, ImageViewer, TextViewer } from '../src/index.ts';
import { withLocalOnlyPolicy } from '../src/html-viewer.tsx';

registerCleanup();

describe('HtmlViewer', () => {
  const source = new Blob([fixture('hostile.html')], { type: 'text/html' });

  it('keeps the sandbox EMPTY and blocks remote content by default', async () => {
    const el = await mount(<HtmlViewer name='a.html' source={source} />);
    await waitFor(() => el.querySelector('iframe') !== null);
    const frame = el.querySelector('iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain("default-src 'none'");
  });

  it('can allow remote content without ever loosening the sandbox', async () => {
    const el = await mount(<HtmlViewer remoteContent source={source} />);
    await waitFor(() => el.querySelector('iframe') !== null);
    expect(el.querySelector('iframe')!.getAttribute('srcdoc')).not.toContain(
      'Content-Security-Policy',
    );
    expect(el.querySelector('iframe')!.getAttribute('sandbox')).toBe('');
  });

  it('inserts the policy after a doctype, so documents stay out of quirks mode', () => {
    expect(withLocalOnlyPolicy('\n<!-- hi --><!DOCTYPE html><p>x')).toMatch(
      /^\n<!-- hi --><!DOCTYPE html><meta http-equiv/,
    );
    expect(withLocalOnlyPolicy('<p>x')).toMatch(/^<meta/);
  });

  it('falls back to an image when the page was never captured', async () => {
    vi.stubGlobal('fetch', async () => new Response('', { status: 503 }));
    const el = await mount(<HtmlViewer fallbackImage='/shot.png' source='/page.html' />);
    await waitFor(() => el.querySelector('img') !== null);
    expect(el.querySelector('img')!.getAttribute('src')).toBe('/shot.png');
  });
});

describe('ImageViewer', () => {
  it('reports the natural shape, then degrades if decoding fails', async () => {
    const onIntrinsicAspectRatio = vi.fn();
    const onStatusChange = vi.fn();
    const el = await mount(
      <ImageViewer {...{ onIntrinsicAspectRatio, onStatusChange }} source='/a.png' />,
    );
    const img = el.querySelector('img')!;
    Object.defineProperties(img, { naturalWidth: { value: 64 }, naturalHeight: { value: 32 } });
    await act(async () => img.dispatchEvent(new Event('load')));
    expect(onIntrinsicAspectRatio).toHaveBeenCalledWith(2);
    expect(onStatusChange).toHaveBeenLastCalledWith('ready');
    await act(async () => img.dispatchEvent(new Event('error')));
    expect(el.querySelector('[data-fv-error="parse-failed"]')).not.toBeNull();
  });

  it('sniffs common raster formats', () => {
    expect(imageDefinition.sniff!(fixture('gradient.png'))).toBe(true);
    expect(imageDefinition.sniff!(fixture('three-pages.pdf'))).toBe(false);
  });
});

describe('TextViewer', () => {
  it('shows markup verbatim and truncates huge files until asked', async () => {
    const el = await mount(
      <TextViewer maxCharacters={10} source={new Blob(['<b>x</b>'.repeat(10)])} />,
    );
    await waitFor(() => el.querySelector('pre') !== null);
    expect(el.querySelector('b')).toBeNull();
    expect(el.querySelector('pre')!.textContent).toHaveLength(10);
    await act(async () => el.querySelector('button')!.click());
    expect(el.querySelector('pre')!.textContent).toHaveLength(80);
  });
});
