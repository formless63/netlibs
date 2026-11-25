export const RICH_STL_MAX_BYTES = 20 * 1024 * 1024;
export const RICH_STL_MAX_TRIANGLES = 200_000;

const ASCII_STL_MAX_BYTES = 8 * 1024 * 1024;
const BINARY_STL_HEADER_BYTES = 84;
const BINARY_STL_TRIANGLE_BYTES = 50;

export interface RichStlBounds {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface RichStlMesh {
  positions: Float32Array;
  triangleCount: number;
  bounds: RichStlBounds;
}

function stlError(message: string): Error {
  return new Error(message);
}

function emptyBounds(): RichStlBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    minZ: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
    maxZ: Number.NEGATIVE_INFINITY
  };
}

function includeVertex(
  bounds: RichStlBounds,
  coordinateX: number,
  coordinateY: number,
  coordinateZ: number
): void {
  bounds.minX = Math.min(bounds.minX, coordinateX);
  bounds.minY = Math.min(bounds.minY, coordinateY);
  bounds.minZ = Math.min(bounds.minZ, coordinateZ);
  bounds.maxX = Math.max(bounds.maxX, coordinateX);
  bounds.maxY = Math.max(bounds.maxY, coordinateY);
  bounds.maxZ = Math.max(bounds.maxZ, coordinateZ);
}

function ensureCoordinate(value: number): number {
  const float32Value = Math.fround(value);
  if (!Number.isFinite(float32Value)) {
    throw stlError('The STL contains coordinates outside the supported range.');
  }
  return float32Value;
}

function validateBounds(bounds: RichStlBounds): void {
  if (!Object.values(bounds).every(Number.isFinite)) {
    throw stlError('The STL does not have finite model bounds.');
  }
  const diameter = Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY,
    bounds.maxZ - bounds.minZ
  );
  if (!Number.isFinite(diameter) || diameter <= 0) {
    throw stlError('The STL does not have usable model dimensions.');
  }
}

function binaryTriangleCount(bytes: Uint8Array): number | null {
  if (bytes.byteLength < BINARY_STL_HEADER_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const triangleCount = view.getUint32(80, true);
  const expectedBytes = BINARY_STL_HEADER_BYTES + triangleCount * BINARY_STL_TRIANGLE_BYTES;
  return expectedBytes === bytes.byteLength ? triangleCount : null;
}

function parseBinaryStl(bytes: Uint8Array, triangleCount: number): RichStlMesh {
  if (triangleCount < 1) throw stlError('The STL has no triangles to preview.');
  if (triangleCount > RICH_STL_MAX_TRIANGLES) {
    throw stlError(
      `The STL has more than ${RICH_STL_MAX_TRIANGLES.toLocaleString()} triangles.`
    );
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const positions = new Float32Array(triangleCount * 9);
  const bounds = emptyBounds();
  let outputOffset = 0;

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const triangleOffset = BINARY_STL_HEADER_BYTES + triangleIndex * BINARY_STL_TRIANGLE_BYTES;
    for (let vertexIndex = 0; vertexIndex < 3; vertexIndex += 1) {
      const vertexOffset = triangleOffset + 12 + vertexIndex * 12;
      const coordinateX = ensureCoordinate(view.getFloat32(vertexOffset, true));
      const coordinateY = ensureCoordinate(view.getFloat32(vertexOffset + 4, true));
      const coordinateZ = ensureCoordinate(view.getFloat32(vertexOffset + 8, true));
      positions[outputOffset] = coordinateX;
      positions[outputOffset + 1] = coordinateY;
      positions[outputOffset + 2] = coordinateZ;
      outputOffset += 3;
      includeVertex(bounds, coordinateX, coordinateY, coordinateZ);
    }
  }

  validateBounds(bounds);
  return { positions, triangleCount, bounds };
}

const STL_NUMBER = String.raw`[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?`;
const ASCII_VERTEX_PATTERN = new RegExp(
  String.raw`^\s*vertex\s+(${STL_NUMBER})\s+(${STL_NUMBER})\s+(${STL_NUMBER})\s*$`,
  'gim'
);

function parseAsciiStl(bytes: Uint8Array): RichStlMesh {
  if (bytes.byteLength > ASCII_STL_MAX_BYTES) {
    throw stlError('ASCII STL previews are limited to 8 MB.');
  }

  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const positions: number[] = [];
  const bounds = emptyBounds();
  let match: RegExpExecArray | null;

  ASCII_VERTEX_PATTERN.lastIndex = 0;
  while ((match = ASCII_VERTEX_PATTERN.exec(source)) !== null) {
    const coordinateX = ensureCoordinate(Number(match[1]));
    const coordinateY = ensureCoordinate(Number(match[2]));
    const coordinateZ = ensureCoordinate(Number(match[3]));
    positions.push(coordinateX, coordinateY, coordinateZ);
    includeVertex(bounds, coordinateX, coordinateY, coordinateZ);
    if (positions.length / 9 > RICH_STL_MAX_TRIANGLES) {
      throw stlError(
        `The STL has more than ${RICH_STL_MAX_TRIANGLES.toLocaleString()} triangles.`
      );
    }
  }

  if (positions.length === 0 || positions.length % 9 !== 0) {
    throw stlError('The STL does not contain complete triangular facets.');
  }

  validateBounds(bounds);
  return {
    positions: Float32Array.from(positions),
    triangleCount: positions.length / 9,
    bounds
  };
}

export function parseRichStl(input: ArrayBuffer | Uint8Array): RichStlMesh {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.byteLength === 0) throw stlError('The STL file is empty.');
  if (bytes.byteLength > RICH_STL_MAX_BYTES) {
    throw stlError('STL previews are limited to 20 MB.');
  }

  const triangleCount = binaryTriangleCount(bytes);
  if (triangleCount !== null) return parseBinaryStl(bytes, triangleCount);

  try {
    return parseAsciiStl(bytes);
  } catch (error) {
    if (error instanceof TypeError) throw stlError('The STL text is not valid UTF-8.');
    throw error;
  }
}
