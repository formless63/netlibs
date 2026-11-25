/**
 * Generate every self-authored fixture. Deterministic and dependency-light, so
 * none of these files carry a third-party licence. The two `label-*.lbx`
 * files are P-touch layouts and are not generated; see fixtures/README.md.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildLbx } from '../packages/viewer-lbx/node_modules/bil-lbx';
import { deflateSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';

const dir = join(import.meta.dir, '../fixtures');
mkdirSync(dir, { recursive: true });
const write = (name: string, data: string | Uint8Array) => Bun.write(join(dir, name), data);

// --- Tetrahedron, shared by every 3D format -------------------------------
const V = [
  [0, 0, 0],
  [20, 0, 0],
  [0, 20, 0],
  [0, 0, 20],
] as const;
const F = [
  [0, 2, 1],
  [0, 1, 3],
  [0, 3, 2],
  [1, 2, 3],
] as const;
const v = (i: number) => V[i]!;

await write(
  'tetra-ascii.stl',
  `solid tetra\n${F.map(
    (f) =>
      `facet normal 0 0 0\n outer loop\n${f.map((i) => `  vertex ${v(i).join(' ')}`).join('\n')}\n endloop\nendfacet`,
  ).join('\n')}\nendsolid tetra\n`,
);
{
  const buffer = new ArrayBuffer(84 + 50 * F.length);
  const view = new DataView(buffer);
  view.setUint32(80, F.length, true);
  F.forEach((f, t) => {
    f.forEach((i, c) =>
      v(i).forEach((n, a) => view.setFloat32(84 + t * 50 + 12 + c * 12 + a * 4, n, true)),
    );
  });
  await write('tetra-binary.stl', new Uint8Array(buffer));
}
await write(
  'tetra.obj',
  `${V.map((p) => `v ${p.join(' ')}`).join('\n')}\n${F.map((f) => `f ${f.map((i) => i + 1).join(' ')}`).join('\n')}\n`,
);
await write(
  'tetra.ply',
  `ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 4\nproperty list uchar int vertex_indices\nend_header\n${V.map((p) => p.join(' ')).join('\n')}\n${F.map((f) => `3 ${f.join(' ')}`).join('\n')}\n`,
);
await write(
  'tetra.off',
  `OFF\n4 4 0\n${V.map((p) => p.join(' ')).join('\n')}\n${F.map((f) => `3 ${f.join(' ')}`).join('\n')}\n`,
);
await write(
  'tetra.3mf',
  zipSync(
    {
      '[Content_Types].xml': strToU8(
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>',
      ),
      '_rels/.rels': strToU8(
        '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>',
      ),
      '3D/3dmodel.model': strToU8(
        `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${V.map((p) => `<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join('')}</vertices><triangles>${F.map((f) => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`,
      ),
    },
    { mtime: new Date('2026-01-01T00:00:00Z') },
  ),
);

// --- glTF: positions + indices, one orange material -----------------------
{
  const bin = new Uint8Array(48 + 24);
  const view = new DataView(bin.buffer);
  V.flat().forEach((n, i) => view.setFloat32(i * 4, n / 20, true));
  F.flat().forEach((n, i) => view.setUint16(48 + i * 2, n, true));
  const gltf = (uri?: string) => ({
    asset: { version: '2.0', generator: 'viewer fixtures' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [0.9, 0.35, 0.1, 1], metallicFactor: 0 },
        doubleSided: true,
      },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [0, 0, 0],
        max: [1, 1, 1],
      },
      { bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 48 },
      { buffer: 0, byteOffset: 48, byteLength: 24 },
    ],
    buffers: [{ byteLength: 72, ...(uri ? { uri } : {}) }],
  });
  await write(
    'tetra.gltf',
    JSON.stringify(
      gltf(`data:application/octet-stream;base64,${Buffer.from(bin).toString('base64')}`),
      null,
      2,
    ),
  );
  const json = strToU8(JSON.stringify(gltf()));
  const jsonLength = Math.ceil(json.length / 4) * 4;
  const glb = new Uint8Array(12 + 8 + jsonLength + 8 + bin.length);
  const out = new DataView(glb.buffer);
  out.setUint32(0, 0x46546c67, true);
  out.setUint32(4, 2, true);
  out.setUint32(8, glb.length, true);
  out.setUint32(12, jsonLength, true);
  out.setUint32(16, 0x4e4f534a, true);
  glb.fill(0x20, 20, 20 + jsonLength);
  glb.set(json, 20);
  out.setUint32(20 + jsonLength, bin.length, true);
  out.setUint32(24 + jsonLength, 0x004e4942, true);
  glb.set(bin, 28 + jsonLength);
  await write('tetra.glb', glb);
}

// --- PDF: three pages, non-embedded Helvetica ------------------------------
{
  const pages = 3;
  const objects: string[] = [];
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Count ${pages} /Kids [${Array.from({ length: pages }, (_, i) => `${4 + i * 2} 0 R`).join(' ')}] >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  for (let i = 0; i < pages; i++) {
    const stream = `0.1 0.3 0.8 rg 72 640 468 80 re f 1 1 1 rg BT /F1 36 Tf 96 665 Td (Fixture page ${i + 1}) Tj ET`;
    objects[4 + i * 2] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + i * 2} 0 R >>`;
    objects[5 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  }
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let n = 1; n < objects.length; n++) {
    offsets[n] = pdf.length;
    pdf += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  await write('three-pages.pdf', pdf);
}

// --- Gerber: a 40 x 30 mm board --------------------------------------------
const gerber = (body: string[], apertures: string[]) =>
  ['%FSLAX34Y34*%', '%MOMM*%', ...apertures, ...body, 'M02*', ''].join('\n');
const mm = (n: number) => String(Math.round(n * 10000));
const at = (x: number, y: number, d: string) => `X${mm(x)}Y${mm(y)}${d}*`;
const pads = [
  [8, 8],
  [32, 8],
  [8, 22],
  [32, 22],
] as const;
await write(
  'board-F_Cu.gtl',
  gerber(
    [
      'D11*',
      ...pads.map(([x, y]) => at(x, y, 'D03')),
      'D10*',
      at(8, 8, 'D02'),
      at(32, 8, 'D01'),
      at(32, 22, 'D01'),
    ],
    ['%ADD10C,0.6*%', '%ADD11C,2.4*%'],
  ),
);
await write(
  'board-B_Cu.gbl',
  gerber(
    [
      'D11*',
      ...pads.map(([x, y]) => at(x, y, 'D03')),
      'D10*',
      at(8, 8, 'D02'),
      at(8, 22, 'D01'),
      at(32, 22, 'D01'),
    ],
    ['%ADD10C,0.6*%', '%ADD11C,2.4*%'],
  ),
);
await write(
  'board-F_Mask.gts',
  gerber(['D10*', ...pads.map(([x, y]) => at(x, y, 'D03'))], ['%ADD10C,2.6*%']),
);
await write(
  'board-F_Silkscreen.gto',
  gerber(
    [
      'D10*',
      at(15, 12, 'D02'),
      at(25, 12, 'D01'),
      at(25, 18, 'D01'),
      at(15, 18, 'D01'),
      at(15, 12, 'D01'),
    ],
    ['%ADD10C,0.2*%'],
  ),
);
await write(
  'board-Edge_Cuts.gko',
  gerber(
    [
      'D10*',
      at(0, 0, 'D02'),
      at(40, 0, 'D01'),
      at(40, 30, 'D01'),
      at(0, 30, 'D01'),
      at(0, 0, 'D01'),
    ],
    ['%ADD10C,0.1*%'],
  ),
);
// Inches on purpose, so the overlay has to reconcile units.
await write(
  'board.drl',
  [
    'M48',
    'INCH,TZ',
    'T1C0.0394',
    '%',
    'T1',
    ...pads.map(([x, y]) => `X${(x / 25.4).toFixed(4)}Y${(y / 25.4).toFixed(4)}`),
    'M30',
    '',
  ].join('\n'),
);

// --- KiCad ------------------------------------------------------------------
await write(
  'board.kicad_pcb',
  `(kicad_pcb (version 20221018) (generator pcbnew)
  (general (thickness 1.6))
  (paper "A4")
  (title_block (title "Fixture board") (company "Example"))
  (layers
    (0 "F.Cu" signal) (31 "B.Cu" signal) (36 "B.SilkS" user "B.Silkscreen") (37 "F.SilkS" user "F.Silkscreen")
    (38 "B.Mask" user) (39 "F.Mask" user) (44 "Edge.Cuts" user) (46 "B.CrtYd" user) (47 "F.CrtYd" user) (48 "B.Fab" user) (49 "F.Fab" user))
  (setup (pad_to_mask_clearance 0))
  (net 0 "") (net 1 "GND") (net 2 "VCC")
  (footprint "Fixture:R" (layer "F.Cu") (tstamp 11111111-1111-4111-8111-111111111111) (at 115 110)
    (fp_text reference "R1" (at 0 -3) (layer "F.SilkS") (tstamp 11111111-1111-4111-8111-111111111112) (effects (font (size 1 1) (thickness 0.15))))
    (fp_text value "10k" (at 0 3) (layer "F.Fab") (tstamp 11111111-1111-4111-8111-111111111113) (effects (font (size 1 1) (thickness 0.15))))
    (pad "1" smd rect (at -2 0) (size 1.5 2) (layers "F.Cu" "F.Mask") (net 1 "GND") (tstamp 11111111-1111-4111-8111-111111111114))
    (pad "2" smd rect (at 2 0) (size 1.5 2) (layers "F.Cu" "F.Mask") (net 2 "VCC") (tstamp 11111111-1111-4111-8111-111111111115)))
  (gr_line (start 100 100) (end 140 100) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (tstamp 11111111-1111-4111-8111-111111111116))
  (gr_line (start 140 100) (end 140 130) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (tstamp 11111111-1111-4111-8111-111111111117))
  (gr_line (start 140 130) (end 100 130) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (tstamp 11111111-1111-4111-8111-111111111118))
  (gr_line (start 100 130) (end 100 100) (stroke (width 0.1) (type solid)) (layer "Edge.Cuts") (tstamp 11111111-1111-4111-8111-111111111119))
  (segment (start 113 110) (end 106 122) (width 0.5) (layer "F.Cu") (net 1) (tstamp 11111111-1111-4111-8111-111111111120))
  (segment (start 117 110) (end 132 122) (width 0.5) (layer "B.Cu") (net 2) (tstamp 11111111-1111-4111-8111-111111111121))
  (via (at 132 122) (size 1.2) (drill 0.6) (layers "F.Cu" "B.Cu") (net 2) (tstamp 11111111-1111-4111-8111-111111111122))
)
`,
);
await write(
  'board.kicad_sch',
  `(kicad_sch (version 20230121) (generator eeschema)
  (uuid 22222222-2222-4222-8222-222222222222)
  (paper "A4")
  (title_block (title "Fixture schematic") (company "Example"))
  (lib_symbols
    (symbol "Device:R" (pin_numbers hide) (pin_names (offset 0)) (in_bom yes) (on_board yes)
      (property "Reference" "R" (at 2.032 0 90) (effects (font (size 1.27 1.27))))
      (property "Value" "R" (at 0 0 90) (effects (font (size 1.27 1.27))))
      (symbol "R_0_1" (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default)) (fill (type none))))
      (symbol "R_1_1"
        (pin passive line (at 0 3.81 270) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27))))))))
  (wire (pts (xy 100 66.19) (xy 130 66.19)) (stroke (width 0) (type default)) (uuid 22222222-2222-4222-8222-222222222223))
  (text "Fixture schematic" (at 95 55 0) (effects (font (size 2 2)) (justify left bottom)) (uuid 22222222-2222-4222-8222-222222222224))
  (symbol (lib_id "Device:R") (at 100 70 0) (unit 1) (in_bom yes) (on_board yes) (dnp no) (uuid 22222222-2222-4222-8222-222222222225)
    (property "Reference" "R1" (at 103 69 0) (effects (font (size 1.27 1.27)) (justify left)))
    (property "Value" "10k" (at 103 71.5 0) (effects (font (size 1.27 1.27)) (justify left)))
    (pin "1" (uuid 22222222-2222-4222-8222-222222222226))
    (pin "2" (uuid 22222222-2222-4222-8222-222222222227))
    (instances (project "fixture" (path "/22222222-2222-4222-8222-222222222222" (reference "R1") (unit 1)))))
  (sheet_instances (path "/" (page "1")))
)
`,
);

// --- LBX --------------------------------------------------------------------
await write(
  'simple.lbx',
  await buildLbx({
    paper: { width: 33.6, height: 150, autoLength: false, format: 259 },
    objects: [
      {
        type: 'text',
        position: { x: 10, y: 5, width: 80, height: 24 },
        font: { name: 'Helsinki', size: 10, weight: 700 },
        horizontalAlignment: 'CENTER',
        verticalAlignment: 'CENTER',
        data: 'FIXTURE\nLABEL',
      },
      {
        type: 'rect',
        position: { x: 100, y: 5, width: 30, height: 20 },
        pen: { style: 'SOLID', widthX: 1 },
      },
      {
        type: 'barcode',
        position: { x: 134, y: 5, width: 12, height: 20 },
        protocol: 'QRCODE',
        data: 'fixture',
      },
    ],
  }),
);

// --- Images, text, HTML, Markdown --------------------------------------------
{
  const [w, h] = [64, 32];
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) raw.set([x * 4, y * 8, 160], y * (w * 3 + 1) + 1 + x * 3);
  }
  const chunk = (type: string, data: Buffer) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, 'latin1');
    data.copy(out, 8);
    out.writeUInt32BE(Bun.hash.crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header.set([8, 2, 0, 0, 0], 8);
  await write(
    'gradient.png',
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', header),
      chunk('IDAT', deflateSync(raw)),
      chunk('IEND', Buffer.alloc(0)),
    ]),
  );
}
await write(
  'hostile.svg',
  '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><script>window.top.__svgPwned = true</script><rect width="120" height="60" fill="teal"/></svg>\n',
);
await write(
  'hostile.html',
  '<!doctype html>\n<html><head><title>Hostile</title></head><body><h1>Captured page</h1><script>try { window.top.__htmlPwned = true } catch (e) {}</script><img src="https://tracker.invalid/pixel.png" alt=""></body></html>\n',
);
await write('sample.csv', 'sku,qty\nA-1,4\nB-2,9\n');
await write(
  'sample.md',
  [
    '# Fixture document',
    '',
    'A [safe link](https://example.com) and a [script link](javascript:alert(1)).',
    '',
    '<script>window.__mdPwned = true</script>',
    '',
    '| Part | Qty |',
    '| --- | --- |',
    '| R1 | 1 |',
    '',
    '- [x] done',
    '- [ ] todo',
    '',
    '```ts',
    "const greeting: string = 'hello';",
    '```',
    '',
    '```mermaid',
    'flowchart LR',
    '  A[Source] --> B[Viewer]',
    '```',
    '',
  ].join('\n'),
);
console.log('Fixtures written to', dir);
