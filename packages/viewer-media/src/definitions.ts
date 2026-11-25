import type { ViewerDefinition } from '@formless63/viewer-core';
import { headText } from '@formless63/viewer-core';

export const imageDefinition: ViewerDefinition = {
  key: 'image',
  label: 'Image',
  extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg'],
  contentTypes: [
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
    'image/bmp',
    'image/svg+xml',
  ],
  sniff: (head) => {
    const text = headText(head, 16);
    return (
      text.startsWith('\u0089PNG') ||
      text.startsWith('ÿØÿ') ||
      text.startsWith('GIF8') ||
      (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP')
    );
  },
  load: () => import('./image-viewer.tsx'),
};

export const textDefinition: ViewerDefinition = {
  key: 'text',
  label: 'Text',
  extensions: ['txt', 'log', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'csv', 'tsv'],
  contentTypes: ['text/plain', 'application/json', 'application/xml', 'text/xml', 'text/csv'],
  load: () => import('./text-viewer.tsx'),
};

export const htmlDefinition: ViewerDefinition = {
  key: 'html',
  label: 'HTML document',
  extensions: ['html', 'htm'],
  contentTypes: ['text/html'],
  aspectRatio: '8.5 / 11',
  load: () => import('./html-viewer.tsx'),
};
