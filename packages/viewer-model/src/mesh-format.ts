import {
  bareContentType,
  fileExtension,
  headText,
  type ViewerFileInfo,
} from '@formless63/viewer-core';

export const MESH_EXTENSIONS = ['stl', 'obj', 'ply', 'off', '3mf'] as const;
export type MeshExtension = (typeof MESH_EXTENSIONS)[number];

/**
 * online-3d-viewer picks its importer from a filename extension, but routes and
 * blobs often have none. Resolve one from name, then type, then bytes.
 */
export function resolveMeshExtension(file: ViewerFileInfo, head: Uint8Array): MeshExtension {
  const ext = fileExtension(file.name);
  if (ext && (MESH_EXTENSIONS as readonly string[]).includes(ext)) return ext as MeshExtension;
  const type = bareContentType(file.contentType) ?? '';
  if (type === 'model/obj') return 'obj';
  if (type.includes('3mf') || type.includes('3dmanufacturing')) return '3mf';
  const text = headText(head);
  if (/^ply\r?\n/.test(text)) return 'ply';
  if (/^OFF\s/.test(text)) return 'off';
  if (text.startsWith('PK\u0003\u0004')) return '3mf';
  return 'stl';
}
