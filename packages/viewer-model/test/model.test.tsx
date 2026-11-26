// @vitest-environment jsdom
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fixture, mount, registerCleanup, waitFor } from '../../../scripts/test-utils.tsx';

const o3dv = vi.hoisted(() => ({
  throwOnConstruct: false,
  instances: [] as {
    element: HTMLElement;
    params: { onModelLoaded(): void; onModelLoadFailed(): void; backgroundColor: { a: number } };
    files: File[];
    resizes: number;
    destroyed: boolean;
    contextLost: boolean;
    fits: number;
    Resize(): void;
  }[],
}));
vi.mock('online-3d-viewer', () => {
  class RGBAColor {
    constructor(
      public r: number,
      public g: number,
      public b: number,
      public a: number,
    ) {}
  }
  class RGBColor {
    constructor(
      public r: number,
      public g: number,
      public b: number,
    ) {}
  }
  class EmbeddedViewer {
    files: File[] = [];
    resizes = 0;
    destroyed = false;
    contextLost = false;
    fits = 0;
    constructor(
      public element: HTMLElement,
      public params: never,
    ) {
      if (o3dv.throwOnConstruct) throw new Error('WebGL unavailable');
      o3dv.instances.push(this as never);
    }
    LoadModelFromFileList(files: File[]) {
      this.files = files;
    }
    Resize() {
      this.resizes++;
    }
    Destroy() {
      this.destroyed = true;
    }
    GetViewer() {
      return {
        renderer: {
          forceContextLoss: () => {
            this.contextLost = true;
          },
        },
        SetUpVector() {},
        GetBoundingSphere() {},
        FitSphereToWindow: () => {
          this.fits++;
        },
      };
    }
  }
  return { RGBAColor, RGBColor, EmbeddedViewer };
});
const modelViewer = vi.hoisted(() => ({ ModelViewerElement: {} as Record<string, unknown> }));
vi.mock('@google/model-viewer', () => modelViewer);

const { configureGltf, GltfViewer, gltfDefinition, meshDefinition, MeshViewer } =
  await import('../src/index.ts');
const { resolveMeshExtension } = await import('../src/mesh-format.ts');

registerCleanup();
beforeEach(() => {
  o3dv.instances.length = 0;
  o3dv.throwOnConstruct = false;
});

describe('MeshViewer', () => {
  it('loads an extension-less route through the right importer on a transparent canvas', async () => {
    vi.stubGlobal('fetch', async () => new Response(fixture('tetra-ascii.stl')));
    await mount(<MeshViewer source='/api/resources/1/content' />);
    await waitFor(() => o3dv.instances[0]?.files.length === 1);
    expect(o3dv.instances[0]!.files[0]!.name).toBe('model.stl');
    expect(o3dv.instances[0]!.params.backgroundColor.a).toBe(0);
  });

  it('is loading until the engine says so, then offers reset', async () => {
    const onStatusChange = vi.fn();
    const el = await mount(
      <MeshViewer onStatusChange={onStatusChange} source={fixture('tetra.ply')} />,
    );
    await waitFor(() => o3dv.instances.length === 1);
    expect(el.querySelector('.fv-root')!.getAttribute('data-fv-status')).toBe('loading');
    await act(async () => o3dv.instances[0]!.params.onModelLoaded());
    expect(onStatusChange).toHaveBeenLastCalledWith('ready');
    await act(async () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Reset view"]')!.click(),
    );
    expect(o3dv.instances[0]!.fits).toBe(1);
  });

  it('surfaces a file the engine rejects, instead of its own raw message', async () => {
    const el = await mount(<MeshViewer name='x.stl' source={new Blob(['nope'])} />);
    await waitFor(() => o3dv.instances.length === 1);
    await act(async () => o3dv.instances[0]!.params.onModelLoadFailed());
    expect(el.querySelector('[data-fv-error="parse-failed"]')).not.toBeNull();
  });

  it('survives an engine that cannot start', async () => {
    o3dv.throwOnConstruct = true;
    const el = await mount(<MeshViewer name='x.stl' source={fixture('tetra-ascii.stl')} />);
    await waitFor(() => el.querySelector('[data-fv-error="engine-failed"]') !== null);
  });

  it('tears down fully: no stray resizes, and the WebGL context is released', async () => {
    const el = await mount(<MeshViewer name='x.stl' source={fixture('tetra-ascii.stl')} />);
    await waitFor(() => o3dv.instances.length === 1);
    await el.rerender(<></>);
    const instance = o3dv.instances[0]!;
    expect(instance.destroyed && instance.contextLost).toBe(true);
    const before = instance.resizes;
    instance.Resize();
    expect(instance.resizes).toBe(before);
  });

  it('re-creates the viewer when the theme changes', async () => {
    await mount(<MeshViewer name='x.stl' source={fixture('tetra-ascii.stl')} />);
    await waitFor(() => o3dv.instances.length === 1);
    await act(async () => document.documentElement.classList.toggle('dark'));
    await waitFor(() => o3dv.instances.length === 2);
    expect(o3dv.instances[0]!.destroyed).toBe(true);
    document.documentElement.classList.remove('dark');
  });
});

