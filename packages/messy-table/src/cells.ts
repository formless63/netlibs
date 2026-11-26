/**
 * Read single cells from people's spreadsheets. Every reader takes a raw cell
 * (text, number or Date) and returns a value, `null` for "nothing here", or a
 * problem. Nothing is guessed: text that is not plainly a value is a problem,
 * so "Item 5" is not 5 and "1,5" is not 15.
 */
export interface CellResult<T> {
  value: T | null;
  /** Set when the cell holds something this reader does not understand. */
  problem?: string;
}

export type CellReader<T> = (cell: unknown) => CellResult<T>;

const EMPTY = /^(?:|-+|–|—|n\/?a|none|null|tbd|#n\/a)$/i;

/** Trimmed text with inner whitespace collapsed; null when blank. */
export function cellText(cell: unknown): string | null {
  if (cell === null || cell === undefined) return null;
  if (cell instanceof Date) return Number.isNaN(cell.getTime()) ? null : cell.toISOString();
  const text = String(cell)
    .replace(/[\s\u00a0\ufeff]+/g, ' ')
    .trim();
  return text === '' ? null : text;
}

export const text: CellReader<string> = (cell) => ({ value: cellText(cell) });

export interface DecimalOptions {
  /** `,` for "1.234,56". Default `.`. */
  decimalSeparator?: '.' | ',' | undefined;
  /** Extra currency or unit text to accept around the number, e.g. `['kg']`. */
  affixes?: readonly string[] | undefined;
}

const CURRENCY = [
  'US$',
  'C$',
  'A$',
  'R$',
  '$',
  '€',
  '£',
  '¥',
  '₹',
  'USD',
  'CAD',
  'AUD',
  'EUR',
  'GBP',
  'JPY',
  'CNY',
  'RMB',
  'CHF',
  'INR',
  'BRL',
  'MXN',
];

/**
 * An exact decimal as text ("$1,234.50" → "1234.50"), never through a float, so
 * money survives. Accepts currency, grouping, "(5.00)", "5.00-" and "−5".
 */
export function decimal(options: DecimalOptions = {}): CellReader<string> {
  const point = options.decimalSeparator ?? '.';
  const group = point === '.' ? ',' : '.';
  const affixes = [...CURRENCY, ...(options.affixes ?? [])]
    .sort((a, b) => b.length - a.length)
    .map(escape)
    .join('|');
  const affix = new RegExp(`^(?:${affixes})|(?:${affixes})$`, 'i');
  const shape = new RegExp(
    `^(?:\\d{1,3}(?:[${escape(group)} '’]\\d{3})+|\\d+)?(?:${escape(point)}\\d*)?$`,
  );
  return (cell) => {
    if (typeof cell === 'number') {
      if (!Number.isFinite(cell)) return { value: null, problem: 'is not a finite number' };
      return { value: plain(cell) };
    }
    const raw = cellText(cell);
    if (raw === null || EMPTY.test(raw)) return { value: null };
    let body = raw.replace(/[−–]/g, '-');
    let negative = false;
    const bracketed = /^\((.*)\)$/.exec(body);
    if (bracketed) {
      negative = true;
      body = bracketed[1]!.trim();
    }
    for (let pass = 0; pass < 4; pass++) {
      const before = body;
      if (body.startsWith('-') || body.endsWith('-')) {
        // Two signs are a typo, not a double negative.
        if (negative) return { value: null, problem: `"${raw}" is not a number` };
        negative = true;
        body = body.replace(/^-|-$/, '').trim();
      }
      body = body.replace(/^\+/, '').replace(affix, '').trim();
      if (body === before) break;
    }
    if (!/\d/.test(body) || !shape.test(body)) {
      return { value: null, problem: `"${raw}" is not a number` };
    }
    const [whole = '', fraction] = body.split(point);
    const digits = whole.replace(/\D/g, '').replace(/^0+(?=\d)/, '') || '0';
    const value = fraction ? `${digits}.${fraction}` : digits;
    return { value: negative && /[1-9]/.test(value) ? `-${value}` : value };
  };
}

export const integer: CellReader<number> = (cell) => {
  const read = decimal()(cell);
  if (read.value === null) return { ...read, value: null };
  const value = Number(read.value);
  return Number.isSafeInteger(value)
    ? { value }
    : { value: null, problem: `"${cellText(cell)}" is not a whole number` };
};

/** For quantities and weights. Use `decimal` for money. */
export const number: CellReader<number> = (cell) => {
  const read = decimal()(cell);
  return read.value === null ? { ...read, value: null } : { value: Number(read.value) };
};

export interface DateOptions {
  /** How to read 3/4/2026. Required for such dates; without it they are a problem. */
  order?: 'mdy' | 'dmy' | undefined;
  /** Workbooks saved by old Excel for Mac count days from 1904. */
  excel1904?: boolean | undefined;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * A calendar date as `YYYY-MM-DD`, with no time zone: the date written in the
 * cell. Accepts ISO-like dates, "5 Mar 2026", "Mar-05-2026", Excel serial
 * numbers, Dates (by their local calendar fields), and slashed dates once
 * `order` says how to read them. A time after the date is ignored.
 */
export function date(options: DateOptions = {}): CellReader<string> {
  return (cell) => {
    if (cell instanceof Date) {
      if (Number.isNaN(cell.getTime())) return { value: null, problem: 'is an invalid date' };
      return checked(cell.getFullYear(), cell.getMonth() + 1, cell.getDate(), String(cell));
    }
    if (typeof cell === 'number') {
      const value = excelDate(cell, options.excel1904 ?? false);
      return value === null ? { value: null, problem: `${cell} is not a date` } : { value };
    }
    const raw = cellText(cell);
    if (raw === null || EMPTY.test(raw)) return { value: null };
    const body = raw.replace(/(?:[T ]|, )\d{1,2}:\d{2}.*$/, '');

    let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(body);
    if (match) return checked(+match[1]!, +match[2]!, +match[3]!, raw);
    match = /^(\d{1,2})[ -]([a-z]{3})[a-z]*\.?,?[ -](\d{4})$/i.exec(body);
    if (match) return checked(+match[3]!, month(match[2]!), +match[1]!, raw);
    match = /^([a-z]{3})[a-z]*\.?[ -](\d{1,2}),?[ -](\d{4})$/i.exec(body);
    if (match) return checked(+match[3]!, month(match[1]!), +match[2]!, raw);
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(body);
    if (match) {
      if (!options.order) {
        return { value: null, problem: `"${raw}" could be month first or day first` };
      }
      const [first, second] = [+match[1]!, +match[2]!];
      const year = match[3]!.length === 2 ? 2000 + +match[3]! : +match[3]!;
      return options.order === 'mdy'
        ? checked(year, first, second, raw)
        : checked(year, second, first, raw);
    }
    return { value: null, problem: `"${raw}" is not a date` };
  };
}

function month(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

function checked(y: number, m: number, d: number, raw: string): CellResult<string> {
  const utc = new Date(Date.UTC(y, m - 1, d));
  if (utc.getUTCFullYear() !== y || utc.getUTCMonth() !== m - 1 || utc.getUTCDate() !== d) {
    return { value: null, problem: `"${raw}" is not a real date` };
  }
  return { value: utc.toISOString().slice(0, 10) };
}

/** Excel's calendar contains a 29 February 1900, so early serials shift by a day. */
function excelDate(serial: number, from1904: boolean): string | null {
  const day = Math.floor(serial);
  // 1..2958465 is 1900-01-01..9999-12-31; 60 is the day that never was.
  if (!Number.isFinite(day) || day < 1 || day > 2_958_465) return null;
  if (!from1904 && day === 60) return null;
  const epoch = from1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, day < 60 ? 31 : 30);
  return new Date(epoch + day * 86_400_000).toISOString().slice(0, 10);
}

/** Shortest decimal text for a float, without an exponent. */
function plain(value: number): string {
  const short = String(value);
  if (!/e/i.test(short)) return Object.is(value, -0) ? '0' : short;
  const [mantissa = '', exponent = '0'] = short.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const [whole = '', fraction = ''] = mantissa.replace('-', '').split('.');
  const shift = Number(exponent);
  const digits = whole + fraction;
  const at = whole.length + shift;
  const out =
    at <= 0
      ? `0.${'0'.repeat(-at)}${digits}`
      : at >= digits.length
        ? digits.padEnd(at, '0')
        : `${digits.slice(0, at)}.${digits.slice(at)}`;
  return negative ? `-${out}` : out;
}

function escape(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
