// Node environment on purpose: no window, document, customElements or Worker.
import { renderToString } from 'react-dom/server';
import { prerender } from 'react-dom/static';
import { describe, expect, it } from 'vitest';

import { FileViewer, ViewerProvider } from '../src/index.ts';
import { createDefaultRegistry, defaultViewerDefinitions } from '../src/registry.ts';

const registry = createDefaultRegistry();

describe('server rendering', () => {
  it('runs without browser globals', () => {
    expect(typeof window).toBe('undefined');
    expect(typeof document).toBe('undefined');
  });

  it.each(defaultViewerDefinitions.map((d) => [d.key, d] as const))(
    '%s renders on the server without touching its engine',
    async (_key, definition) => {
      const { default: Viewer } = await definition.load();
      const html = renderToString(<Viewer name='x' source='/x' />);
      expect(html).toContain(`data-fv-viewer="${definition.key}"`);
      expect(html).toContain('data-fv-status="loading"');
    },
  );

  it('FileViewer reserves its box without loading a viewer', async () => {
    const { prelude } = await prerender(
      <ViewerProvider registry={registry}>
        <FileViewer header name='a.pdf' source='/a.pdf' />
      </ViewerProvider>,
    );
    const html = await new Response(prelude).text();
    expect(html).toContain('data-fv-frame="pdf"');
    expect(html).toContain('aspect-ratio:8.5 / 11');
    expect(html).not.toContain('data-fv-viewer');
  });
});
