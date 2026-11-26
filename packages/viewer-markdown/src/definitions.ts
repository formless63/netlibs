import type { ViewerDefinition } from '@formless63/viewer-core';

export const markdownDefinition: ViewerDefinition = {
  key: 'markdown',
  label: 'Markdown document',
  extensions: ['md', 'markdown'],
  contentTypes: ['text/markdown', 'text/x-markdown'],
  aspectRatio: '8.5 / 11',
  load: () => import('./markdown-viewer.tsx'),
};
