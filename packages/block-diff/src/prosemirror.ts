import type { BlockDiffOptions } from './diff.ts';
import type { IdentityTree } from './identity.ts';
import { stableJson } from './stable-json.ts';

/** ProseMirror / Tiptap JSON. Structural: no ProseMirror dependency. */
export interface ProseMirrorNode {
  type: string;
  attrs?: Record<string, unknown> | undefined;
  content?: ProseMirrorNode[] | undefined;
  marks?: unknown[] | undefined;
  text?: string | undefined;
}

export interface ProseMirrorIdOptions {
  /** Attribute holding the block id. Default `blockId`. */
  idAttribute?: string | undefined;
  /** Accept only well-formed ids, e.g. by pattern. Default: any non-empty string. */
  isId?: ((value: string) => boolean) | undefined;
}

export interface ProseMirrorDiffOptions extends ProseMirrorIdOptions {
  /**
   * Treat an attribute set to null as absent, and empty `attrs` as none. Needed
   * to compare `editor.getJSON()`, which writes every default, with JSON from an
   * importer, which does not. Default: false.
   */
  ignoreNullAttrs?: boolean | undefined;
  /** Attributes that are not content, e.g. presentation. */
  ignoreAttrs?: readonly string[] | undefined;
}

/** Options for `diffBlocks(before.content, after.content, …)`. Ids at any depth are not content. */
export function proseMirrorDiff<T extends ProseMirrorNode = ProseMirrorNode>(
  options: ProseMirrorDiffOptions = {},
): BlockDiffOptions<T> {
  const ignored = new Set([options.idAttribute ?? 'blockId', ...(options.ignoreAttrs ?? [])]);
  return {
    getId: (node) => readId(node, options),
    getContent: (node) => contentKey(node, ignored, options.ignoreNullAttrs ?? false),
  };
}

/** How `ensureIds` and `renewIds` walk ProseMirror JSON. */
export function proseMirrorTree(
  nodeTypes: Iterable<string>,
  options: ProseMirrorIdOptions = {},
): IdentityTree<ProseMirrorNode> {
  const types = new Set(nodeTypes);
  const attribute = options.idAttribute ?? 'blockId';
  return {
    children: (node) => node.content ?? [],
    getId: (node) => readId(node, options),
    setId: (node, id) => {
      node.attrs = { ...node.attrs, [attribute]: id };
    },
    identifies: (node) => types.has(node.type),
  };
}

function readId(node: ProseMirrorNode, options: ProseMirrorIdOptions): string | null {
  const id = node.attrs?.[options.idAttribute ?? 'blockId'];
  if (typeof id !== 'string' || id === '') return null;
  return (options.isId?.(id) ?? true) ? id : null;
}

/**
 * Attributes are filtered only on nodes (objects with a `type`), so a mark's or
 * a custom attribute's own member of the same name still counts as content.
 */
function contentKey(
  node: ProseMirrorNode,
  ignored: ReadonlySet<string>,
  ignoreNull: boolean,
): string {
  const attrs: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node.attrs ?? {})) {
    if (ignored.has(key) || (ignoreNull && value === null)) continue;
    attrs[key] = value;
  }
  const { attrs: _attrs, content, ...rest } = node;
  const children = content?.map((child) => contentKey(child, ignored, ignoreNull)) ?? [];
  // An empty attrs object, and an empty content array, mean the same as none.
  return `${stableJson(rest)}${Object.keys(attrs).length > 0 ? stableJson(attrs) : ''}[${children.join(',')}]`;
}
