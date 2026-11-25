import Papa from 'papaparse';
import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  column,
  date,
  decimal,
  detectLayout,
  findHeader,
  integer,
  readTable,
  type Grid,
} from '../src/index.ts';
import { LISTINGS_CSV, ORDERS_CSV, TRANSACTIONS_CSV } from './reports.ts';

const csv = (text: string): Grid => Papa.parse<string[]>(text).data;

const orders = {
  order: column('Order Number', { required: true }),
  transaction: column('Transaction ID', { required: true }),
  title: column('Item Title'),
  quantity: column('Quantity', { read: integer }),
  total: column('Total Price', { read: decimal() }),
  sold: column('Sale Date', { read: date() }),
};
const transactions = {
  created: column('Transaction creation date', { required: true, read: date() }),
  type: column('Type', { required: true }),
  order: column('Order number'),
  net: column('Net amount', { required: true, read: decimal() }),
};
const listings = {
  item: column('Item number', { required: true }),
  sku: column('Custom label (SKU)', { required: true }),
  price: column('Current price', { read: decimal() }),
};

describe('reports with preambles and footers', () => {
  it('finds the header below a junk row and reads typed rows', () => {
    const table = readTable(csv(ORDERS_CSV), orders)!;
    expect(table.headerRow).toBe(1);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0]!.values).toEqual({
      order: 'ORD-1',
      transaction: 'TXN-1',
      title: 'Blue Widget',
      quantity: 2,
      total: '24.00',
      sold: '2026-07-01',
    });
    expect(table.rows[0]!.rowNumber).toBe(4);
    expect(table.problems).toEqual([]);
    expect(table.unknown).toContain('Buyer Email');
    expectTypeOf(table.rows[0]!.values.quantity).toEqualTypeOf<number | null>();
    expectTypeOf(table.rows[0]!.values.total).toEqualTypeOf<string | null>();
  });

  it('finds the header below an eleven-line preamble', () => {
    const table = readTable(csv(TRANSACTIONS_CSV), transactions)!;
    expect(table.headerRow).toBe(11);
    expect(table.rows.map((r) => r.values.net)).toEqual(['22.90', '-5.00', '50.00']);
    expect(table.preamble).toHaveLength(11);
  });

  it('stops at a footer', () => {
    const grid = csv(`${ORDERS_CSV}\n\n8,record(s) downloaded,\nSeller ID : example`);
    const stopAt = (cells: readonly unknown[]) =>
      cells.some((c) => /records?\(?s?\)?\s+downloaded/i.test(String(c)));
    expect(readTable(grid, orders, { stopAt })!.rows).toHaveLength(3);
    expect(readTable(grid, orders)!.rows).toHaveLength(5);
  });

  it('tells reports apart', () => {
    const layouts = { orders, transactions, listings };
    expect(detectLayout(csv(ORDERS_CSV), layouts)).toBe('orders');
    expect(detectLayout(csv(TRANSACTIONS_CSV), layouts)).toBe('transactions');
    expect(detectLayout(csv(LISTINGS_CSV), layouts)).toBe('listings');
    expect(detectLayout([['totally', 'unrelated']], layouts)).toBeNull();
    expect(
      detectLayout([['a', 'b']], {
        x: { a: column('a'), b: column('b') },
        y: { a: column('A'), b: column('B') },
      }),
    ).toBeNull();
  });
});

