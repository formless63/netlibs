'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';

import {
  PanZoom,
  useResolvedSource,
  useViewerLoad,
  ViewerFailure,
  ViewerIcon,
  ViewerLoading,
  ViewerRoot,
  type ResolvedSource,
  type ViewerProps,
} from '@formless63/viewer-core';

import { DEFAULT_LBX_COLORS, resolveLbxBaseColors, type LbxColors } from './colors.ts';
import { resolveLbxFontMetrics, type LbxFonts } from './font-metrics.ts';
import { LBX_CONDENSED_STACK, resolveLbxFontStack } from './fonts.ts';
import { LBX_VIEW_BLEED_PT, resolveLbxGeometry } from './geometry.ts';
import type { LbxLabel, LbxObject, LbxTextObject } from './parse.ts';
import {
  LBX_BLEND_MODE,
  LBX_COVERAGE,
  LBX_NO_COVERAGE,
  LBX_OP_COVERAGE,
  resolveLbxPaintOps,
  type LbxObjectPaint,
  type LbxPaintOp,
} from './raster.ts';
import { LBX_FILE_STOCK_ID, LBX_TAPE_STOCKS, resolveLbxTapeStock } from './tape-stocks.ts';
import { resolveLbxTextBaselines, textLines } from './text-layout.ts';

export interface LbxViewerProps extends ViewerProps {
  /** Faces the host loads, keyed by the Brother font name in the file. */
  fonts?: LbxFonts | undefined;
  /** Colours for files that declare no stock. Defaults to black on white. */
  fallbackColors?: LbxColors | undefined;
  /** Offer the tape-stock preview selector. Defaults to true. */
  stockSelector?: boolean | undefined;
  /** Called with the parsed label, e.g. to show its metadata. */
  onLabel?: ((label: LbxLabel) => void) | undefined;
}

const NO_FONTS: LbxFonts = {};

async function loadLabel(source: ResolvedSource, signal: AbortSignal): Promise<LbxLabel> {
  const { parseLbxLabel } = await import('./parse.ts');
  return parseLbxLabel(await source.arrayBuffer(signal));
}

