import { headText, type ViewerDefinition } from '@formless63/viewer-core';

export const pdfDefinition: ViewerDefinition = {
  key: 'pdf',
  label: 'PDF document',
  extensions: ['pdf'],
  contentTypes: ['application/pdf'],
  aspectRatio: '8.5 / 11',
  sniff: (head) => headText(head).includes('%PDF-'),
  load: () => import('./pdf-viewer.tsx'),
};
