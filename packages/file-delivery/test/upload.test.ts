
import { fileTypeFromBuffer } from 'file-type';
import { describe, expect, it } from 'vitest';

import { uploadType } from '../src/index.ts';

const conflicts = (detected: string, declared: string) =>
  !uploadType({ detected, declared, filename: 'x' }).ok;
const storedType = (
  detected: string | null | undefined,
  declared: string | null | undefined,
  filename: string,
) => {
  const type = uploadType({ detected, declared: null, filename, opaqueZipExtensions: ['lbx'] });
  const fallback = uploadType({ detected: null, declared, filename, opaqueZipExtensions: ['lbx'] });
  const used = detected ? type : fallback;
  return used.ok ? used.contentType : null;
};

function glbFixture(): Buffer {
  const header = Buffer.alloc(12);
  header.write('glTF', 0, 'ascii');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(112, 8);
  return Buffer.concat([header, Buffer.alloc(100)]);
}

function asciiStlFixture(): Buffer {
  return Buffer.from(
    'solid cube\nfacet normal 0 0 1\n outer loop\n  vertex 0 0 0\n  vertex 1 0 0\n  vertex 0 1 0\n endloop\nendfacet\nendsolid cube\n'
  );
}

function binaryStlFixture(): Buffer {
  const header = Buffer.alloc(80);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(2, 0);
  return Buffer.concat([header, count, Buffer.alloc(2 * 50)]);
}

function gltfJsonFixture(): Buffer {
  return Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scenes: [], nodes: [] }));
}

function kicadPcbFixture(): Buffer {
  return Buffer.from(
    '(kicad_pcb (version 20240108) (generator "pcbnew")\n  (general (thickness 1.6))\n)\n'
  );
}

function gerberFixture(): Buffer {
  return Buffer.from('%FSLAX46Y46*%\n%MOMM*%\nG04 Top copper layer*\nG75*\nM02*\n');
}

function zipMagicFixture(byte3: number, byte4: number): Buffer {
  return Buffer.concat([Buffer.from([0x50, 0x4b, byte3, byte4]), Buffer.alloc(60)]);
}

function pngFixture(): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrLength = Buffer.alloc(4);
  ihdrLength.writeUInt32BE(13, 0);
  const ihdrData = Buffer.alloc(13); // 1x1 placeholder dimensions + bit depth etc.
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  return Buffer.concat([
    signature,
    ihdrLength,
    Buffer.from('IHDR', 'ascii'),
    ihdrData,
    Buffer.alloc(4) // CRC placeholder — file-type does not verify it
  ]);
}

function exeFixture(): Buffer {
  return Buffer.concat([Buffer.from('MZ', 'ascii'), Buffer.alloc(128)]);
}

describe('file-type sniffing of the previewable upload formats (real magic bytes)', () => {
  it('sniffs binary glTF (.glb) as model/gltf-binary', async () => {
    await expect(fileTypeFromBuffer(glbFixture())).resolves.toMatchObject({
      ext: 'glb',
      mime: 'model/gltf-binary'
    });
  });

  it('sniffs ASCII STL as model/stl', async () => {
    await expect(fileTypeFromBuffer(asciiStlFixture())).resolves.toMatchObject({
      mime: 'model/stl'
    });
  });

  it('leaves the signature-less formats undetected, so they fall back to the declared type', async () => {
    await expect(fileTypeFromBuffer(binaryStlFixture())).resolves.toBeUndefined();
    await expect(fileTypeFromBuffer(gltfJsonFixture())).resolves.toBeUndefined();
    await expect(fileTypeFromBuffer(kicadPcbFixture())).resolves.toBeUndefined();
    await expect(fileTypeFromBuffer(gerberFixture())).resolves.toBeUndefined();
  });

  it('sniffs a PK\\x03\\x04-headed buffer (a real .lbx local file header) as application/zip', async () => {
    await expect(fileTypeFromBuffer(zipMagicFixture(0x03, 0x04))).resolves.toMatchObject({
      ext: 'zip',
      mime: 'application/zip'
    });
  });

  it('also sniffs the empty (PK\\x05\\x06) and spanned (PK\\x07\\x08) zip magic variants as application/zip', async () => {
    await expect(fileTypeFromBuffer(zipMagicFixture(0x05, 0x06))).resolves.toMatchObject({
      mime: 'application/zip'
    });
    await expect(fileTypeFromBuffer(zipMagicFixture(0x07, 0x08))).resolves.toMatchObject({
      mime: 'application/zip'
    });
  });
});

