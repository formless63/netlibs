import type { ViewerDefinition } from '@formless63/viewer-core';

export const lbxDefinition: ViewerDefinition = {
  key: 'lbx',
  label: 'Brother label',
  extensions: ['lbx'],
  // Extension-only on purpose: .lbx is a ZIP, and `application/zip` must not
  // resolve here. docx, xlsx and plain archives sniff identically.
  contentTypes: [],
  load: () => import('./lbx-viewer.tsx'),
};
