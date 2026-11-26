'use client';

import { useEffect, useId, useState } from 'react';

import type { MarkdownCodeRendererProps } from './markdown.tsx';

let initialized = false;

async function renderMermaid(id: string, code: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'neutral',
      // `strict` escapes label HTML and disables click handlers. The documents
      // are untrusted, so this must not be loosened.
      securityLevel: 'strict',
      // mermaid 12 defaults to ELK; dagre + classic keeps existing diagrams
      // laid out the way their authors saw them.
      layout: 'dagre',
      look: 'classic',
    });
    initialized = true;
  }
  try {
    return (await mermaid.render(id, code)).svg;
  } finally {
    // mermaid leaves its measuring node behind when a diagram fails to parse.
    document.getElementById(`d${id}`)?.remove();
  }
}

/** Mermaid renderer for `codeRenderers`. Needs the optional `mermaid` peer. */
export function MermaidDiagram({ code }: MarkdownCodeRendererProps) {
  const id = `fv-mmd-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    renderMermaid(id, code).then(
      (result) => {
        if (!cancelled) setSvg(result);
      },
      (error: unknown) => {
        console.error('[viewers] mermaid diagram failed', error);
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (failed || svg === null) return <pre className='fv-md-diagram-source'>{code}</pre>;
  // Safe sink: mermaid's own sanitised output under securityLevel 'strict'.
  return <div className='fv-md-diagram' dangerouslySetInnerHTML={{ __html: svg }} />;
}