/** Brother P-touch `.lbx` labels as a two-tone SVG approximation of the print. */
export default function LbxViewer({
  fonts = NO_FONTS,
  fallbackColors = DEFAULT_LBX_COLORS,
  stockSelector = true,
  onLabel,
  ...props
}: LbxViewerProps) {
  // Mask ids must be unique per mounted viewer, or two labels on one page
  // would share a single `url(#…)` target.
  const maskSeed = useId();
  const source = useResolvedSource(props);
  const { onIntrinsicAspectRatio, onStatusChange, controls = true } = props;
  const { state, retry } = useViewerLoad(source, loadLabel, { onStatusChange });
  const label = state.value;
  // Preview-only: never written to the file, and reset on every mount, so a
  // label always opens on its own declared stock.
  const [stockId, setStockId] = useState<string>(LBX_FILE_STOCK_ID);

  useEffect(() => {
    if (label) onLabel?.(label);
  }, [label, onLabel]);

  const geometry = useMemo(() => (label ? resolveLbxGeometry(label) : null), [label]);
  // Measured on the bled viewBox, which is exactly what the SVG paints.
  useEffect(() => {
    if (!geometry || !onIntrinsicAspectRatio) return;
    const width = geometry.lengthPt + LBX_VIEW_BLEED_PT * 2;
    const height = geometry.tapeWidthPt + LBX_VIEW_BLEED_PT * 2;
    if (width > 0 && height > 0) onIntrinsicAspectRatio(width / height);
  }, [geometry, onIntrinsicAspectRatio]);

  const name = source.file.name;
  const shared = {
    className: props.className,
    label: name ? `Label: ${name}` : 'Label',
    style: props.style,
    viewer: 'lbx',
  };
  if (state.status === 'error') {
    return (
      <ViewerRoot {...shared} status='error'>
        <ViewerFailure error={state.error} onRetry={retry} source={source} />
      </ViewerRoot>
    );
  }
  if (!label || !geometry) {
    return (
      <ViewerRoot {...shared} status='loading'>
        <ViewerLoading message='Rendering label…' />
      </ViewerRoot>
    );
  }

  const fileColors = resolveLbxBaseColors(label, fallbackColors);
  const stock = resolveLbxTapeStock(stockId);
  const { tape, ink } = stock ?? fileColors;
  const paints = resolveLbxPaintOps(label.objects);
  const pad = LBX_VIEW_BLEED_PT;
  const maskId = `lbx-ink-${maskSeed.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fileStockLabel = `File stock (${colorName(fileColors.ink)} on ${colorName(fileColors.tape)})`;
  const stockLabel = `Preview tape stock: ${
    stock ? `${stock.label} · ${stock.tze}` : fileStockLabel
  } (preview only, does not change the file)`;

  return (
    <ViewerRoot
      {...shared}
      status='ready'
      style={{ background: 'var(--fv-muted)', ...props.style }}
    >
      <PanZoom
        controls={controls}
        label='Label view'
        toolbar={
          controls && stockSelector ? (
            // A native <select> stretched transparent over an icon: keyboard and
            // screen-reader correct, and no popover that must escape the frame.
            <span className='fv-button' style={{ position: 'relative' }}>
              <ViewerIcon name='palette' />
              <select
                aria-label={stockLabel}
                onChange={(event) => setStockId(event.target.value)}
                style={{
                  position: 'absolute',
                  inset: 0,
                  width: '100%',
                  height: '100%',
                  opacity: 0,
                  cursor: 'pointer',
                }}
                title={stockLabel}
                value={stockId}
              >
                <option value={LBX_FILE_STOCK_ID}>{fileStockLabel}</option>
                <optgroup label='Brother TZe stock'>
                  {LBX_TAPE_STOCKS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label} · {option.tze}
                    </option>
                  ))}
                </optgroup>
              </select>
            </span>
          ) : null
        }
      >
        <svg
          aria-label={shared.label}
          className='fv-fill'
          data-lbx-stock={stockId}
          preserveAspectRatio='xMidYMid meet'
          role='img'
          viewBox={`${-pad} ${-pad} ${geometry.lengthPt + pad * 2} ${geometry.tapeWidthPt + pad * 2}`}
        >
          <defs>
            {/*
             * The ink-coverage bitmap as a luminance mask: white = fire a dot,
             * black = bare tape. Every object composites into it with the blend
             * its raster op implies, so overlap is resolved per pixel by the
             * rasteriser. `isolation` seals the blending inside the mask.
             */}
            <mask
              height={geometry.tapeWidthPt + pad * 2}
              id={maskId}
              maskUnits='userSpaceOnUse'
              width={geometry.lengthPt + pad * 2}
              x={-pad}
              y={-pad}
            >
              <g data-lbx-coverage='true' style={{ isolation: 'isolate' }}>
                <rect
                  fill={LBX_NO_COVERAGE}
                  height={geometry.tapeWidthPt + pad * 2}
                  width={geometry.lengthPt + pad * 2}
                  x={-pad}
                  y={-pad}
                />
                {label.objects.map((obj, i) =>
                  renderObject(obj, `obj-${i}`, paints[i] ?? { fill: null, mark: 'set' }, fonts),
                )}
              </g>
            </mask>
          </defs>
          {/* Bare stock, plus the viewer's own (non-printing) edge. */}
          <rect
            data-lbx-tape='true'
            fill={tape}
            height={geometry.tapeWidthPt}
            rx={2}
            stroke='#9ca3af'
            strokeWidth={0.5}
            width={geometry.lengthPt}
            x={0}
            y={0}
          />
          {/* Every printed dot on the label, in one pass. */}
          <rect
            data-lbx-ink='true'
            fill={ink}
            height={geometry.tapeWidthPt + pad * 2}
            mask={`url(#${maskId})`}
            width={geometry.lengthPt + pad * 2}
            x={-pad}
            y={-pad}
          />
        </svg>
      </PanZoom>
    </ViewerRoot>
  );
}

