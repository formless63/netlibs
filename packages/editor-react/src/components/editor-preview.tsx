import {
  importMarkdown,
  validateEditorDocument,
  type RichImportFinding,
  type RichMarkdownImportOptions,
  type EditorDocument,
  type EditorResolver
} from '@formless63/editor-core';
import { RenderDocument } from '@formless63/editor-renderer';
import { useEffect, useState, type JSX } from 'react';

import { cn } from '../ui/cn.ts';

export interface EditorPreviewProps {
  /** The live source-mode buffer text. */
  markdown: string;
  /** Metadata for the references already in the document, captured on entering source mode. */
  referenceManifest: RichMarkdownImportOptions['referenceManifest'];
  resolver: EditorResolver;
  /** Idle delay after the last keystroke before the buffer is reconverted. */
  debounceMs?: number;
  className?: string;
}

export interface RichPreviewConversion {
  findings: RichImportFinding[];
  canCommit: boolean;
  /** The converted document, or an empty placeholder when it is not structurally valid. */
  renderDocument: EditorDocument;
  renderFailed: boolean;
}

export const RICH_PREVIEW_FALLBACK_DOCUMENT: EditorDocument = {
  type: 'doc',
  content: [{ type: 'paragraph' }]
};

/** Half-typed Markdown must never throw into the React tree. */
export function computeRichPreviewConversion(
  markdown: string,
  options: RichMarkdownImportOptions
): RichPreviewConversion {
  try {
    const result = importMarkdown(markdown, options);
    const safe = validateEditorDocument(result.document).success;
    return {
      findings: result.findings,
      canCommit: result.canCommit,
      renderDocument: safe ? result.document : RICH_PREVIEW_FALLBACK_DOCUMENT,
      renderFailed: !safe
    };
  } catch (error) {
    console.error('[rich-editor] preview markdown conversion threw', error);
    return {
      findings: [
        {
          code: 'invalid_canonical_document',
          severity: 'error',
          message: 'This Markdown could not be converted for preview.'
        }
      ],
      canCommit: false,
      renderDocument: RICH_PREVIEW_FALLBACK_DOCUMENT,
      renderFailed: true
    };
  }
}

/**
 * Live preview for source mode: the buffer goes through the same importer a
 * save commits with, then through the public read-only renderer, so what is
 * shown is what a reader will get.
 */
export function EditorPreview({
  markdown,
  referenceManifest,
  resolver,
  debounceMs = 500,
  className
}: EditorPreviewProps): JSX.Element {
  const [conversion, setConversion] = useState<RichPreviewConversion>(() =>
    computeRichPreviewConversion(markdown, { referenceManifest })
  );

  useEffect(() => {
    const timer = setTimeout(
      () => setConversion(computeRichPreviewConversion(markdown, { referenceManifest })),
      debounceMs
    );
    return () => clearTimeout(timer);
  }, [markdown, referenceManifest, debounceMs]);

  return (
    <div className={cn('ce:flex ce:h-full ce:flex-col ce:overflow-hidden', className)} data-rich-preview=''>
      {conversion.findings.length > 0 ? (
        <div
          className='ce:shrink-0 ce:border-b ce:bg-warning/10 ce:px-4 ce:py-2 ce:text-xs ce:text-warning-ink'
          role='status'
        >
          <p className='ce:font-medium'>
            {conversion.findings.length} issue{conversion.findings.length === 1 ? '' : 's'} in this
            Markdown — preview is a best-effort conversion and won&apos;t be committable until
            resolved.
          </p>
          <ul className='ce:mt-1 ce:list-disc ce:space-y-0.5 ce:pl-4'>
            {conversion.findings.slice(0, 5).map((finding, index) => (
              <li key={`${finding.code}-${index}`}>{finding.message}</li>
            ))}
          </ul>
          {conversion.findings.length > 5 ? (
            <p className='ce:mt-1'>+{conversion.findings.length - 5} more</p>
          ) : null}
        </div>
      ) : null}
      {conversion.renderFailed ? (
        <div
          className='ce:shrink-0 ce:border-b ce:bg-destructive/10 ce:px-4 ce:py-2 ce:text-xs ce:text-destructive-ink'
          data-rich-preview-unavailable=''
          role='alert'
        >
          <p className='ce:font-medium'>
            Preview unavailable for this Markdown — showing a placeholder until it resolves to a
            valid document. Your typed Markdown is unaffected.
          </p>
        </div>
      ) : null}
      <div className='ce:min-h-0 ce:flex-1 ce:overflow-auto'>
        <RenderDocument
          className='rich-editor__content'
          document={conversion.renderDocument}
          resolver={resolver}
        />
      </div>
    </div>
  );
}
