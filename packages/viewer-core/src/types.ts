import type { ComponentType, CSSProperties } from 'react';

import type { ViewerError } from './errors.ts';

/**
 * Anything a viewer can read bytes from.
 *
 * A `string` is always a URL, never inline content; wrap text in a `Blob`.
 * In-memory inputs are compared by identity, so keep a stable reference
 * (state, `useMemo`) instead of building a new `Blob` on every render.
 */
export type ViewerInput = string | URL | Blob | ArrayBuffer | ArrayBufferView;

/** Facts about the file that the input itself may not carry. */
export interface ViewerFileInfo {
  /** Filename. Drives format detection and accessible labels. */
  name?: string | undefined;
  /** MIME type, when the host knows it. */
  contentType?: string | undefined;
  /** Byte size, when known. Drives the auto-load guard for URL inputs. */
  sizeBytes?: number | null | undefined;
}

export type ViewerStatus = 'idle' | 'loading' | 'ready' | 'error';

/** The uniform contract every viewer component implements. */
export interface ViewerProps extends ViewerFileInfo {
  source: ViewerInput;
  /** Show the viewer's own controls. Defaults to true. */
  controls?: boolean | undefined;
  className?: string | undefined;
  style?: CSSProperties | undefined;
  onStatusChange?: ((status: ViewerStatus, error?: ViewerError) => void) | undefined;
  /**
   * Viewers whose artwork has a real intrinsic shape (a label strip, an image,
   * a board) report `width / height` once known so the frame can hug it.
   * Viewers that fill whatever box they get never call this.
   */
  onIntrinsicAspectRatio?: ((ratio: number | null) => void) | undefined;
}

export interface ViewerDefinition {
  /** Stable id, e.g. `pdf`. */
  key: string;
  /** Human label for the format family, e.g. `PDF document`. */
  label: string;
  /** Lower-case extensions without the dot. */
  extensions: readonly string[];
  /** Lower-case bare MIME types. */
  contentTypes: readonly string[];
  /** Recognise the file from its first bytes, for unnamed in-memory inputs. */
  sniff?: ((head: Uint8Array) => boolean) | undefined;
  /** CSS `aspect-ratio` used until the viewer reports its own. */
  aspectRatio?: string | undefined;
  /** Lazily import the viewer component. */
  load: () => Promise<{ default: ComponentType<ViewerProps> }>;
}

export interface ViewerAdapter {
  /**
   * Fetch bytes for a URL input. Supplying this makes every viewer read URLs
   * through it (then use in-memory bytes or a `blob:` URL), so headers, token
   * refresh and signed URLs work even in engines that only accept a URL.
   * Without it, viewers use the URL directly with `credentials: 'same-origin'`,
   * which keeps browser streaming and range requests.
   */
  fetch?: ((url: string, init: RequestInit) => Promise<Response>) | undefined;
  /** Map an input URL (e.g. an internal id URL) to the URL to request. */
  resolveUrl?: ((url: string) => string | Promise<string>) | undefined;
  /** Href for "Open". Return null to hide it. Defaults to the input URL. */
  getOpenHref?: ((url: string, file: ViewerFileInfo) => string | null) | undefined;
  /** Href for "Download". Return null to hide it. Defaults to the input URL. */
  getDownloadHref?: ((url: string, file: ViewerFileInfo) => string | null) | undefined;
  /** Observe failures (telemetry). Viewers already degrade on their own. */
  onError?: ((error: ViewerError, file: ViewerFileInfo) => void) | undefined;
  /** Refuse to buffer more than this many bytes. Default: no ceiling. */
  maxBytes?: number | undefined;
}

export interface ViewerMessages {
  loading: string;
  loadFailed: string;
  unsupported: string;
  open: string;
  download: string;
  retry: string;
  loadPreview: (size: string) => string;
  zoomIn: string;
  zoomOut: string;
  resetView: string;
  fullscreen: string;
}
