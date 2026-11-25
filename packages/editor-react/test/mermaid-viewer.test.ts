
import { describe, expect, it } from 'bun:test';

import './test-dom.ts';

import { buildRichMermaidSandboxDocument, RICH_MERMAID_CONFIG } from '../src/viewers/mermaid-viewer.tsx';

describe('Mermaid sandbox document', () => {
  it('forces SVG text labels because sandbox sanitization removes HTML labels', () => {
    expect(RICH_MERMAID_CONFIG.htmlLabels).toBe(false);
    expect(RICH_MERMAID_CONFIG.flowchart.htmlLabels).toBe(false);
  });

  it('removes executable SVG content and blocks network access', () => {
    const document = buildRichMermaidSandboxDocument(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><foreignObject>unsafe</foreignObject><text>Visible label</text><a href="https://example.invalid">link</a><path onclick="alert(1)" d="M0 0"/></svg>'
    );

    expect(document).toContain("default-src 'none'");
    expect(document).not.toContain('<script');
    expect(document).not.toContain('<foreignObject');
    expect(document).not.toContain('https://example.invalid');
    expect(document).not.toContain('onclick=');
    expect(document).toContain('<text>Visible label</text>');
  });
});
