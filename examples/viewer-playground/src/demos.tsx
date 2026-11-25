import type { ReactNode } from 'react';

import { GerberBoardViewer, KicadViewer } from '@formless63/viewer-ecad';
import { LbxViewer, type LbxColors } from '@formless63/viewer-lbx';
import { MarkdownViewer } from '@formless63/viewer-markdown';
import { MermaidDiagram } from '@formless63/viewer-markdown/mermaid';
import { HtmlViewer } from '@formless63/viewer-media';
import { PdfViewer } from '@formless63/viewer-pdf';
import {
  FileViewer,
  createDefaultRegistry,
  type ViewerAdapter,
  type ViewerInput,
  type ViewerProps,
} from '@formless63/viewers';

export const registry = createDefaultRegistry();

/** What a host app supplies: here, one header. */
export const authAdapter: ViewerAdapter = {
  fetch: (url, init) => fetch(url, { ...init, headers: { authorization: 'Bearer playground' } }),
};

interface RenderProps {
  source: ViewerInput;
  onStatusChange: NonNullable<ViewerProps['onStatusChange']>;
}

interface Demo {
  id: string;
  group: string;
  title: string;
  note: string;
  file?: string;
  render: (props: RenderProps) => ReactNode;
}

const frame = (id: string, group: string, title: string, file: string, note: string): Demo => ({
  id,
  group,
  title,
  file,
  note,
  render: ({ source, onStatusChange }) => (
    <FileViewer
      header
      lazyLoad={false}
      name={file}
      onStatusChange={onStatusChange}
      source={source}
    />
  ),
});

const box = { height: '32rem' };
const codeRenderers = { mermaid: MermaidDiagram };
const whiteOnBlack: LbxColors = { tape: '#000000', ink: '#ffffff' };
const boardFiles = [
  'board-F_Cu.gtl',
  'board-B_Cu.gbl',
  'board-F_Mask.gts',
  'board-F_Silkscreen.gto',
  'board-Edge_Cuts.gko',
  'board.drl',
].map((name) => ({ name, source: `/fixtures/${name}` }));
const kicadCompanions = [{ name: 'board.kicad_sch', source: '/fixtures/board.kicad_sch' }];

