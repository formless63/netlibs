import {
  createViewerRegistry,
  type ViewerDefinition,
  type ViewerRegistry,
} from '@formless63/viewer-core';
import { gerberDefinition, kicadDefinition } from '@formless63/viewer-ecad/definitions';
import { lbxDefinition } from '@formless63/viewer-lbx/definitions';
import { markdownDefinition } from '@formless63/viewer-markdown/definitions';
import {
  htmlDefinition,
  imageDefinition,
  textDefinition,
} from '@formless63/viewer-media/definitions';
import { gltfDefinition, meshDefinition } from '@formless63/viewer-model/definitions';
import { pdfDefinition } from '@formless63/viewer-pdf/definitions';

export const defaultViewerDefinitions: readonly ViewerDefinition[] = [
  pdfDefinition,
  meshDefinition,
  gltfDefinition,
  kicadDefinition,
  gerberDefinition,
  lbxDefinition,
  imageDefinition,
  markdownDefinition,
  htmlDefinition,
  textDefinition,
];

/** Every viewer, plus overrides (a later definition wins per key and format). */
export function createDefaultRegistry(extra: readonly ViewerDefinition[] = []): ViewerRegistry {
  return createViewerRegistry([...defaultViewerDefinitions, ...extra]);
}