describe('conflicts', () => {
  it('accepts a .glb sniff against every declared type browsers actually send', async () => {
    const sniffed = await fileTypeFromBuffer(glbFixture());
    expect(sniffed?.mime).toBe('model/gltf-binary');
    for (const declared of [
      'model/gltf-binary',
      'model/gltf+json',
      'application/octet-stream',
      'MODEL/GLTF-BINARY; charset=binary'
    ]) {
      expect(conflicts(sniffed!.mime, declared)).toBe(false);
    }
  });

  it('accepts an ASCII-STL sniff against the wild .stl mime spellings', async () => {
    const sniffed = await fileTypeFromBuffer(asciiStlFixture());
    expect(sniffed?.mime).toBe('model/stl');
    for (const declared of [
      'model/stl',
      'application/sla',
      'application/vnd.ms-pki.stl',
      'model/x.stl-ascii',
      'model/x.stl-binary',
      'application/octet-stream'
    ]) {
      expect(conflicts(sniffed!.mime, declared)).toBe(false);
    }
  });

  it('still rejects a genuine disguise (executable bytes declared as an image)', async () => {
    const sniffed = await fileTypeFromBuffer(exeFixture());
    expect(sniffed?.mime).toBeTruthy();
    expect(conflicts(sniffed!.mime, 'image/jpeg')).toBe(true);
  });

  it('accepts a PK-headed .lbx upload against the declared types browsers/OSes actually send', async () => {
    const sniffed = await fileTypeFromBuffer(zipMagicFixture(0x03, 0x04));
    expect(sniffed?.mime).toBe('application/zip');
    for (const declared of [
      'application/zip',
      'application/octet-stream',
      'application/x-zip-compressed',
      'application/x-zip',
      'multipart/x-zip'
    ]) {
      expect(conflicts(sniffed!.mime, declared)).toBe(false);
    }
  });

  it('still rejects a genuine disguise even when the filename claims .lbx (a real .lbx must still sniff as zip)', async () => {
    const sniffed = await fileTypeFromBuffer(exeFixture());
    expect(sniffed?.mime).toBeTruthy();
    expect(sniffed?.mime).not.toBe('application/zip');
    expect(conflicts(sniffed!.mime, 'application/zip')).toBe(true);
    expect(conflicts(sniffed!.mime, 'application/octet-stream')).toBe(true);
  });

  it('does not extend the octet-stream allowance to formats without an alias row', async () => {
    const sniffed = await fileTypeFromBuffer(pngFixture());
    expect(sniffed?.mime).toBe('image/png');
    expect(conflicts(sniffed!.mime, 'application/octet-stream')).toBe(true);
    expect(conflicts(sniffed!.mime, 'image/png')).toBe(false);
  });

  it('never treats a declared type as an alias of a DIFFERENT sniffed format', () => {
    expect(conflicts('model/gltf-binary', 'model/stl')).toBe(true);
    expect(conflicts('model/stl', 'model/gltf-binary')).toBe(true);
  });
});

describe('storedType', () => {
  it('narrows every generic zip spelling to octet-stream for a .lbx, case-insensitively', async () => {
    const sniffed = await fileTypeFromBuffer(zipMagicFixture(0x03, 0x04));
    expect(sniffed?.mime).toBe('application/zip');

    for (const name of [
      'Front label.lbx',
      'LABEL.LBX',
      'two-line cable label.Lbx'
    ]) {
      expect(storedType(sniffed!.mime, 'application/octet-stream', name)).toBe(
        'application/octet-stream'
      );
    }
    for (const spelling of [
      'application/zip',
      'application/x-zip-compressed',
      'application/x-zip',
      'multipart/x-zip',
      'Application/ZIP; charset=binary'
    ]) {
      expect(storedType(spelling, null, 'label.lbx')).toBe(
        'application/octet-stream'
      );
    }
  });

  it('leaves a genuine .zip archive as application/zip — it SHOULD download as .zip', async () => {
    const sniffed = await fileTypeFromBuffer(zipMagicFixture(0x03, 0x04));
    expect(storedType(sniffed!.mime, null, 'firmware-bundle.zip')).toBe(
      'application/zip'
    );
    expect(storedType(sniffed!.mime, null, 'spec.docx')).toBe(
      'application/zip'
    );
  });

  it('is otherwise the old sniff → declared → octet-stream precedence, unchanged', async () => {
    const png = await fileTypeFromBuffer(pngFixture());
    expect(storedType(png!.mime, 'application/octet-stream', 'shot.png')).toBe(
      'image/png'
    );
    expect(storedType(undefined, 'text/csv', 'export.csv')).toBe('text/csv');
    expect(storedType(undefined, null, 'mystery')).toBe(
      'application/octet-stream'
    );
    expect(storedType('image/png', null, 'sneaky.lbx')).toBe('image/png');
  });
});