/** Falls back to the raw hex for anything besides plain black and white. */
function colorName(hex: string): string {
  if (hex === '#000000' || hex === '#000') return 'Black';
  if (hex === '#ffffff' || hex === '#fff') return 'White';
  return hex;
}

function renderTextObject(
  obj: LbxTextObject,
  key: string,
  op: LbxPaintOp,
  fonts: LbxFonts,
): ReactNode {
  const { angle = 0 } = obj.position;
  const size = obj.font.size > 0 ? obj.font.size : 12;
  const lines = textLines(obj);
  const { cx, cy, textX, anchor, baselines, textLength } = resolveLbxTextBaselines(
    obj,
    resolveLbxFontMetrics(obj.font.name, fonts),
  );

  return (
    // The whole run is ONE layer applying this object's own raster op to the
    // coverage bitmap, resolved per pixel by the rasteriser. No stock colour
    // is decided here — overlap is settled by the mask.
    <g
      data-lbx-blend={op}
      data-lbx-object='text'
      key={key}
      style={{ mixBlendMode: LBX_BLEND_MODE[op] }}
      transform={angle ? `rotate(${angle} ${cx} ${cy})` : undefined}
    >
      {lines.map((line, i) => (
        <text
          fill={LBX_OP_COVERAGE[op]}
          fontFamily={resolveLbxFontStack(obj.font.name, fonts)}
          fontSize={size}
          fontStyle={obj.font.italic ? 'italic' : undefined}
          fontWeight={(obj.font.weight ?? 400) >= 600 ? 'bold' : undefined}
          key={i}
          // JUSTIFY: distribute the line across the frame,
          // stretching the glyphs with it — the measurement that settles
          // `spacingAndGlyphs` over the default `spacing` is in
          // `resolveLbxTextBaselines`'s comment. Skipped for an empty line,
          // where `textLength` has nothing to stretch.
          lengthAdjust={textLength != null && line.length > 0 ? 'spacingAndGlyphs' : undefined}
          textAnchor={anchor}
          textDecoration={obj.textStyle?.underline ? 'underline' : undefined}
          textLength={textLength != null && line.length > 0 ? textLength : undefined}
          x={textX}
          y={baselines[i]}
        >
          {line}
        </text>
      ))}
    </g>
  );
}

function renderPlaceholder(obj: LbxObject, key: string, labelText: string): ReactNode {
  const { x, y, width, height } = obj.position;
  const captionSize = Math.min(6, Math.max(3.5, height * 0.3));
  return (
    // Viewer furniture, not a printed mark: always `set`, so it stays visible
    // whatever it lands on.
    <g
      data-lbx-blend='set'
      data-lbx-object={`placeholder-${obj.type}`}
      key={key}
      style={{ mixBlendMode: LBX_BLEND_MODE.set }}
    >
      <rect
        fill='none'
        height={Math.max(height, 1)}
        stroke={LBX_COVERAGE}
        strokeDasharray='2 2'
        strokeWidth={0.5}
        width={Math.max(width, 1)}
        x={x}
        y={y}
      />
      <text
        fill={LBX_COVERAGE}
        fontFamily={LBX_CONDENSED_STACK}
        fontSize={captionSize}
        textAnchor='middle'
        x={x + width / 2}
        y={y + height / 2 + captionSize * 0.35}
      >
        {labelText}
      </text>
    </g>
  );
}

/**
 * Emit one parsed object into the ink-coverage mask. The ONLY per-object
 * decision is its raster op, which picks both the coverage value it paints
 * (`LBX_OP_COVERAGE`) and the blend mode that composites it
 * (`LBX_BLEND_MODE`) — see the model block above. No stock colour is ever
 * decided here. Each object yields exactly one `[data-lbx-object]` group so
 * DOM order stays 1:1 with paint order.
 */
