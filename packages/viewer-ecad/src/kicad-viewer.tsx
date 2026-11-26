'use client';

import { createElement, useEffect, useMemo, useRef, useState } from 'react';

import {
  ResolvedSource,
  useLatest,
  useResolvedSource,
  useViewerContext,
  useViewerLoad,
  ViewerError,
  ViewerFailure,
  ViewerLoading,
  ViewerRoot,
  type ViewerInput,
  type ViewerProps,
} from '@formless63/viewer-core';

import { loadKicanvas } from './kicanvas.ts';

export interface KicadCompanion {
  /** Filename including extension; sheets are matched by this name. */
  name: string;
  source: ViewerInput;
}

export interface KicadViewerProps extends ViewerProps {
  /**
   * Related files: hierarchical sheets, or the board beside its schematic.
   * Keep a stable reference: a new array reloads the project.
   */
  companions?: readonly KicadCompanion[] | undefined;
  theme?: 'kicad' | 'witchhazel' | undefined;
}

interface KicadDocument {
  name: string;
  text: string;
}

const LOAD_TIMEOUT_MS = 30_000;

/**
 * KiCad boards and schematics through KiCanvas, with its pan, zoom, layer and
 * object panels.
 *
 * Sources are inlined rather than passed as URLs: KiCanvas picks a parser from
 * the URL's extension, which authorised content routes rarely have.
 */
export default function KicadViewer({ companions, theme = 'kicad', ...props }: KicadViewerProps) {
  const { adapter } = useViewerContext();
  const source = useResolvedSource(props);
  const load = useMemo(
    () =>
      async (main: ResolvedSource, signal: AbortSignal): Promise<KicadDocument[]> => {
        try {
          await loadKicanvas();
        } catch (cause) {
          throw new ViewerError('engine-failed', 'The KiCad engine could not load', { cause });
        }
        const extras = (companions ?? []).map(
          (file) => new ResolvedSource(file.source, { name: file.name }, adapter),
        );
        return Promise.all(
          [main, ...extras].map(async (item) => {
            const text = await item.text(signal);
            return { name: kicadName(item.file.name, text), text };
          }),
        );
      },
    [adapter, companions],
  );
  const { onStatusChange, controls = true } = props;
  const { state, retry, fail } = useViewerLoad(source, load, { onStatusChange, deferReady: true });
  const hostRef = useRef<HTMLDivElement>(null);
  const statusRef = useLatest(onStatusChange);
  const [ready, setReady] = useState(false);
  const documents = state.value;

  useEffect(() => {
    const embed = hostRef.current?.querySelector<
      HTMLElement & { loaded?: boolean; loading?: boolean }
    >('kicanvas-embed');
    if (!embed || !documents) return;
    setReady(false);
    // KiCanvas emits no load or error event from the embed, and parse failures
    // surface only as an unhandled rejection. Its reflected `loading` and
    // `loaded` attributes are the one observable signal.
    let started = false;
    const check = () => {
      if (embed.loaded) {
        stop();
        setReady(true);
        statusRef.current?.('ready');
      } else if (embed.loading) {
        started = true;
      } else if (started) {
        stop();
        fail(new ViewerError('parse-failed', 'The KiCad file could not be read'));
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(embed, { attributes: true });
    const timer = setTimeout(() => {
      stop();
      fail(new ViewerError('parse-failed', 'The KiCad file did not load in time'));
    }, LOAD_TIMEOUT_MS);
    function stop() {
      observer.disconnect();
      clearTimeout(timer);
    }
    check();
    return stop;
  }, [documents, fail, statusRef]);

  const name = source.file.name;
  const status = state.status === 'ready' && !ready ? 'loading' : state.status;
  return (
    <ViewerRoot
      className={props.className}
      label={name ? `KiCad: ${name}` : 'KiCad file'}
      status={status}
      style={props.style}
      viewer='kicad'
    >
      {state.status === 'error' ? (
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      ) : (
        <>
          <div className='fv-fill' ref={hostRef}>
            {documents
              ? createElement(
                  'kicanvas-embed',
                  {
                    // Sources are only read on connect, so new files remount.
                    key: identity(documents),
                    controls: controls ? 'full' : 'none',
                    controlslist: 'nodownload',
                    theme,
                    style: { width: '100%', height: '100%', display: 'block', aspectRatio: 'auto' },
                  },
                  documents.map((file, index) =>
                    createElement('kicanvas-source', { key: index, name: file.name }, file.text),
                  ),
                )
              : null}
          </div>
          {status === 'loading' ? (
            <div className='fv-overlay' style={{ pointerEvents: 'none' }}>
              <ViewerLoading />
            </div>
          ) : null}
        </>
      )}
    </ViewerRoot>
  );
}

const identities = new WeakMap<object, number>();
let nextIdentity = 0;

/** A stable React key per loaded project object. */
function identity(value: object): number {
  let id = identities.get(value);
  if (id === undefined) identities.set(value, (id = nextIdentity++));
  return id;
}

/**
 * KiCanvas types an inline source from its name. Validates the content too, so
 * a mislabelled file fails clearly instead of hanging the engine.
 */
export function kicadName(name: string | undefined, text: string): string {
  const kind = /^\s*\(kicad_(pcb|sch|wks)\b/.exec(text)?.[1];
  if (!kind) throw new ViewerError('parse-failed', 'This is not a KiCad board or schematic');
  // KiCanvas reads a truncated file without complaint and then throws on draw.
  if (!isBalanced(text)) throw new ViewerError('parse-failed', 'The KiCad file is incomplete');
  return name?.toLowerCase().endsWith(`.kicad_${kind}`) ? name : `document.kicad_${kind}`;
}

/** Whether the file's parentheses balance, ignoring those inside strings. */
export function isBalanced(text: string): boolean {
  let depth = 0;
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (quoted) {
      if (code === 92) i++;
      else if (code === 34) quoted = false;
    } else if (code === 34) quoted = true;
    else if (code === 40) depth++;
    else if (code === 41 && --depth < 0) return false;
  }
  return depth === 0 && !quoted;
}
