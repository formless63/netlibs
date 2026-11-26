import { headText, type ViewerDefinition } from '@formless63/viewer-core';

export const kicadDefinition: ViewerDefinition = {
  key: 'kicad',
  label: 'KiCad board or schematic',
  // Only what KiCanvas renders standalone: no .kicad_mod, .kicad_pro or legacy .sch.
  extensions: ['kicad_pcb', 'kicad_sch'],
  contentTypes: ['application/x-kicad-pcb', 'application/x-kicad-schematic'],
  sniff: (head) => /^\s*\(kicad_(pcb|sch)\b/.test(headText(head)),
  load: () => import('./kicad-viewer.tsx'),
};

export const gerberDefinition: ViewerDefinition = {
  key: 'gerber',
  label: 'Gerber or drill layer',
  extensions: [
    'gbr',
    'ger',
    'gtl',
    'gts',
    'gto',
    'gtp',
    'gbl',
    'gbs',
    'gbo',
    'gbp',
    'gko',
    'gm1',
    'drl',
    'xnc',
  ],
  contentTypes: ['application/vnd.gerber'],
  sniff: (head) => /^\s*(%FS[LT][AI]|G04[ #]|%TF\.|M48\s)/.test(headText(head)),
  load: () => import('./gerber-viewer.tsx'),
};
