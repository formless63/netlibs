// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { fixture, mount, registerCleanup, waitFor } from '../../../scripts/test-utils.tsx';
import { Markdown, MarkdownViewer } from '../src/index.ts';

registerCleanup();

describe('MarkdownViewer', () => {
  it('renders GFM and drops raw HTML and script links', async () => {
    const el = await mount(<MarkdownViewer source={new Blob([fixture('sample.md')])} />);
    await waitFor(() => el.querySelector('h1') !== null);
    expect(el.querySelector('table')).not.toBeNull();
    expect(el.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('.hljs-keyword')?.textContent).toBe('const');
    expect(el.innerHTML).not.toContain('javascript:');
    const link = [...el.querySelectorAll('a')].find((a) => a.textContent === 'safe link')!;
    expect(link.rel).toBe('noopener noreferrer');
  });

  it('hands matching fences to codeRenderers with the exact source', async () => {
    const el = await mount(
      <Markdown
        codeRenderers={{ mermaid: ({ code }) => <output>{code}</output> }}
        content={'```mermaid\nflowchart LR\n  A --> B\n```\n\n```constructor\nx\n```'}
      />,
    );
    expect(el.querySelector('output')?.textContent).toBe('flowchart LR\n  A --> B');
    expect(el.querySelectorAll('.fv-md-code')).toHaveLength(1);
  });

  it('still filters schemes after transformUrl', async () => {
    const el = await mount(
      <Markdown
        content='[a](one) ![b](two)'
        transformUrl={(url) => (url === 'one' ? 'javascript:alert(1)' : `/base/${url}`)}
      />,
    );
    expect(el.innerHTML).not.toContain('javascript:');
    expect(el.querySelector('img')?.getAttribute('src')).toBe('/base/two');
  });
});
