import { IconDownload, IconExternalLink } from '@tabler/icons-react';

export interface RichPdfOpenAffordanceProps {
  src: string;
  title?: string;
  message?: string;
}

export function RichPdfOpenAffordance({ src, title, message }: RichPdfOpenAffordanceProps) {
  return (
    <div className='ce:flex ce:h-full ce:w-full ce:flex-col ce:items-center ce:justify-center ce:gap-3 ce:p-4 ce:text-center'>
      <p className='ce:max-w-xs ce:text-xs ce:text-muted-foreground'>
        {message ?? "This PDF couldn't be previewed here."}
      </p>
      <div className='ce:flex ce:flex-wrap ce:items-center ce:justify-center ce:gap-2'>
        <a
          aria-label={title ? `Open PDF: ${title}` : 'Open PDF'}
          className='ce:inline-flex ce:min-h-9 ce:items-center ce:gap-1.5 ce:rounded-md ce:bg-primary ce:px-3 ce:py-2 ce:text-sm ce:font-medium ce:text-primary-foreground ce:hover:bg-primary/90'
          href={src}
          rel='noopener noreferrer'
          target='_blank'
        >
          <IconExternalLink aria-hidden className='ce:size-4' />
          Open PDF
        </a>
        <a
          aria-label={title ? `Download PDF: ${title}` : 'Download PDF'}
          className='ce:inline-flex ce:min-h-9 ce:items-center ce:gap-1.5 ce:rounded-md ce:border ce:px-3 ce:py-2 ce:text-sm ce:text-muted-foreground ce:hover:text-foreground'
          download={title || true}
          href={src}
          rel='noopener'
        >
          <IconDownload aria-hidden className='ce:size-4' />
          Download
        </a>
      </div>
    </div>
  );
}