describe('a filled-in workbook matched by pattern', () => {
  const quote = {
    partNumber: column(/^(p\/?n|part\s*(no\.?|number|#))$/, { required: true }),
    previousDate: column(/^previous\b.*\bdate\b/, { read: date() }),
    previousPrice: column(/^previous\b/, { read: decimal() }),
    priceB: column(/^\(b\)|^price\s*\(?b\)?(\s|$)/, { read: decimal() }),
    priceA: column(/^\(a\)|^price\s*\(?a\)?(\s|$)/, { read: decimal() }),
    moq: column(/^moq\b/, { read: integer }),
    comment: column(/comment|remark/),
  };
  const grid: Grid = [
    ['Example Co - Price Request (2030-01-02)'],
    ['Please fill in the yellow cells.'],
    ['Supplier reply 2030-01-09   Copper price: RMB 90,500/ton'],
    [
      '#',
      'P/N',
      'Previous quote (USD)',
      'Previous quote date',
      '(a) Current quote (USD)',
      '(b) Current quote using our cable (USD)',
      'Acme comments',
    ],
    ['Group A - material'],
    [1, 'MAT-100', 60, '2029-11-01', 61, 'n/a', 'ok'],
    ['Group B - cables'],
    [2, 'CAB-1-34', '-', null, 3.5, 2.25, null],
    [3, 'CAB-1-36', 4, 47788, '$4.10', 2.6, 'note'],
    [5, 'CAB-2-36', null, null, 'TBD later', null, null],
    [],
    ['Lengths: -34 = 1.2 m.'],
  ];

  it('reads sections, specific columns before general ones, and reports odd cells', () => {
    const table = readTable(grid, quote, { sections: true })!;
    expect(
      table.rows.map((r) => [r.section, r.values.partNumber, r.values.priceA, r.values.priceB]),
    ).toEqual([
      ['Group A - material', 'MAT-100', '61', null],
      ['Group B - cables', 'CAB-1-34', '3.5', '2.25'],
      ['Group B - cables', 'CAB-1-36', '4.10', '2.6'],
      ['Group B - cables', 'CAB-2-36', null, null],
    ]);
    expect(table.rows[2]!.values).toMatchObject({ previousPrice: '4', previousDate: '2030-11-01' });
    expect(table.problems).toEqual([
      { rowNumber: 10, column: 'priceA', message: '"TBD later" is not a number' },
    ]);
    expect(table.missing).toEqual(['moq']);
  });

  it('does not care about column order', () => {
    const table = readTable(
      [
        ['comment', 'price b', 'P/N', 'price a', 'MOQ'],
        ['fine', 1.5, 'X-1', 2.75, 500],
      ],
      quote,
    )!;
    expect(table.rows[0]!.values).toMatchObject({
      partNumber: 'X-1',
      priceA: '2.75',
      priceB: '1.5',
      moq: 500,
      comment: 'fine',
    });
  });

  it('refuses a sheet without the table', () => {
    expect(readTable([['Just some text'], ['Description']], quote)).toBeNull();
  });
});

describe('findHeader', () => {
  it('needs two columns when none is required, unless told otherwise', () => {
    const columns = { a: column('a'), b: column('b') };
    expect(findHeader([['a'], ['a', 'b']], columns)?.row).toBe(1);
    expect(findHeader([['a']], columns)).toBeNull();
    expect(findHeader([['a']], columns, { minColumns: 1 })?.row).toBe(0);
    expect(findHeader([['a']], { a: column('a') })?.row).toBe(0);
  });

  it('prefers the fuller row, then the earlier', () => {
    const columns = { a: column('a'), b: column('b'), c: column('c') };
    expect(
      findHeader(
        [
          ['a', 'b'],
          ['a', 'b', 'c'],
          ['a', 'b', 'c'],
        ],
        columns,
      )?.row,
    ).toBe(1);
  });

  it('stops looking after scanRows', () => {
    const grid = [...Array.from({ length: 60 }, () => ['x']), ['a', 'b']];
    expect(findHeader(grid, { a: column('a'), b: column('b') })).toBeNull();
    expect(findHeader(grid, { a: column('a'), b: column('b') }, { scanRows: 100 })?.row).toBe(60);
  });

  it('takes the first of two identical headers', () => {
    expect(
      findHeader([['Total', 'Qty', 'Total']], {
        t: column('total'),
        q: column('qty'),
      })?.positions.get('t'),
    ).toBe(0);
  });

  it('normalises case, spacing, non-breaking spaces and a byte-order mark', () => {
    expect(findHeader([['﻿Order  Number', 'x']], { o: column('order number') })?.row).toBe(0);
  });

  it('is not upset by global patterns', () => {
    const columns = { a: column(/a/g), b: column(/b/g) };
    for (let i = 0; i < 3; i++) expect(findHeader([['a', 'b']], columns)?.positions.size).toBe(2);
  });

  it('can be told where the header is', () => {
    const table = readTable(
      [
        ['a', 'b'],
        ['a', 'b'],
        ['1', '2'],
      ],
      { a: column('a'), b: column('b') },
      { headerRow: 1 },
    )!;
    expect(table.rows).toHaveLength(1);
    expect(readTable([], { a: column('a') }, { headerRow: 3 })).toBeNull();
  });

  it('has no trouble with keys named like object members', () => {
    const table = readTable(
      [
        ['constructor', 'b'],
        ['1', '2'],
      ],
      { constructor: column('constructor'), b: column('b') } as never,
      {},
    )!;
    expect(table.rows[0]!.values).toMatchObject({ b: '2' });
  });
});
