import { useEffect, useId, useState } from 'react';

import { cn } from '../ui/cn.ts';

export interface RichMermaidViewerProps {
  source: string;
  className?: string;
}

interface RichMermaidRenderState {
  source: string;
  sourceDocument: string | null;
  error: string | null;
}

const MERMAID_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; base-uri 'none'; form-action 'none'";

export const RICH_MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: 'strict',
  suppressErrorRendering: true,
  // Mermaid 12 switched the defaults to the bundled ELK layout and the
  // `neo` look / `redux-color` theme. Keep the Mermaid 11 rendering: dagre
  // lays out on the main thread in milliseconds where ELK can block for
  // seconds on a large flowchart (mermaid#8777), and a dependency bump
  // should not restyle every stored diagram. Diagram front matter still
  // overrides these per diagram.
  layout: 'dagre',
  look: 'classic',
  theme: 'default',
  htmlLabels: false,
  flowchart: {
    htmlLabels: false
  }
} as const;

function stripUnsafeSvgContent(svg: string): string {
  const parser = new DOMParser();
  const document = parser.parseFromString(svg, 'image/svg+xml');
  if (document.querySelector('parsererror')) throw new Error('Mermaid returned invalid SVG');

  for (const element of document.querySelectorAll(
    'script, foreignObject, iframe, object, embed, audio, video'
  )) {
    element.remove();
  }
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (
        name.startsWith('on') ||
        ((name === 'href' || name === 'xlink:href') &&
          (value.startsWith('javascript:') ||
            value.startsWith('data:text/html') ||
            value.startsWith('http:') ||
            value.startsWith('https:') ||
            value.startsWith('//')))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}

export function buildRichMermaidSandboxDocument(svg: string): string {
  const safeSvg = stripUnsafeSvgContent(svg);
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${MERMAID_CSP}"><style>html,body{margin:0;padding:0;background:transparent}svg{display:block;max-width:100%;height:auto;margin:auto}</style></head><body>${safeSvg}</body></html>`;
}

export function RichMermaidViewer({ source, className }: RichMermaidViewerProps) {
  const reactId = useId().replace(/[^A-Za-z0-9_-]/g, '');
  const [renderState, setRenderState] = useState<RichMermaidRenderState>({
    source: '',
    sourceDocument: null,
    error: null
  });

  useEffect(() => {
    let cancelled = false;
    if (!source.trim()) return;

    void import('mermaid')
      .then(async ({ default: mermaid }) => {
        mermaid.initialize(RICH_MERMAID_CONFIG);
        return mermaid.render(`rich-mermaid-${reactId}`, source);
      })
      .then(({ svg }) => {
        if (!cancelled) {
          setRenderState({
            source,
            sourceDocument: buildRichMermaidSandboxDocument(svg),
            error: null
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRenderState({
            source,
            sourceDocument: null,
            error: 'This Mermaid diagram could not be rendered.'
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [reactId, source]);

  const currentRender = renderState.source === source ? renderState : null;
  const error = source.trim()
    ? (currentRender?.error ?? null)
    : 'Add Mermaid source to preview this diagram.';
  const sourceDocument = currentRender?.sourceDocument ?? null;

  if (error) {
    return (
      <p className={cn('ce:text-sm ce:text-destructive-ink', className)} role='alert'>
        {error}
      </p>
    );
  }
  if (!sourceDocument) {
    return (
      <p className={cn('ce:text-sm ce:text-muted-foreground', className)} role='status'>
        Rendering diagram…
      </p>
    );
  }

  return (
    <iframe
      className={cn('ce:h-80 ce:w-full ce:rounded-md ce:border ce:bg-card', className)}
      loading='lazy'
      referrerPolicy='no-referrer'
      sandbox=''
      srcDoc={sourceDocument}
      title='Mermaid diagram preview'
    />
  );
}
