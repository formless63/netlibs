// @vitest-environment jsdom
import { act } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { fixture, mount, registerCleanup, waitFor } from '../../../scripts/test-utils.tsx';
import { configureKicad, kicadDefinition, KicadViewer } from '../src/index.ts';
import { isBalanced, kicadName } from '../src/kicad-viewer.tsx';

registerCleanup();

// jsdom cannot run KiCanvas (WebGL); these pin the contract around it. The real
// engine is exercised in the Playwright suite.
class FakeEmbed extends HTMLElement {
  get loaded() {
    return this.hasAttribute('loaded');
  }
  get loading() {
    return this.hasAttribute('loading');
  }
}
let engineLoads = 0;
beforeAll(() => {
  configureKicad({
    loadEngine: async () => {
      engineLoads++;
      customElements.define('kicanvas-embed', FakeEmbed);
    },
  });
});

describe('KicadViewer', () => {
  it('loads the engine once for concurrent viewers and inlines a named source', async () => {
    const el = await mount(
      <>
        <KicadViewer name='a.kicad_pcb' source={fixture('board.kicad_pcb')} />
        <KicadViewer source={fixture('board.kicad_sch')} />
      </>,
    );
    await waitFor(() => el.querySelectorAll('kicanvas-source').length === 2);
    expect(engineLoads).toBe(1);
    const sources = [...el.querySelectorAll('kicanvas-source')];
    expect(sources.map((s) => s.getAttribute('name'))).toEqual([
      'a.kicad_pcb',
      'document.kicad_sch',
    ]);
    expect(sources[0]!.textContent).toContain('(kicad_pcb');
    expect(el.querySelector('kicanvas-embed')!.getAttribute('controls')).toBe('full');
  });

  it('passes companions as sibling sources', async () => {
    const companions = [{ name: 'board.kicad_sch', source: fixture('board.kicad_sch') }];
    const el = await mount(
      <KicadViewer
        companions={companions}
        name='board.kicad_pcb'
        source={fixture('board.kicad_pcb')}
      />,
    );
    await waitFor(() => el.querySelectorAll('kicanvas-source').length === 2);
  });

  it('reads ready and parse failure from the engine’s reflected attributes', async () => {
    const onStatusChange = vi.fn();
    const el = await mount(
      <KicadViewer onStatusChange={onStatusChange} source={fixture('board.kicad_pcb')} />,
    );
    await waitFor(() => el.querySelector('kicanvas-embed') !== null);
    const embed = el.querySelector('kicanvas-embed')!;
    await act(async () => embed.setAttribute('loading', ''));
    await act(async () => {
      embed.setAttribute('loaded', '');
      embed.removeAttribute('loading');
    });
    await waitFor(() => onStatusChange.mock.lastCall?.[0] === 'ready');

    const bad = await mount(<KicadViewer source={new Blob(['(kicad_pcb (oops))'])} />);
    await waitFor(() => bad.querySelector('kicanvas-embed') !== null);
    const badEmbed = bad.querySelector('kicanvas-embed')!;
    await act(async () => badEmbed.setAttribute('loading', ''));
    await act(async () => badEmbed.removeAttribute('loading'));
    await waitFor(() => bad.querySelector('[data-fv-error="parse-failed"]') !== null);
  });

  it('rejects content that is not KiCad, whatever its name says', async () => {
    const el = await mount(<KicadViewer name='x.kicad_pcb' source={new Blob(['<html>'])} />);
    await waitFor(() => el.querySelector('[data-fv-error="parse-failed"]') !== null);
    expect(kicadName('wrong.kicad_sch', '(kicad_pcb)')).toBe('document.kicad_pcb');
  });
});

it('detects truncation, ignoring parentheses in strings', () => {
  expect(isBalanced('(a "(" (b "\\")("))')).toBe(true);
  expect(isBalanced('(a (b)')).toBe(false);
  expect(isBalanced('(a))')).toBe(false);
  expect(isBalanced('(a "unterminated)')).toBe(false);
});

it('sniffs boards and schematics only', () => {
  expect(kicadDefinition.sniff!(fixture('board.kicad_pcb'))).toBe(true);
  expect(kicadDefinition.sniff!(fixture('board.kicad_sch'))).toBe(true);
  expect(kicadDefinition.sniff!(new TextEncoder().encode('(footprint "x"'))).toBe(false);
});
