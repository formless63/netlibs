import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, vi } from 'vitest';

const mounted: { root: Root; container: HTMLElement }[] = [];

export async function mount(
  element: ReactElement,
): Promise<HTMLElement & { rerender: (next: ReactElement) => Promise<void> }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  await act(async () => root.render(element));
  return Object.assign(container, {
    rerender: (next: ReactElement) => act(async () => root.render(next)),
  });
}

export async function waitFor(condition: () => boolean, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`waitFor timed out:\n${document.body.innerHTML.slice(0, 2000)}`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

/** Fixture bytes in the CURRENT realm; Node's Buffer realm trips `instanceof` checks in jsdom. */
export function fixture(name: string): Uint8Array<ArrayBuffer> {
  const bytes = readFileSync(join(process.cwd(), 'fixtures', name));
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy;
}

export function response(body: BodyInit | null, init?: ResponseInit): Response {
  return new Response(body, init);
}

export function registerCleanup(): void {
  afterEach(async () => {
    for (const { root, container } of mounted.splice(0)) {
      await act(async () => root.unmount());
      container.remove();
    }
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
}
