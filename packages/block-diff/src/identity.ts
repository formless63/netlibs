// Crockford base32: no I, L, O or U, so ids survive being read aloud.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A random block id: `b_` and 16 base32 characters, 80 bits. Unique within a
 * document in practice; the tree helpers below also check.
 */
export function createBlockId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let id = 'b_';
  for (const byte of bytes) id += ALPHABET[byte % 32];
  return id;
}

/** Any JSON tree: how to visit it is the caller's to define. */
export interface IdentityTree<T> {
  children: (node: T) => readonly T[];
  getId: (node: T) => string | null;
  /** Assign in place. */
  setId: (node: T, id: string) => void;
  /** Which nodes carry identity. */
  identifies: (node: T) => boolean;
}

/**
 * Give every identity-bearing node a unique id, in place. Existing ids are kept;
 * of several nodes sharing one, the first in document order keeps it, which is
 * what splitting or duplicating a block should mean. Returns how many changed.
 */
export function ensureIds<T>(
  roots: readonly T[],
  tree: IdentityTree<T>,
  createId: () => string = createBlockId,
): number {
  const seen = new Set<string>();
  const pending: T[] = [];
  visit(roots, tree, (node) => {
    const id = tree.getId(node);
    if (id !== null && !seen.has(id)) seen.add(id);
    else pending.push(node);
  });
  for (const node of pending) tree.setId(node, unusedId(seen, createId));
  return pending.length;
}

/**
 * Replace every existing id, in place: for a copy that must not share an
 * identity namespace (comments, history) with its source. Nodes without an id
 * stay without one; follow with `ensureIds` to fill them.
 */
export function renewIds<T>(
  roots: readonly T[],
  tree: IdentityTree<T>,
  createId: () => string = createBlockId,
): number {
  const seen = new Set<string>();
  const nodes: T[] = [];
  visit(roots, tree, (node) => {
    const id = tree.getId(node);
    if (id === null) return;
    // The old ids are taken too, so no new id can equal one of them.
    seen.add(id);
    nodes.push(node);
  });
  for (const node of nodes) tree.setId(node, unusedId(seen, createId));
  return nodes.length;
}

function visit<T>(nodes: readonly T[], tree: IdentityTree<T>, each: (node: T) => void): void {
  for (const node of nodes) {
    if (tree.identifies(node)) each(node);
    visit(tree.children(node), tree, each);
  }
}

function unusedId(seen: Set<string>, createId: () => string): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    const id = createId();
    if (seen.has(id)) continue;
    seen.add(id);
    return id;
  }
  throw new Error('createId keeps returning ids already in use');
}
