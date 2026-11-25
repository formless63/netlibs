import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

import type { ViewerDefinition, ViewerFileInfo, ViewerProps } from './types.ts';

/**
 * Types that describe the encoding rather than the format. An `.stl` served as
 * `application/octet-stream` or a `.gltf` served as `application/json` must
 * resolve by extension, so these only count when no extension matched.
 */
const GENERIC_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'application/octet-stream',
  'binary/octet-stream',
  'application/json',
  'application/xml',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
  'text/xml',
]);

export function bareContentType(contentType: string | null | undefined): string | null {
  if (typeof contentType !== 'string') return null;
  return contentType.split(';', 1)[0]?.trim().toLowerCase() || null;
}

export function fileExtension(name: string | null | undefined): string | null {
  if (typeof name !== 'string') return null;
  return /\.([a-z0-9_]{1,12})$/i.exec(name.trim())?.[1]?.toLowerCase() ?? null;
}

export type ViewerComponent = LazyExoticComponent<ComponentType<ViewerProps>>;

/**
 * Format → viewer resolution. Constructing and querying a registry is
 * server-safe; a viewer's code is only imported when its component renders.
 */
export class ViewerRegistry {
  readonly #byKey = new Map<string, ViewerDefinition>();
  readonly #byExtension = new Map<string, ViewerDefinition>();
  readonly #byContentType = new Map<string, ViewerDefinition>();
  readonly #components = new Map<string, ViewerComponent>();

  /** Later definitions win on conflicts, so hosts can override a built-in. */
  constructor(definitions: readonly ViewerDefinition[] = []) {
    for (const definition of definitions) {
      this.#byKey.set(definition.key, definition);
      for (const ext of definition.extensions) this.#byExtension.set(ext.toLowerCase(), definition);
      for (const type of definition.contentTypes) {
        this.#byContentType.set(type.toLowerCase(), definition);
      }
    }
  }

  get definitions(): ViewerDefinition[] {
    return [...this.#byKey.values()];
  }

  get(key: string): ViewerDefinition | null {
    return this.#byKey.get(key) ?? null;
  }

  /** Specific MIME type, then extension, then generic MIME type. */
  resolve(file: Pick<ViewerFileInfo, 'name' | 'contentType'>): ViewerDefinition | null {
    const type = bareContentType(file.contentType);
    const byType = type ? this.#byContentType.get(type) : undefined;
    if (byType && type && !GENERIC_CONTENT_TYPES.has(type)) return byType;
    const ext = fileExtension(file.name);
    return (ext ? this.#byExtension.get(ext) : undefined) ?? byType ?? null;
  }

  /** Resolve from leading bytes. Only definitions with a `sniff` participate. */
  sniff(head: Uint8Array): ViewerDefinition | null {
    for (const definition of this.#byKey.values()) {
      if (definition.sniff?.(head)) return definition;
    }
    return null;
  }

  /** Memoised per key: a new lazy identity would remount and re-import. */
  component(key: string): ViewerComponent | null {
    const cached = this.#components.get(key);
    if (cached) return cached;
    const definition = this.#byKey.get(key);
    if (!definition) return null;
    const component = lazy(definition.load);
    this.#components.set(key, component);
    return component;
  }

  /** Drop a failed lazy import so the next render can try again. */
  resetComponent(key: string): void {
    this.#components.delete(key);
  }
}

export function createViewerRegistry(definitions: readonly ViewerDefinition[]): ViewerRegistry {
  return new ViewerRegistry(definitions);
}

/** Decode leading bytes as Latin-1 for magic-string checks. */
export function headText(head: Uint8Array, length = 256): string {
  let out = '';
  for (let i = 0; i < Math.min(length, head.length); i++) out += String.fromCharCode(head[i] ?? 0);
  return out.replace(/^ï»¿/, '');
}