describe('resolveMeshExtension', () => {
  it('uses name, then type, then bytes', () => {
    const none = new Uint8Array();
    expect(resolveMeshExtension({ name: 'A.OBJ' }, none)).toBe('obj');
    expect(resolveMeshExtension({ contentType: 'model/3mf' }, none)).toBe('3mf');
    expect(resolveMeshExtension({}, fixture('tetra.ply'))).toBe('ply');
    expect(resolveMeshExtension({}, fixture('tetra.off'))).toBe('off');
    expect(resolveMeshExtension({}, fixture('tetra.3mf'))).toBe('3mf');
    expect(resolveMeshExtension({}, fixture('tetra-binary.stl'))).toBe('stl');
  });
});

describe('GltfViewer', () => {
  it('sets camera controls, keeps AR opt-in, and applies decoder config', async () => {
    configureGltf({ dracoDecoderLocation: '/draco/' });
    const el = await mount(<GltfViewer name='a.glb' source='/a.glb' />);
    await waitFor(() => el.querySelector('model-viewer') !== null);
    const node = el.querySelector('model-viewer')!;
    expect(node.getAttribute('src')).toBe('/a.glb');
    expect(node.hasAttribute('camera-controls')).toBe(true);
    expect(node.hasAttribute('ar')).toBe(false);
    expect(modelViewer.ModelViewerElement['dracoDecoderLocation']).toBe('/draco/');
  });

  it('follows the element’s load and error events', async () => {
    const onStatusChange = vi.fn();
    const el = await mount(<GltfViewer ar onStatusChange={onStatusChange} source='/a.glb' />);
    await waitFor(() => el.querySelector('model-viewer') !== null);
    const node = el.querySelector('model-viewer')!;
    expect(node.hasAttribute('ar')).toBe(true);
    await act(async () => node.dispatchEvent(new Event('load')));
    expect(onStatusChange).toHaveBeenLastCalledWith('ready');
    await act(async () =>
      node.dispatchEvent(new CustomEvent('error', { detail: { type: 'loadfailure' } })),
    );
    expect(el.querySelector('[data-fv-error="parse-failed"]')).not.toBeNull();
  });
});

it('sniffs only self-identifying formats', () => {
  expect(gltfDefinition.sniff!(fixture('tetra.glb'))).toBe(true);
  expect(meshDefinition.sniff!(fixture('tetra-ascii.stl'))).toBe(true);
  expect(meshDefinition.sniff!(fixture('tetra-binary.stl'))).toBe(false);
  expect(meshDefinition.sniff!(fixture('sample.md'))).toBe(false);
});
