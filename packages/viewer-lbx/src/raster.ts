import type { LbxObject } from './parse.ts';

/*
 * Two-tone raster compositing.
 *
 * Every dot of a thermal tape label is bare `tape` or printed `ink`. P-touch
 * Editor stores every object in one fixed canvas convention
 * (`color="#000000" printColorNumber="1"`), so an object's own colour says nothing
 * about the print. Two things do:
 *
 *   1. Paint order: `pt:objects` is z-order, later over earlier.
 *   2. `ropMode`, a Win32 binary raster operation (`SetROP2`), read literally:
 *
 *        R2_COPYPEN     dst := pen       -> 'set',   ink
 *        R2_NOTCOPYPEN  dst := NOT pen   -> 'clear', bare tape
 *        R2_NOT         dst := NOT dst   -> 'flip'
 *
 * NOTCOPYPEN does not read the destination. "Invert what is underneath" is R2_NOT.
 * Since every pen is the ink channel, a NOTCOPYPEN rectangle erases to tape.
 * Reading it as XOR instead draws white bars wherever a thin NOTCOPYPEN rule
 * crosses a NOTCOPYPEN badge and slices the text there; printed labels show
 * neither.
 *
 * Everything is drawn once into an SVG `<mask>`, an ink-coverage bitmap where white
 * fires a dot. 'set' and 'clear' are ordered opaque painting; only 'flip' needs a
 * blend mode. Two elements are then painted in real colour: the tape, and an ink
 * rectangle wearing the mask. So overlap is settled per pixel by the rasteriser,
 * and changing stock is two `fill` attributes.
 *
 * Area fills, glyphs, outlines and lines all use their own object's operation.
 * Placeholders for what is not drawn (barcodes, images) always 'set', so they stay
 * visible whatever they land on.
 */

/** One dot of a two-tone label: bare stock, or printed. */
export type LbxSurface = 'tape' | 'ink';

/**
 * What an object's paint does to the ink-coverage raster, straight off the
 * Win32 `R2_*` definitions: `set` = `dst := ink` (COPYPEN), `clear` =
 * `dst := tape` (NOTCOPYPEN, whose pen is ink so `NOT pen` is tape), `flip` =
 * `dst := NOT dst` (NOT).
 */
export type LbxPaintOp = 'set' | 'clear' | 'flip';

/** CSS blend mode that realises each op inside the coverage mask. */
export const LBX_BLEND_MODE: Record<LbxPaintOp, 'normal' | 'difference'> = {
  // Opaque paints — the composite is ordered painting, not blending.
  set: 'normal',
  clear: 'normal',
  // On a 0/1 raster, `difference` against white is exactly XOR.
  flip: 'difference',
};

/** Full coverage inside the mask — "fire a dot here". */
export const LBX_COVERAGE = '#ffffff';
/** No coverage — bare tape. */
export const LBX_NO_COVERAGE = '#000000';

/** the value each op paints into the coverage mask. */
export const LBX_OP_COVERAGE: Record<LbxPaintOp, string> = {
  set: LBX_COVERAGE,
  clear: LBX_NO_COVERAGE,
  // `difference` needs full white to invert what is under it.
  flip: LBX_COVERAGE,
};

/** The two-tone NOT. */
function opposite(s: LbxSurface): LbxSurface {
  return s === 'ink' ? 'tape' : 'ink';
}

/**
 * The raster-op decision: COPYPEN lays ink, NOTCOPYPEN erases to tape, NOT inverts,
 * anything else is treated as COPYPEN.
 *
 * The object's own `color` is deliberately not consulted. It is the same
 * boilerplate on every object of a label, so it cannot tell a field from a badge;
 * `printColorNumber` names the print channel, not a physical colour.
 */
export function resolveLbxRopOp(ropMode: string | undefined): LbxPaintOp {
  switch (ropMode?.trim().toUpperCase()) {
    case 'NOTCOPYPEN':
      return 'clear';
    case 'NOT':
      return 'flip';
    default:
      return 'set';
  }
}

/** Does this object paint a filled area (and therefore change the surface)? */
function areaFillOf(obj: LbxObject): boolean {
  return obj.type === 'rect' && obj.brush != null;
}

/** The op an object's area fill applies, or null when it fills no area. */
export function resolveLbxAreaFillOp(obj: LbxObject): LbxPaintOp | null {
  if (!areaFillOf(obj)) return null;
  return resolveLbxRopOp(obj.position.ropMode);
}

export interface LbxObjectPaint {
  /** Op this object's area fill applies; null when it fills no area. */
  fill: LbxPaintOp | null;
  /** Op this object's glyphs / strokes apply — its own raster op. */
  mark: LbxPaintOp;
}

/** Every object's operations. Per object, never geometric. */
export function resolveLbxPaintOps(objects: readonly LbxObject[]): LbxObjectPaint[] {
  return objects.map((obj) => ({
    // The one and only raster-op decision — see resolveLbxRopOp.
    fill: resolveLbxAreaFillOp(obj),
    mark: resolveLbxRopOp(obj.position.ropMode),
  }));
}

/** Apply one op to a surface. The whole raster model, in three cases. */
function applyOp(surface: LbxSurface, op: LbxPaintOp): LbxSurface {
  return op === 'set' ? 'ink' : op === 'clear' ? 'tape' : opposite(surface);
}

/**
 * The surface at a point, from the area fills of `objects` (or the first `upTo`).
 * A reference evaluator for tests; rendering uses the mask.
 */
export function resolveLbxSurfaceAt(
  objects: readonly LbxObject[],
  x: number,
  y: number,
  upTo: number = objects.length,
): LbxSurface {
  const ops = resolveLbxPaintOps(objects);
  let surface: LbxSurface = 'tape';
  for (let i = 0; i < Math.min(upTo, objects.length); i++) {
    const op = ops[i]?.fill;
    const p = objects[i]?.position;
    if (!op || !p) continue;
    if (x < p.x || x > p.x + p.width || y < p.y || y > p.y + p.height) continue;
    surface = applyOp(surface, op);
  }
  return surface;
}

/** The tone a mark of `objects[index]` prints at a point. */
export function resolveLbxMarkSurfaceAt(
  objects: readonly LbxObject[],
  index: number,
  x: number,
  y: number,
): LbxSurface {
  const op = resolveLbxPaintOps(objects)[index]?.mark ?? 'set';
  return applyOp(resolveLbxSurfaceAt(objects, x, y, index), op);
}
