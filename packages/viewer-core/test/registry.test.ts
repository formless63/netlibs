import { describe, expect, it } from 'vitest';

import { ViewerRegistry, type ViewerDefinition } from '../src/index.ts';

const def = (key: string, extensions: string[], contentTypes: string[] = []): ViewerDefinition => ({
  key,
  label: key,
  extensions,
  contentTypes,
  load: async () => ({ default: () => null }),
});

describe('ViewerRegistry', () => {
  const registry = new ViewerRegistry([
    def('pdf', ['pdf'], ['application/pdf']),
    def('gltf', ['gltf'], ['model/gltf+json']),
    def('text', ['txt', 'json'], ['text/plain', 'application/json']),
    def('kicad', ['kicad_pcb']),
  ]);
  const key = (name?: string, contentType?: string) =>
    registry.resolve({ name, contentType })?.key ?? null;

  it('resolves extensions case-insensitively, including underscores', () => {
    expect(key('A.PDF')).toBe('pdf');
    expect(key(' board.kicad_pcb ')).toBe('kicad');
    expect(key('archive.tar.gz')).toBeNull();
    expect(key('no-extension')).toBeNull();
    expect(key(undefined)).toBeNull();
  });

  it('prefers a specific MIME type over the extension', () => {
    expect(key('weird.txt', 'application/pdf; charset=binary')).toBe('pdf');
  });

  it('prefers the extension over a generic MIME type', () => {
    expect(key('model.gltf', 'application/json')).toBe('gltf');
    expect(key('doc.pdf', 'application/octet-stream')).toBe('pdf');
    expect(key('board.kicad_pcb', 'text/plain')).toBe('kicad');
  });

  it('falls back to the generic type when the extension says nothing', () => {
    expect(key('notes', 'text/plain')).toBe('text');
  });

  it('lets later definitions override, and memoises components', () => {
    const custom = new ViewerRegistry([def('pdf', ['pdf']), def('mine', ['pdf'])]);
    expect(custom.resolve({ name: 'a.pdf' })?.key).toBe('mine');
    expect(registry.component('pdf')).toBe(registry.component('pdf'));
    expect(registry.component('nope')).toBeNull();
    const before = registry.component('pdf');
    registry.resetComponent('pdf');
    expect(registry.component('pdf')).not.toBe(before);
  });
});
