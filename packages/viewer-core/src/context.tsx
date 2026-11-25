'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { ViewerRegistry } from './registry.ts';
import type { ViewerAdapter, ViewerMessages } from './types.ts';

export const DEFAULT_VIEWER_MESSAGES: ViewerMessages = {
  loading: 'Loading preview…',
  loadFailed: 'Preview unavailable.',
  unsupported: 'No preview is available for this file type.',
  open: 'Open file',
  download: 'Download',
  retry: 'Try again',
  loadPreview: (size) => `Load preview (${size})`,
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  resetView: 'Reset view',
  fullscreen: 'Toggle full screen',
};

export interface ViewerContextValue {
  registry: ViewerRegistry;
  adapter: ViewerAdapter;
  messages: ViewerMessages;
}

const DEFAULT_CONTEXT: ViewerContextValue = {
  registry: new ViewerRegistry(),
  adapter: {},
  messages: DEFAULT_VIEWER_MESSAGES,
};

const ViewerContext = createContext<ViewerContextValue>(DEFAULT_CONTEXT);

export interface ViewerProviderProps {
  registry?: ViewerRegistry | undefined;
  /** Keep a stable reference: a new adapter object reloads mounted viewers. */
  adapter?: ViewerAdapter | undefined;
  messages?: Partial<ViewerMessages> | undefined;
  children: ReactNode;
}

/** Unset values inherit from an outer provider. */
export function ViewerProvider({ registry, adapter, messages, children }: ViewerProviderProps) {
  const parent = useContext(ViewerContext);
  const value = useMemo<ViewerContextValue>(
    () => ({
      registry: registry ?? parent.registry,
      adapter: adapter ?? parent.adapter,
      messages: messages ? { ...parent.messages, ...messages } : parent.messages,
    }),
    [registry, adapter, messages, parent],
  );
  return <ViewerContext value={value}>{children}</ViewerContext>;
}

export function useViewerContext(): ViewerContextValue {
  return useContext(ViewerContext);
}
