import { headText, type ViewerDefinition } from '@formless63/viewer-core';

export const meshDefinition: ViewerDefinition = {
  key: 'mesh',
  label: '3D mesh',
  extensions: ['stl', 'obj', 'ply', 'off', '3mf'],
  contentTypes: [
    'model/stl',
    'model/x.stl-ascii',
    'model/x.stl-binary',
    'application/sla',
    'application/vnd.ms-pki.stl',
    'model/obj',
    'model/3mf',
    'application/vnd.ms-package.3dmanufacturing-3dmodel+xml',
  ],
  // Only the self-identifying formats: binary STL, OBJ and 3MF (a ZIP) have no
  // reliable magic, so unnamed inputs of those kinds need a name or type.
  sniff: (head) => /^(solid\s[\s\S]*facet\s|ply\r?\n|OFF\s)/.test(headText(head)),
  load: () => import('./mesh-viewer.tsx'),
};

export const gltfDefinition: ViewerDefinition = {
  key: 'gltf',
  label: 'glTF model',
  extensions: ['glb', 'gltf'],
  contentTypes: ['model/gltf-binary', 'model/gltf+json'],
  sniff: (head) => headText(head, 4) === 'glTF',
  load: () => import('./gltf-viewer.tsx'),
};
