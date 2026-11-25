/**
 * Load KiCanvas once per page. The bundle defines its elements at module top
 * level and throws if evaluated twice, so a copy loaded by anything else wins.
 */
let pending: Promise<void> | null = null;

export interface KicadConfig {
  /** Replace the vendored engine, e.g. to load a newer KiCanvas build. */
  loadEngine?: (() => Promise<unknown>) | undefined;
}

let config: KicadConfig = {};

/** Call before the first KiCad file renders. */
export function configureKicad(next: KicadConfig): void {
  config = { ...next };
}

export function loadKicanvas(): Promise<void> {
  if (customElements.get('kicanvas-embed')) return Promise.resolve();
  pending ??= (async () => {
    if (config.loadEngine) {
      await config.loadEngine();
    } else {
      await Promise.all([import('../vendor/kicanvas.js'), loadIconFont()]);
    }
    if (!customElements.get('kicanvas-embed')) throw new Error('KiCanvas did not register');
  })().catch((error: unknown) => {
    // Allow a retry instead of caching the failure.
    pending = null;
    throw error;
  });
  return pending;
}

/** KiCanvas draws toolbar icons as Material Symbols ligatures. */
async function loadIconFont(): Promise<void> {
  const { default: dataUrl } = await import('../vendor/material-symbols.js');
  if (typeof FontFace === 'undefined') return;
  const face = new FontFace('Material Symbols Outlined', `url(${dataUrl})`, { weight: '400' });
  document.fonts.add(face);
  await face.load().catch(() => {});
}
