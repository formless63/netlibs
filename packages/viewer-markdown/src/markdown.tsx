'use client';

import {
  isValidElement,
  useState,
  type ComponentType,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

export interface MarkdownCodeRendererProps {
  code: string;
}

export interface MarkdownProps {
  content: string;
  /**
   * Fenced-block renderers by language, e.g. `{ mermaid: MermaidDiagram }`
   * from `@formless63/viewer-markdown/mermaid`.
   */
  codeRenderers?: Readonly<Record<string, ComponentType<MarkdownCodeRendererProps>>> | undefined;
  /** Rewrite link and image URLs (e.g. relative paths). Runs before react-markdown's scheme filter. */
  transformUrl?: ((url: string) => string) | undefined;
}

/** Recursively extract plain text from React children, for the copy buffer. */
export function extractText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement(node)) {
    return extractText((node as ReactElement<{ children?: ReactNode }>).props.children);
  }
  return '';
}

function CodeBlock({
  language,
  code,
  children,
}: {
  language: string | null;
  code: string;
  children: ReactNode;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('[viewers] copy failed', error);
    }
  };
  return (
    <div className='fv-md-code'>
      <div className='fv-md-code-bar'>
        <span>{language ?? 'code'}</span>
        <button className='fv-text-button' onClick={() => void copy()} type='button'>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  );
}

/**
 * GitHub-flavoured Markdown. Raw HTML in the document shows as text (no
 * rehype-raw), so untrusted files cannot inject markup.
 */
export function Markdown({ content, codeRenderers, transformUrl }: MarkdownProps) {
  return (
    <div className='fv-md'>
      <ReactMarkdown
        components={{
          pre: ({ children }) => {
            const props = isValidElement(children)
              ? (children.props as HTMLAttributes<HTMLElement>)
              : undefined;
            const language = /language-([\w+#.-]+)/.exec(props?.className ?? '')?.[1] ?? null;
            const code = extractText(props?.children).replace(/\n$/, '');
            const Renderer =
              language && codeRenderers && Object.hasOwn(codeRenderers, language)
                ? codeRenderers[language]
                : undefined;
            if (Renderer) return <Renderer code={code} />;
            return (
              <CodeBlock code={code} language={language}>
                {children}
              </CodeBlock>
            );
          },
          table: ({ children }) => (
            <div className='fv-md-table'>
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) =>
            href?.startsWith('#') ? (
              <a href={href}>{children}</a>
            ) : (
              <a href={href} rel='noopener noreferrer' target='_blank'>
                {children}
              </a>
            ),
        }}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        remarkPlugins={[remarkGfm]}
        {...(transformUrl ? { urlTransform: (url: string) => defaultSafe(transformUrl(url)) } : {})}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function defaultSafe(url: string): string {
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim())?.[1]?.toLowerCase();
  return scheme === undefined || ['http', 'https', 'mailto', 'blob'].includes(scheme) ? url : '';
}
