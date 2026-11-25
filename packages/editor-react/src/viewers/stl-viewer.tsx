import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { cn } from '../ui/cn.ts';

import { isSafeMediaUrl } from '@formless63/editor-core';
import { RICH_STL_MAX_BYTES, parseRichStl, type RichStlMesh } from './stl-parser.ts';

export const RICH_STL_AUTOLOAD_MAX_BYTES = 8 * 1024 * 1024;
const MAX_RENDERED_TRIANGLES = 30_000;
const FALLBACK_WIDTH = 640;
const FALLBACK_HEIGHT = 480;

export interface RichStlViewerProps {
  src: string;
  title: string;
  sizeBytes?: number | null;
  className?: string;
}

interface ViewState {
  yaw: number;
  pitch: number;
  zoom: number;
}

const DEFAULT_VIEW: ViewState = { yaw: -0.7, pitch: -0.45, zoom: 1 };

export interface RichStlRenderSampling {
  triangleStride: number;
  renderedTriangleCount: number;
  isDecimated: boolean;
}

export function richStlRenderSampling(triangleCount: number): RichStlRenderSampling {
  const triangleStride = Math.max(1, Math.ceil(triangleCount / MAX_RENDERED_TRIANGLES));
  const renderedTriangleCount = Math.ceil(triangleCount / triangleStride);
  return {
    triangleStride,
    renderedTriangleCount,
    isDecimated: triangleStride > 1
  };
}

async function readBoundedResponse(response: Response): Promise<Uint8Array> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > RICH_STL_MAX_BYTES) {
    throw new Error('STL previews are limited to 20 MB.');
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > RICH_STL_MAX_BYTES) {
      throw new Error('STL previews are limited to 20 MB.');
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > RICH_STL_MAX_BYTES) {
        await reader.cancel();
        throw new Error('STL previews are limited to 20 MB.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function rotateVertex(
  coordinateX: number,
  coordinateY: number,
  coordinateZ: number,
  view: ViewState
): [number, number, number] {
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);
  const yawX = coordinateX * cosYaw + coordinateZ * sinYaw;
  const yawZ = -coordinateX * sinYaw + coordinateZ * cosYaw;
  return [yawX, coordinateY * cosPitch - yawZ * sinPitch, coordinateY * sinPitch + yawZ * cosPitch];
}

interface ProjectedTriangle {
  points: [number, number, number, number, number, number];
  depth: number;
  light: number;
}