function renderObject(
  obj: LbxObject,
  key: string,
  paint: LbxObjectPaint,
  fonts: LbxFonts,
): ReactNode {
  switch (obj.type) {
    case 'text':
      return renderTextObject(obj, key, paint.mark, fonts);
    case 'rect': {
      const { x, y, width, height } = obj.position;
      // `shape` decides, and `shape="RECTANGLE"` means SQUARE whatever the
      // roundness says: P-touch stores an inert default of a quarter of the
      // short side on every rect, and a printed label with those values
      // measures hard right angles. When a rect IS rounded, roundnessX/Y are GDI
      // `RoundRect` ellipse DIAMETERS, so SVG's radii are half. That half follows
      // the documented Win32 convention; no reference label exercises it.
      const roundnessX = obj.roundnessX ?? 0;
      const roundnessY = obj.roundnessY ?? 0;
      const rounded = obj.shape !== 'RECTANGLE' && (roundnessX > 0 || roundnessY > 0);
      const rx = rounded ? (roundnessX || roundnessY) / 2 : undefined;
      const ry = rounded ? (roundnessY || roundnessX) / 2 : undefined;
      // `parseBrush` already drops `style="NULL"` brushes entirely (returns
      // undefined), so any present brush — SOLID or PATTERN — paints a fill.
      // PATTERN renders as a flat fill (no hatch texture); documented
      // near-fidelity gap, see the file-level doc comment.
      const fillOp = paint.fill;
      // A rect with neither pen nor any brush fill would be invisible — draw
      // the outline anyway so the reader sees what P-touch would print.
      const penned = obj.pen != null;
      const outlined = penned || fillOp == null;
      // A real pen stroke obeys the object's raster op like any other paint;
      // the pen-less "so the reader can see it" outline is viewer chrome
      // and always sets, so it can never come out invisible.
      const outlineOp: LbxPaintOp = penned ? paint.mark : 'set';
      return (
        <g
          data-lbx-object='rect'
          data-lbx-rop={(obj.position.ropMode ?? 'COPYPEN').trim().toUpperCase()}
          key={key}
        >
          {fillOp ? (
            <rect
              data-lbx-blend={fillOp}
              data-lbx-part='fill'
              fill={LBX_OP_COVERAGE[fillOp]}
              height={height}
              rx={rx}
              ry={ry}
              style={{ mixBlendMode: LBX_BLEND_MODE[fillOp] }}
              width={width}
              x={x}
              y={y}
            />
          ) : null}
          {outlined ? (
            <rect
              data-lbx-blend={outlineOp}
              data-lbx-part='outline'
              fill='none'
              height={height}
              rx={rx}
              ry={ry}
              stroke={LBX_OP_COVERAGE[outlineOp]}
              strokeWidth={Math.max(obj.pen?.widthX ?? 1, 0.4)}
              style={{ mixBlendMode: LBX_BLEND_MODE[outlineOp] }}
              width={width}
              x={x}
              y={y}
            />
          ) : null}
        </g>
      );
    }
    case 'line': {
      const points = obj.points.map((p) => `${p.x},${p.y}`).join(' ');
      if (!points) return null;
      return (
        <g data-lbx-blend={paint.mark} data-lbx-object='line' key={key}>
          <polyline
            fill='none'
            points={points}
            stroke={LBX_OP_COVERAGE[paint.mark]}
            strokeWidth={Math.max(obj.pen?.widthX ?? 1, 0.4)}
            style={{ mixBlendMode: LBX_BLEND_MODE[paint.mark] }}
          />
        </g>
      );
    }
    case 'barcode':
      return renderPlaceholder(obj, key, `Barcode · ${obj.protocol}`);
    case 'image':
      return renderPlaceholder(
        obj,
        key,
        `Image${obj.originalName ? ` · ${obj.originalName}` : ''}`,
      );
    default:
      return renderPlaceholder(obj as LbxObject, key, 'Unsupported object');
  }
}
