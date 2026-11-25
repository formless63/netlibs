// @vitest-environment jsdom
import { act } from 'react';
import { describe, expect, it } from 'vitest';

import { fixture, mount, registerCleanup, waitFor } from '../../../scripts/test-utils.tsx';
import { GerberBoardViewer, gerberDefinition, GerberViewer } from '../src/index.ts';
import { renderGerberLayer, toMillimetres, unionViewBox } from '../src/gerber.ts';

registerCleanup();
const text = (name: string) => new TextDecoder().decode(fixture(name));
const FILES = [
  'board-F_Cu.gtl',
  'board-B_Cu.gbl',
  'board-F_Mask.gts',
  'board-F_Silkscreen.gto',
  'board-Edge_Cuts.gko',
  'board.drl',
];

describe('tracespace pipeline', () => {
  it('reports bounds in millimetres whatever the file units', async () => {
    const outline = await renderGerberLayer(text('board-Edge_Cuts.gko'));
    expect(outline.units).toBe('mm');
    outline.bounds.forEach((n, i) => expect(n).toBeCloseTo([-0.05, -0.05, 40.05, 30.05][i]!, 3));
    const drill = await renderGerberLayer(text('board.drl'));
    expect(drill.units).toBe('in');
    drill.bounds.forEach((n, i) => expect(n).toBeCloseTo([7.5, 7.5, 32.5, 22.5][i]!, 1));
  });

  it('rejects a drawably empty file rather than showing an invisible drawing', async () => {
    await expect(renderGerberLayer('M02*\n')).rejects.toMatchObject({ code: 'parse-failed' });
    expect(toMillimetres([], 'mm')).toBeNull();
    expect(unionViewBox([])).toBeNull();
  });
});

describe('GerberViewer', () => {
  it('renders a layer and reports the board shape', async () => {
    let ratio: number | null = null;
    const el = await mount(
      <GerberViewer
        name='a.gko'
        onIntrinsicAspectRatio={(r) => (ratio = r)}
        source={fixture('board-Edge_Cuts.gko')}
      />,
    );
    await waitFor(() => el.querySelector('svg[viewBox]') !== null);
    expect(el.querySelector('svg path, svg g *')).not.toBeNull();
    expect(ratio!).toBeGreaterThan(1.2);
    expect(ratio!).toBeLessThan(1.4);
  });

  it('degrades on garbage', async () => {
    const el = await mount(<GerberViewer name='a.gbr' source={new Blob(['M02*\n'])} />);
    await waitFor(() => el.querySelector('[data-fv-error="parse-failed"]') !== null);
  });
});

describe('GerberBoardViewer', () => {
  it('identifies, orders and toggles layers, and isolates a bad one', async () => {
    const files = [
      ...FILES.map((name) => ({ name, source: fixture(name) })),
      { name: 'broken.gbr', source: new Blob(['M02*\n']) },
    ];
    const el = await mount(<GerberBoardViewer files={files} />);
    await waitFor(() => el.querySelectorAll('label').length === 6);
    expect([...el.querySelectorAll('label')].map((l) => l.textContent)).toEqual([
      'Drill',
      'Outline',
      'Top silkscreen',
      'Top solder mask',
      'Top copper',
      'Bottom copper',
    ]);
    expect(el.querySelector('small')?.textContent).toBe('broken.gbr: not readable');
    const groups = () => el.querySelectorAll('svg[viewBox][role=img] > g').length;
    expect(groups()).toBe(6);
    await act(async () => el.querySelector<HTMLInputElement>('label input')!.click());
    expect(groups()).toBe(5);
  });
});

it('sniffs Gerber and Excellon headers', () => {
  for (const name of FILES) expect(gerberDefinition.sniff!(fixture(name)), name).toBe(true);
  expect(gerberDefinition.sniff!(fixture('board.kicad_pcb'))).toBe(false);
});