function drawRichStl(canvas: HTMLCanvasElement, mesh: RichStlMesh, view: ViewState): void {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas rendering is unavailable.');

  const cssWidth = canvas.clientWidth || FALLBACK_WIDTH;
  const cssHeight = canvas.clientHeight || FALLBACK_HEIGHT;
  const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(cssWidth * pixelRatio));
  canvas.height = Math.max(1, Math.round(cssHeight * pixelRatio));
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, cssWidth, cssHeight);

  const centerX = (mesh.bounds.minX + mesh.bounds.maxX) / 2;
  const centerY = (mesh.bounds.minY + mesh.bounds.maxY) / 2;
  const centerZ = (mesh.bounds.minZ + mesh.bounds.maxZ) / 2;
  const diameter = Math.max(
    mesh.bounds.maxX - mesh.bounds.minX,
    mesh.bounds.maxY - mesh.bounds.minY,
    mesh.bounds.maxZ - mesh.bounds.minZ,
    Number.EPSILON
  );
  const scale = (Math.min(cssWidth, cssHeight) * 0.78 * view.zoom) / diameter;
  const { triangleStride } = richStlRenderSampling(mesh.triangleCount);
  const triangles: ProjectedTriangle[] = [];

  for (let triangleIndex = 0; triangleIndex < mesh.triangleCount; triangleIndex += triangleStride) {
    const offset = triangleIndex * 9;
    const first = rotateVertex(
      mesh.positions[offset] - centerX,
      mesh.positions[offset + 1] - centerY,
      mesh.positions[offset + 2] - centerZ,
      view
    );
    const second = rotateVertex(
      mesh.positions[offset + 3] - centerX,
      mesh.positions[offset + 4] - centerY,
      mesh.positions[offset + 5] - centerZ,
      view
    );
    const third = rotateVertex(
      mesh.positions[offset + 6] - centerX,
      mesh.positions[offset + 7] - centerY,
      mesh.positions[offset + 8] - centerZ,
      view
    );
    const edgeAx = second[0] - first[0];
    const edgeAy = second[1] - first[1];
    const edgeAz = second[2] - first[2];
    const edgeBx = third[0] - first[0];
    const edgeBy = third[1] - first[1];
    const edgeBz = third[2] - first[2];
    const normalX = edgeAy * edgeBz - edgeAz * edgeBy;
    const normalY = edgeAz * edgeBx - edgeAx * edgeBz;
    const normalZ = edgeAx * edgeBy - edgeAy * edgeBx;
    const normalLength = Math.hypot(normalX, normalY, normalZ) || 1;
    const light = Math.min(1, Math.max(0.15, Math.abs(normalZ) / normalLength));
    triangles.push({
      points: [
        cssWidth / 2 + first[0] * scale,
        cssHeight / 2 - first[1] * scale,
        cssWidth / 2 + second[0] * scale,
        cssHeight / 2 - second[1] * scale,
        cssWidth / 2 + third[0] * scale,
        cssHeight / 2 - third[1] * scale
      ],
      depth: (first[2] + second[2] + third[2]) / 3,
      light
    });
  }

  triangles.sort((first, second) => first.depth - second.depth);
  const styles = getComputedStyle(canvas);
  context.fillStyle = styles.color;
  context.strokeStyle = styles.borderTopColor;
  context.lineJoin = 'round';
  context.lineWidth = 0.7;

  for (const triangle of triangles) {
    const [firstX, firstY, secondX, secondY, thirdX, thirdY] = triangle.points;
    context.beginPath();
    context.moveTo(firstX, firstY);
    context.lineTo(secondX, secondY);
    context.lineTo(thirdX, thirdY);
    context.closePath();
    context.globalAlpha = 0.25 + triangle.light * 0.65;
    context.fill();
    context.globalAlpha = 0.45;
    context.stroke();
  }
  context.globalAlpha = 1;
}

function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export function richStlTriangleSummary(triangleCount: number): string {
  const sampling = richStlRenderSampling(triangleCount);
  if (sampling.isDecimated) {
    return `${sampling.renderedTriangleCount.toLocaleString()} of ${triangleCount.toLocaleString()} triangles shown (sampled preview)`;
  }
  return `${triangleCount.toLocaleString()} triangles`;
}

