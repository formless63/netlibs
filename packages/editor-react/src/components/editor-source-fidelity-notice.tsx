import { cn } from '../ui/cn.ts';

import {
  describeRichMarkdownFidelityLosses,
  joinRichFidelityLossParts,
  richMarkdownFidelityRequiresConfirm,
  type RichMarkdownFidelityFlags
} from '@formless63/editor-core';

export interface EditorSourceFidelityNoticeProps {
  flags: RichMarkdownFidelityFlags;
  className?: string;
}

/**
 * The source-mode notice. Image width survives Markdown; comment marks and column widths do not, so
 * the editor asks before discarding them.
 */
export function EditorSourceFidelityNotice({
  flags,
  className
}: EditorSourceFidelityNoticeProps) {
  const requiresConfirm = richMarkdownFidelityRequiresConfirm(flags);

  return (
    <div
      className={cn(
        'ce:shrink-0 ce:border-b ce:px-4 ce:py-2 ce:text-xs ce:leading-relaxed',
        requiresConfirm
          ? 'ce:bg-destructive/10 ce:text-destructive-ink'
          : 'ce:bg-muted/40 ce:text-muted-foreground',
        className
      )}
      data-rich-source-fidelity-notice=''
      role={requiresConfirm ? 'alert' : 'note'}
    >
      {requiresConfirm ? (
        <p className='ce:font-medium'>
          This document has{' '}
          {joinRichFidelityLossParts(describeRichMarkdownFidelityLosses(flags))}. Markdown has
          no way to represent these — saving or switching back to rich text from here will
          permanently remove them. Switch back without saving (or discard this session) to keep
          them.
        </p>
      ) : (
        <p>
          Markdown source mode is a view over the same document. Comment threads, table column
          widths, and image alignment have no Markdown form and would be dropped if this document
          used them — it doesn&apos;t, so nothing here is at risk right now.
          {flags.resizedImageCount > 0
            ? ` This document has ${flags.resizedImageCount} resized image${
                flags.resizedImageCount === 1 ? '' : 's'
              } — the display width is invisible here but stays intact (it round-trips through the image's Markdown title).`
            : null}
        </p>
      )}
    </div>
  );
}
