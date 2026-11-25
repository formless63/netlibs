import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'bun:test';

import { RICH_STL_MAX_BYTES, RICH_STL_MAX_TRIANGLES, parseRichStl } from '../src/viewers/stl-parser.ts';

describe('parseRichStl', () => {
  it('parses real ASCII STL fixture bytes and reports model bounds', () => {
    const bytes = readFileSync(new URL('./__fixtures__/tetrahedron.stl', import.meta.url));
    const originalBytes = Uint8Array.from(bytes);
    const mesh = parseRichStl(bytes);

    expect(mesh.triangleCount).toBe(4);
    expect(mesh.positions).toHaveLength(36);
    expect(mesh.bounds).toEqual({
      minX: -1,
      minY: -1,
      minZ: -1,
      maxX: 1,
      maxY: 1,
      maxZ: 1
    });
    expect(new Uint8Array(bytes)).toEqual(originalBytes);
  });

  it('parses binary STL facets without trusting the header normal', () => {
    const bytes = new Uint8Array(84 + 50);
    const view = new DataView(bytes.buffer);
    view.setUint32(80, 1, true);
    const vertices = [0, 0, 0, 2, 0, 0, 0, 3, 0];
    vertices.forEach((value, index) => view.setFloat32(96 + index * 4, value, true));

    const mesh = parseRichStl(bytes);
    expect(mesh.triangleCount).toBe(1);
    expect([...mesh.positions]).toEqual(vertices);
    expect(mesh.bounds).toMatchObject({ minX: 0, minY: 0, maxX: 2, maxY: 3 });
  });

  it('rejects malformed text instead of producing an empty viewer', () => {
    expect(() => parseRichStl(new TextEncoder().encode('solid empty\nendsolid empty'))).toThrow(
      'complete triangular facets'
    );
  });

  it('rejects finite JavaScript numbers that overflow Float32 storage', () => {
    const malicious = new TextEncoder().encode(`solid overflow
facet normal 0 0 1
outer loop
vertex 1e100 0 0
vertex 0 1 0
vertex 0 0 1
endloop
endfacet
endsolid overflow`);

    expect(() => parseRichStl(malicious)).toThrow('outside the supported range');
  });

  it('rejects facets whose finite bounds have no usable dimensions', () => {
    const degenerate = new TextEncoder().encode(`solid point
facet normal 0 0 1
outer loop
vertex 1 1 1
vertex 1 1 1
vertex 1 1 1
endloop
endfacet
endsolid point`);

    expect(() => parseRichStl(degenerate)).toThrow('usable model dimensions');
  });

  it('keeps extreme supported Float32 bounds finite and usable', () => {
    const extremeBounds = new TextEncoder().encode(`solid diameter
facet normal 0 0 1
outer loop
vertex -3e38 0 0
vertex 3e38 0 0
vertex 0 1 0
endloop
endfacet
endsolid diameter`);

    const mesh = parseRichStl(extremeBounds);
    expect(Object.values(mesh.bounds).every(Number.isFinite)).toBe(true);
    expect(mesh.bounds.maxX - mesh.bounds.minX).toBeGreaterThan(0);
  });

  it('rejects byte and triangle counts before parsing their payloads', () => {
    expect(() => parseRichStl(new Uint8Array(RICH_STL_MAX_BYTES + 1))).toThrow(
      'limited to 20 MB'
    );

    const triangleCount = RICH_STL_MAX_TRIANGLES + 1;
    const oversizedMesh = new Uint8Array(84 + triangleCount * 50);
    new DataView(oversizedMesh.buffer).setUint32(80, triangleCount, true);
    expect(() => parseRichStl(oversizedMesh)).toThrow(
      `more than ${RICH_STL_MAX_TRIANGLES.toLocaleString()} triangles`
    );
  });
});
