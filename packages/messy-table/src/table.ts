import { cellText, text, type CellReader } from './cells.ts';

/** Rows of raw cells, as CSV and spreadsheet parsers return them. */
export type Grid = readonly (readonly unknown[])[];

export interface Column<T> {
  /**
   * Header texts (compared case-insensitively, spaces collapsed) or patterns
   * (tested against that normalised text).
   */
  header: string | RegExp | readonly (string | RegExp)[];
  /** The table is only recognised when this column is present. */
  required?: boolean | undefined;
  /** How to read its cells. */
  read: CellReader<T>;
}

// oxlint-disable-next-line typescript/no-explicit-any
export type Columns = Readonly<Record<string, Column<any>>>;
export type RowOf<C extends Columns> = {
  [K in keyof C]: C[K] extends Column<infer T> ? T | null : never;
};

/** Declare a column. `read` defaults to text. */
export function column(
  header: Column<string>['header'],
  options?: { required?: boolean },
): Column<string>;
export function column<T>(
  header: Column<T>['header'],
  options: { required?: boolean; read: CellReader<T> },
): Column<T>;
export function column(
  header: Column<unknown>['header'],
  options: { required?: boolean; read?: CellReader<unknown> } = {},
): Column<unknown> {
  return { header, required: options.required, read: options.read ?? text };
}

export interface HeaderMatch {
  /** 0-based row. */
  row: number;
  /** Column key to 0-based position. */
  positions: Map<string, number>;
}

export interface FindHeaderOptions {
  /** How far down to look. Default 50. */
  scanRows?: number | undefined;
  /** Matches needed when no column is required. Default 2, or every column if fewer. */
  minColumns?: number | undefined;
}

/**
 * Find the header row: the one naming most of the wanted columns, earliest on a
 * tie, among those naming every required one. Reports often open with titles,
 * notes or blank rows, and those change; header text rarely does.
 */
export function findHeader(
  grid: Grid,
  columns: Columns,
  options: FindHeaderOptions = {},
): HeaderMatch | null {
  const keys = Object.keys(columns);
  const required = keys.filter((key) => columns[key]!.required);
  const least =
    options.minColumns ?? (required.length > 0 ? required.length : Math.min(2, keys.length));
  let best: HeaderMatch | null = null;
  for (let row = 0; row < Math.min(grid.length, options.scanRows ?? 50); row++) {
    const positions = matchHeader(grid[row]!, columns);
    if (positions.size < Math.max(1, least)) continue;
    if (!required.every((key) => positions.has(key))) continue;
    if (!best || positions.size > best.positions.size) best = { row, positions };
  }
  return best;
}

/**
 * Which of several layouts a grid is, e.g. which report somebody uploaded. The
 * layout with most of its columns present wins; a tie is no answer.
 */
export function detectLayout<K extends string>(
  grid: Grid,
  layouts: Readonly<Record<K, Columns>>,
  options?: FindHeaderOptions,
): K | null {
  let best: { key: K; score: number } | null = null;
  let tied = false;
  for (const key of Object.keys(layouts) as K[]) {
    const match = findHeader(grid, layouts[key], options);
    if (!match) continue;
    const score = match.positions.size / Object.keys(layouts[key]).length;
    if (best && score === best.score) tied = true;
    if (!best || score > best.score) {
      best = { key, score };
      tied = false;
    }
  }
  return tied ? null : (best?.key ?? null);
}

/**
 * Headers are read left to right; each goes to the first declared column that
 * matches it and is still unplaced. So declare specific patterns
 * ("previous price") before general ones ("price").
 */
function matchHeader(cells: readonly unknown[], columns: Columns): Map<string, number> {
  const positions = new Map<string, number>();
  cells.forEach((cell, index) => {
    const header = normalizeHeader(cell);
    if (header === '') return;
    for (const key of Object.keys(columns)) {
      if (positions.has(key)) continue;
      const wanted = columns[key]!.header;
      const list = Array.isArray(wanted) ? wanted : [wanted as string | RegExp];
      if (list.some((item) => matches(item, header))) {
        positions.set(key, index);
        return;
      }
    }
  });
  return positions;
}

function matches(wanted: string | RegExp, header: string): boolean {
  if (typeof wanted === 'string') return normalizeHeader(wanted) === header;
  // A global or sticky pattern would otherwise carry state between cells.
  wanted.lastIndex = 0;
  return wanted.test(header);
}

export function normalizeHeader(cell: unknown): string {
  return (cellText(cell) ?? '').toLowerCase();
}

export interface TableRow<R> {
  /** 1-based, as a spreadsheet numbers it. */
  rowNumber: number;
  /** The section heading above it, when `sections` is on. */
  section: string | null;
  values: R;
  cells: readonly unknown[];
}

export interface TableProblem {
  rowNumber: number;
  column: string;
  message: string;
}

export interface Table<C extends Columns> {
  headerRow: number;
  /** Declared columns the header row does not have. */
  missing: (keyof C & string)[];
  /** Headers no declared column matched. */
  unknown: string[];
  /** Everything above the header, for metadata. */
  preamble: Grid;
  rows: TableRow<RowOf<C>>[];
  problems: TableProblem[];
}

export interface ReadTableOptions extends FindHeaderOptions {
  /** Use this 0-based row instead of searching. */
  headerRow?: number | undefined;
  /** Stop at this row: totals, "12 records downloaded". */
  stopAt?: ((cells: readonly unknown[], rowNumber: number) => boolean) | undefined;
  /** Ignore this row. Blank rows are always ignored. */
  skip?: ((cells: readonly unknown[], rowNumber: number) => boolean) | undefined;
  /** Treat a row with a single filled cell as a heading for the rows below. */
  sections?: boolean | undefined;
}

/**
 * Read a grid as typed rows. Returns null when no header row is found. A cell
 * that cannot be read becomes null in the row and an entry in `problems`.
 */
export function readTable<const C extends Columns>(
  grid: Grid,
  columns: C,
  options: ReadTableOptions = {},
): Table<C> | null {
  const header: HeaderMatch | null =
    options.headerRow === undefined
      ? findHeader(grid, columns, options)
      : grid[options.headerRow]
        ? { row: options.headerRow, positions: matchHeader(grid[options.headerRow]!, columns) }
        : null;
  if (!header) return null;

  const rows: TableRow<RowOf<C>>[] = [];
  const problems: TableProblem[] = [];
  let section: string | null = null;
  for (let at = header.row + 1; at < grid.length; at++) {
    const cells = grid[at]!;
    const rowNumber = at + 1;
    const filled = cells.map(cellText).filter((value) => value !== null);
    if (filled.length === 0) continue;
    if (options.stopAt?.(cells, rowNumber)) break;
    if (options.skip?.(cells, rowNumber)) continue;
    if (options.sections && filled.length === 1) {
      section = filled[0]!;
      continue;
    }
    const values: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(columns)) {
      const position = header.positions.get(key);
      if (position === undefined) {
        values[key] = null;
        continue;
      }
      const read = spec.read(cells[position]);
      values[key] = read.value;
      if (read.problem !== undefined)
        problems.push({ rowNumber, column: key, message: read.problem });
    }
    rows.push({ rowNumber, section, values: values as RowOf<C>, cells });
  }

  const used = new Set(header.positions.values());
  return {
    headerRow: header.row,
    missing: Object.keys(columns).filter((key) => !header.positions.has(key)),
    unknown: grid[header.row]!.flatMap((cell, index) => {
      const value = cellText(cell);
      return value !== null && !used.has(index) ? [value] : [];
    }),
    preamble: grid.slice(0, header.row),
    rows,
    problems,
  };
}