export default function RichStlViewer({
  src,
  title,
  sizeBytes,
  className
}: RichStlViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    clientX: number;
    clientY: number;
  } | null>(null);
  const pointerRotationRef = useRef({ deltaX: 0, deltaY: 0 });
  const pointerFrameRef = useRef<number | null>(null);
  const redrawRef = useRef<() => void>(() => {});
  const [visibleSource, setVisibleSource] = useState<string | null>(null);
  const [approvedSource, setApprovedSource] = useState<string | null>(null);
  const [loadEpoch, setLoadEpoch] = useState(0);
  const [meshState, setMeshState] = useState<{
    src: string;
    mesh: RichStlMesh | null;
    error: string | null;
  }>({ src, mesh: null, error: null });
  const [view, setView] = useState<ViewState>(DEFAULT_VIEW);

  const safeSource = isSafeMediaUrl(src);
  const knownTooLarge = typeof sizeBytes === 'number' && sizeBytes > RICH_STL_MAX_BYTES;
  const needsApproval = typeof sizeBytes === 'number' && sizeBytes > RICH_STL_AUTOLOAD_MAX_BYTES;
  const approved = !needsApproval || approvedSource === src;
  const visible = visibleSource === src;
  const mesh = meshState.src === src ? meshState.mesh : null;
  const error = meshState.src === src ? meshState.error : null;

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !safeSource) return;
    if (typeof IntersectionObserver === 'undefined') {
      const timeout = window.setTimeout(() => setVisibleSource(src), 0);
      return () => window.clearTimeout(timeout);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleSource(src);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [safeSource, src]);

  useEffect(() => {
    if (
      !isSafeMediaUrl(src) ||
      visibleSource !== src ||
      (typeof sizeBytes === 'number' && sizeBytes > RICH_STL_MAX_BYTES) ||
      (typeof sizeBytes === 'number' &&
        sizeBytes > RICH_STL_AUTOLOAD_MAX_BYTES &&
        approvedSource !== src)
    ) {
      return;
    }
    const controller = new AbortController();
    void fetch(src, {
      cache: loadEpoch > 0 ? 'reload' : 'default',
      credentials: 'same-origin',
      signal: controller.signal
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`The STL request failed (${response.status}).`);
        return readBoundedResponse(response);
      })
      .then((bytes) => parseRichStl(bytes))
      .then((nextMesh) => {
        if (!controller.signal.aborted) setMeshState({ src, mesh: nextMesh, error: null });
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        console.error('[rich-editor] STL preview unavailable', caught);
        setMeshState({
          src,
          mesh: null,
          error: caught instanceof Error ? caught.message : 'The STL could not be previewed.'
        });
      });
    return () => controller.abort();
  }, [approvedSource, loadEpoch, sizeBytes, src, visibleSource]);

  useEffect(() => {
    const redraw = (): void => {
      if (!mesh || !canvasRef.current) return;
      try {
        drawRichStl(canvasRef.current, mesh, view);
      } catch (caught) {
        console.error('[rich-editor] STL canvas render failed', caught);
        setMeshState((current) => ({
          src: current.src,
          mesh: null,
          error: '3D canvas rendering is unavailable.'
        }));
      }
    };
    redrawRef.current = redraw;
    return () => {
      if (redrawRef.current === redraw) redrawRef.current = () => {};
    };
  }, [mesh, view]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => redrawRef.current());
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const observer = new MutationObserver(() => redrawRef.current());
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme']
    });
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      if (pointerFrameRef.current !== null) {
        window.cancelAnimationFrame(pointerFrameRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (!mesh || !canvasRef.current) return;
    let failureTimeout: number | null = null;
    try {
      drawRichStl(canvasRef.current, mesh, view);
    } catch (caught) {
      console.error('[rich-editor] STL canvas render failed', caught);
      failureTimeout = window.setTimeout(
        () =>
          setMeshState((current) => ({
            src: current.src,
            mesh: null,
            error: '3D canvas rendering is unavailable.'
          })),
        0
      );
    }
    return () => {
      if (failureTimeout !== null) window.clearTimeout(failureTimeout);
    };
  }, [mesh, view]);

  const schedulePointerRotation = (deltaX: number, deltaY: number): void => {
    pointerRotationRef.current.deltaX += deltaX;
    pointerRotationRef.current.deltaY += deltaY;
    if (pointerFrameRef.current !== null) return;
    pointerFrameRef.current = window.requestAnimationFrame(() => {
      pointerFrameRef.current = null;
      const queuedRotation = pointerRotationRef.current;
      pointerRotationRef.current = { deltaX: 0, deltaY: 0 };
      setView((current) => ({
        ...current,
        yaw: current.yaw + queuedRotation.deltaX * 0.01,
        pitch: Math.min(
          Math.PI / 2,
          Math.max(-Math.PI / 2, current.pitch + queuedRotation.deltaY * 0.01)
        )
      }));
    });
  };

  const updateViewFromPointer = (event: ReactPointerEvent<HTMLCanvasElement>): void => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - drag.clientX;
    const deltaY = event.clientY - drag.clientY;
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY
    };
    schedulePointerRotation(deltaX, deltaY);
  };

  if (!safeSource) return <p role='status'>Preview unavailable for {title}.</p>;

  return (
    <div
      aria-label={`3D STL preview: ${title}`}
      className={cn('ce:relative ce:h-full ce:min-h-48 ce:w-full ce:overflow-hidden ce:bg-muted/30', className)}
      draggable={false}
      onDragStart={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      ref={containerRef}
    >
      {!visible ? null : knownTooLarge ? (
        <p
          className='ce:flex ce:h-full ce:min-h-48 ce:items-center ce:justify-center ce:p-4 ce:text-center ce:text-sm ce:text-muted-foreground'
          role='alert'
        >
          STL previews are limited to 20 MB.
        </p>
      ) : !approved ? (
        <button
          className='ce:flex ce:h-full ce:min-h-48 ce:w-full ce:items-center ce:justify-center ce:p-4 ce:text-sm ce:text-muted-foreground ce:hover:text-foreground'
          onClick={() => setApprovedSource(src)}
          type='button'
        >
          Load 3D preview ({megabytes(sizeBytes)})
        </button>
      ) : error ? (
        <div className='ce:flex ce:h-full ce:min-h-48 ce:flex-col ce:items-center ce:justify-center ce:gap-2 ce:p-4 ce:text-center ce:text-sm ce:text-muted-foreground'>
          <p role='alert'>{error}</p>
          <button
            className='ce:rounded-md ce:border ce:border-border ce:bg-background ce:px-3 ce:py-1.5 ce:text-foreground'
            onClick={() => {
              setMeshState({ src, mesh: null, error: null });
              setLoadEpoch((epoch) => epoch + 1);
            }}
            type='button'
          >
            Retry preview
          </button>
        </div>
      ) : (
        <>
          <canvas
            aria-label={`Interactive 3D rendering of ${title}`}
            className='ce:block ce:h-full ce:min-h-48 ce:w-full ce:touch-none ce:border-border ce:text-primary'
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setView((current) => ({
                  ...current,
                  yaw: current.yaw + (event.key === 'ArrowLeft' ? -0.12 : 0.12)
                }));
              } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                setView((current) => ({
                  ...current,
                  pitch: Math.min(
                    Math.PI / 2,
                    Math.max(-Math.PI / 2, current.pitch + (event.key === 'ArrowUp' ? -0.12 : 0.12))
                  )
                }));
              } else if (event.key === '+' || event.key === '=') {
                event.preventDefault();
                setView((current) => ({
                  ...current,
                  zoom: Math.min(4, current.zoom * 1.15)
                }));
              } else if (event.key === '-' || event.key === '_') {
                event.preventDefault();
                setView((current) => ({
                  ...current,
                  zoom: Math.max(0.35, current.zoom / 1.15)
                }));
              } else if (event.key === '0') {
                event.preventDefault();
                setView(DEFAULT_VIEW);
              }
            }}
            onPointerCancel={() => {
              dragRef.current = null;
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              dragRef.current = {
                pointerId: event.pointerId,
                clientX: event.clientX,
                clientY: event.clientY
              };
            }}
            onPointerMove={updateViewFromPointer}
            onPointerUp={(event) => {
              if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
              if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
              }
            }}
            onWheel={(event) => {
              event.preventDefault();
              setView((current) => ({
                ...current,
                zoom: Math.min(4, Math.max(0.35, current.zoom * (event.deltaY > 0 ? 0.9 : 1.1)))
              }));
            }}
            ref={canvasRef}
            tabIndex={0}
          />
          <div className='ce:pointer-events-none ce:absolute ce:inset-x-0 ce:bottom-0 ce:flex ce:items-center ce:justify-between ce:gap-2 ce:bg-background/85 ce:px-2 ce:py-1 ce:text-xs ce:text-muted-foreground'>
            <span>
              {mesh ? richStlTriangleSummary(mesh.triangleCount) : 'Loading 3D preview…'}
            </span>
            <span>Drag to rotate · Wheel to zoom · 0 to reset</span>
          </div>
        </>
      )}
    </div>
  );
}