export const DEMOS: readonly Demo[] = [
  frame(
    'pdf',
    'Documents',
    'PDF (automatic)',
    'three-pages.pdf',
    'The browser’s own PDF viewer where there is one, pdf.js elsewhere.',
  ),
  {
    id: 'pdf-canvas',
    group: 'Documents',
    title: 'PDF (pdf.js)',
    file: 'three-pages.pdf',
    note: 'The pdf.js path forced on, as phones get it.',
    render: ({ source, onStatusChange }) => (
      <PdfViewer mode='canvas' onStatusChange={onStatusChange} source={source} style={box} />
    ),
  },
  {
    id: 'markdown',
    group: 'Documents',
    title: 'Markdown',
    file: 'sample.md',
    note: 'GitHub-flavoured Markdown with an opt-in Mermaid renderer.',
    render: ({ source, onStatusChange }) => (
      <MarkdownViewer
        codeRenderers={codeRenderers}
        onStatusChange={onStatusChange}
        source={source}
        style={box}
      />
    ),
  },
  {
    id: 'html',
    group: 'Documents',
    title: 'HTML (sandboxed)',
    file: 'hostile.html',
    note: 'The file tries to run script and load a tracker. Neither is allowed.',
    render: ({ source, onStatusChange }) => (
      <HtmlViewer onStatusChange={onStatusChange} source={source} style={box} />
    ),
  },
  {
    id: 'html-remote',
    group: 'Documents',
    title: 'HTML with remote content',
    file: 'hostile.html',
    note: 'The host opted in, so the tracker loads. Script is still refused.',
    render: ({ source, onStatusChange }) => (
      <HtmlViewer onStatusChange={onStatusChange} remoteContent source={source} style={box} />
    ),
  },
  frame('text', 'Documents', 'Text and CSV', 'sample.csv', 'Shown verbatim.'),
  frame('image', 'Images', 'PNG', 'gradient.png', 'Fit to frame, with pan and zoom.'),
  frame('svg', 'Images', 'SVG', 'hostile.svg', 'Rendered as an image, so its script never runs.'),
  frame(
    'stl-ascii',
    '3D models',
    'STL (ASCII)',
    'tetra-ascii.stl',
    'online-3d-viewer, coloured from the theme.',
  ),
  frame(
    'stl-binary',
    '3D models',
    'STL (binary)',
    'tetra-binary.stl',
    'online-3d-viewer, coloured from the theme.',
  ),
  frame('obj', '3D models', 'OBJ', 'tetra.obj', 'online-3d-viewer.'),
  frame('ply', '3D models', 'PLY', 'tetra.ply', 'online-3d-viewer.'),
  frame('off', '3D models', 'OFF', 'tetra.off', 'online-3d-viewer.'),
  frame('3mf', '3D models', '3MF', 'tetra.3mf', 'online-3d-viewer.'),
  frame(
    'glb',
    '3D models',
    'GLB',
    'tetra.glb',
    'Google model-viewer with the file’s own material.',
  ),
  frame(
    'gltf',
    '3D models',
    'glTF',
    'tetra.gltf',
    'Embedded buffers only, unless read from a direct URL.',
  ),
  frame(
    'kicad-pcb',
    'Electronics',
    'KiCad board',
    'board.kicad_pcb',
    'KiCanvas with its own pan, zoom and layer panels.',
  ),
  frame('kicad-sch', 'Electronics', 'KiCad schematic', 'board.kicad_sch', 'KiCanvas.'),
  {
    id: 'kicad-project',
    group: 'Electronics',
    title: 'KiCad board + schematic',
    file: 'board.kicad_pcb',
    note: 'One viewer, two sources.',
    render: ({ source, onStatusChange }) => (
      <KicadViewer
        companions={kicadCompanions}
        name='board.kicad_pcb'
        onStatusChange={onStatusChange}
        source={source}
        style={{ height: '44rem' }}
      />
    ),
  },
  frame('gerber', 'Electronics', 'Gerber layer', 'board-F_Cu.gtl', 'One layer as SVG.'),
  frame('drill', 'Electronics', 'Excellon drill', 'board.drl', 'One drill file as SVG.'),
  {
    id: 'gerber-board',
    group: 'Electronics',
    title: 'Gerber layer stack',
    note: 'Six files overlaid, one of them in inches.',
    render: ({ onStatusChange }) => (
      <GerberBoardViewer files={boardFiles} onStatusChange={onStatusChange} style={box} />
    ),
  },
  frame(
    'lbx',
    'Labels',
    'Brother label',
    'simple.lbx',
    'Synthetic label; the barcode is a placeholder.',
  ),
  {
    id: 'lbx-real',
    group: 'Labels',
    title: 'Brother label (knockouts)',
    file: 'label-x10b.lbx',
    note: 'A P-touch layout with knockout badges. Its fonts are not bundled, so substitutes show.',
    render: ({ source, onStatusChange }) => (
      <LbxViewer
        fallbackColors={whiteOnBlack}
        name='label-x10b.lbx'
        onStatusChange={onStatusChange}
        source={source}
        style={{ aspectRatio: '2.4', height: 'auto' }}
      />
    ),
  },
  {
    id: 'corrupt',
    group: 'States',
    title: 'Corrupt file',
    note: 'Bytes that are not what the name claims.',
    file: 'sample.csv',
    render: ({ source, onStatusChange }) => (
      <FileViewer
        contentType='application/x-kicad-pcb'
        lazyLoad={false}
        onStatusChange={onStatusChange}
        source={source}
      />
    ),
  },
  {
    id: 'missing',
    group: 'States',
    title: 'Missing file',
    note: 'A 404, with retry and links.',
    render: ({ onStatusChange }) => (
      <FileViewer lazyLoad={false} onStatusChange={onStatusChange} source='/fixtures/nope.stl' />
    ),
  },
  {
    id: 'unsupported',
    group: 'States',
    title: 'Unsupported format',
    note: 'No registered viewer.',
    render: ({ onStatusChange }) => (
      <FileViewer
        lazyLoad={false}
        name='drawing.dwg'
        onStatusChange={onStatusChange}
        source='/fixtures/sample.csv'
      />
    ),
  },
  {
    id: 'guarded',
    group: 'States',
    title: 'Large file guard',
    note: 'Over the limit, so it waits to be asked.',
    render: ({ onStatusChange }) => (
      <FileViewer
        lazyLoad={false}
        onStatusChange={onStatusChange}
        sizeBytes={80 * 1024 * 1024}
        source='/fixtures/tetra-binary.stl'
      />
    ),
  },
];
