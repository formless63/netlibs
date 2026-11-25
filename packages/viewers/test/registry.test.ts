import { describe, expect, it } from 'vitest';

import { createDefaultRegistry, defaultViewerDefinitions } from '../src/registry.ts';

const registry = createDefaultRegistry();

describe('default registry', () => {
  it.each([
    ['invoice.pdf', 'pdf'],
    ['part.stl', 'mesh'],
    ['part.3mf', 'mesh'],
    ['part.glb', 'gltf'],
    ['part.gltf', 'gltf'],
    ['main.kicad_pcb', 'kicad'],
    ['main.kicad_sch', 'kicad'],
    ['main-F_Cu.gtl', 'gerber'],
    ['holes.drl', 'gerber'],
    ['cable.lbx', 'lbx'],
    ['photo.JPG', 'image'],
    ['README.md', 'markdown'],
    ['page.html', 'html'],
    ['data.csv', 'text'],
  ])('%s -> %s', (name, key) => expect(registry.resolve({ name })?.key).toBe(key));

  it('claims nothing it cannot render', () => {
    for (const name of [
      'a.zip',
      'a.docx',
      'a.xlsx',
      'a.step',
      'a.kicad_mod',
      'a.kicad_pro',
      'a.sch',
      'a.dwg',
      'a.mp4',
    ]) {
      expect(registry.resolve({ name }), name).toBeNull();
    }
    expect(registry.resolve({ contentType: 'application/zip' })).toBeNull();
  });

  it('has no duplicate extensions or types across viewers', () => {
    for (const field of ['extensions', 'contentTypes'] as const) {
      const all = defaultViewerDefinitions.flatMap((d) => d[field]);
      expect(new Set(all).size).toBe(all.length);
    }
  });

  it('every definition’s loader resolves to a component', async () => {
    for (const definition of defaultViewerDefinitions) {
      expect(typeof (await definition.load()).default, definition.key).toBe('function');
    }
  });
});
