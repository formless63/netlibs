import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { cellText, date, decimal, integer, number } from '../src/index.ts';

const dec = decimal();
describe('decimal', () => {
  it.each([
    ['$1,234.50', '1234.50'],
    ['USD 12.00', '12.00'],
    ['12.00 usd', '12.00'],
    ['US$5', '5'],
    ['€ 7.5', '7.5'],
    ['(5.00)', '-5.00'],
    ['($5.00)', '-5.00'],
    ['-5', '-5'],
    ['5.00-', '-5.00'],
    ['−5', '-5'],
    ['-$5', '-5'],
    ['$-5', '-5'],
    ['1 234 567.8', '1234567.8'],
    ['1’234.5', '1234.5'],
    ['1,234,567', '1234567'],
    ['.5', '0.5'],
    ['5.', '5'],
    ['007', '7'],
    ['+3', '3'],
    ['-0.00', '0.00'],
    ['12345678901234567890.123456789', '12345678901234567890.123456789'],
  ])('%s -> %s', (input, value) => expect(dec(input)).toEqual({ value }));

  it.each(['', '  ', '-', '--', 'n/a', 'N/A', 'TBD', 'None', '#N/A', null, undefined])(
    '%j is empty, not a problem',
    (input) => expect(dec(input)).toEqual({ value: null }),
  );

  it.each([
    'Item 5',
    '12abc',
    '1,5',
    '1,2345',
    '12,34.5',
    '1.2.3',
    '3-4',
    '5 6',
    '--5',
    '(-5)',
    '$',
    '1e5',
    '٣',
  ])('%s is a problem, not a guess', (input) => {
    const read = dec(input);
    expect(read.value).toBeNull();
    expect(read.problem).toContain(input);
  });

  it('reads comma decimals when asked', () => {
    const eu = decimal({ decimalSeparator: ',' });
    expect(eu('1.234,56 €').value).toBe('1234.56');
    expect(eu('1 234,5').value).toBe('1234.5');
    expect(eu('1,234.56').problem).toBeDefined();
  });

  it('accepts named units only', () => {
    expect(decimal({ affixes: ['kg'] })('0.25 kg').value).toBe('0.25');
    expect(dec('0.25 kg').problem).toBeDefined();
  });

  it('writes numbers out without exponents', () => {
    expect([1e21, 1.5e-7, 12, -0, 0.1, -2.5e22, 123e-20].map((n) => dec(n).value)).toEqual([
      '1000000000000000000000',
      '0.00000015',
      '12',
      '0',
      '0.1',
      '-25000000000000000000000',
      '0.00000000000000000123',
    ]);
    expect(dec(Number.NaN).problem).toBeDefined();
    fc.assert(
      fc.property(
        fc.double({ noNaN: true, noDefaultInfinity: true }),
        (n) => Number(dec(n).value) === n || Object.is(n, -0),
      ),
    );
  });

  it('round-trips any amount it formats', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10 ** 12 }),
        fc.integer({ min: 0, max: 99 }),
        fc.boolean(),
        (whole, cents, negative) => {
          const exact = `${whole}.${String(cents).padStart(2, '0')}`;
          const shown = `$${whole.toLocaleString('en-US')}.${String(cents).padStart(2, '0')}`;
          const expected = negative && /[1-9]/.test(exact) ? `-${exact}` : exact;
          expect(dec(negative ? `(${shown})` : shown).value).toBe(expected);
        },
      ),
    );
  });
});

describe('integer and number', () => {
  it('reads whole numbers and refuses others', () => {
    expect(integer('1,200').value).toBe(1200);
    expect(integer('2.0').value).toBe(2);
    expect(integer('2.5').problem).toContain('whole');
    expect(integer('99999999999999999999').problem).toBeDefined();
    expect(number('0.25').value).toBe(0.25);
    expect(number('x').problem).toBeDefined();
  });
});

describe('date', () => {
  const us = date({ order: 'mdy' });
  it.each([
    ['2026-07-05', '2026-07-05'],
    ['2026/7/5', '2026-07-05'],
    ['2026.07.05', '2026-07-05'],
    ['2026-07-01T10:00:00Z', '2026-07-01'],
    ['2026-07-01 23:59', '2026-07-01'],
    ['5 Mar 2026', '2026-03-05'],
    ['Mar-05-2026', '2026-03-05'],
    ['March 5, 2026', '2026-03-05'],
    ['Jul-23-2026, 10:15 AM', '2026-07-23'],
    ['3/4/2026', '2026-03-04'],
    ['3/4/26', '2026-03-04'],
    ['12/31/1999', '1999-12-31'],
  ])('%s -> %s', (input, value) => expect(us(input)).toEqual({ value }));

  it('will not guess between month first and day first', () => {
    expect(date()('3/4/2026').problem).toContain('month first');
    expect(date({ order: 'dmy' })('3/4/2026').value).toBe('2026-04-03');
  });

  it.each(['2026-02-30', '13/1/2026', 'Foo 5, 2026', 'soon', '2026-7'])(
    '%s is a problem',
    (input) => expect(us(input).problem).toBeDefined(),
  );

  it('reads Excel serials in both calendars, around the day that never was', () => {
    expect([1, 59, 61, 45292, 45292.75, 47788].map((n) => us(n).value)).toEqual([
      '1900-01-01',
      '1900-02-28',
      '1900-03-01',
      '2024-01-01',
      '2024-01-01',
      '2030-11-01',
    ]);
    expect(us(60).problem).toBeDefined();
    expect(us(0).problem).toBeDefined();
    expect(us(2_958_466).problem).toBeDefined();
    expect(date({ excel1904: true })(1).value).toBe('1904-01-02');
  });

  it('reads Date objects by their local calendar day', () => {
    expect(us(new Date(2026, 6, 5, 23, 30)).value).toBe('2026-07-05');
    expect(us(new Date(Number.NaN)).problem).toBeDefined();
  });

  it('round-trips every day it can write', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('1900-03-01'), max: new Date('2100-01-01'), noInvalidDate: true }),
        (d) => {
          const iso = d.toISOString().slice(0, 10);
          expect(us(iso).value).toBe(iso);
          const serial = Math.round((Date.parse(iso) - Date.UTC(1899, 11, 30)) / 86_400_000);
          expect(us(serial).value).toBe(iso);
        },
      ),
    );
  });
});

it('cellText collapses whitespace and treats blank as nothing', () => {
  expect(cellText('  a\n  b ')).toBe('a b');
  expect([cellText(''), cellText(' '), cellText(null), cellText(undefined)]).toEqual([
    null,
    null,
    null,
    null,
  ]);
  expect(cellText(0)).toBe('0');
});
