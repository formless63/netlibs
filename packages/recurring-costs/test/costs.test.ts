import { describe, expect, it } from 'bun:test';

import {
  addMonths,
  BILLING_CYCLES,
  cycleMonths,
  dayNumber,
  formatScaled,
  fromDayNumber,
  isoDateIn,
  MONEY_SCALE,
  normalizeCost,
  parseMoney,
  projectRenewal,
  renewalsWithin,
  totalCosts
} from '../src/index.ts';

describe('money', () => {
  it('parses prices exactly and rejects malformed ones', () => {
    expect(parseMoney('34.82')).toBe(3_482_000n);
    expect(parseMoney('39.8')).toBe(3_980_000n);
    expect(parseMoney(' 7 ')).toBe(7n * MONEY_SCALE);
    expect(parseMoney('0')).toBe(0n);
    for (const bad of ['-1', '1.234', '1e3', '1,000.00', '+1', '.5', '1.', '', '12345678901']) expect(parseMoney(bad), bad).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });

  it('formats half away from zero', () => {
    expect(formatScaled(1_450_833n)).toBe('14.51');
    expect(formatScaled(1_450_499n)).toBe('14.50');
    expect(formatScaled(500n)).toBe('0.01');
    expect(formatScaled(-500n)).toBe('-0.01');
    expect(formatScaled(0n)).toBe('0.00');
  });

  it('normalizes each cycle to monthly and yearly without float drift', () => {
    const biennial = normalizeCost('34.82', 'biennial')!;
    expect([formatScaled(biennial.monthly), formatScaled(biennial.yearly)]).toEqual(['1.45', '17.41']);
    const annual = normalizeCost('62.49', 'annual')!;
    expect([formatScaled(annual.monthly), formatScaled(annual.yearly)]).toEqual(['5.21', '62.49']);
    expect(formatScaled(normalizeCost('10.00', 'quarterly')!.yearly)).toBe('40.00');
    expect(formatScaled(normalizeCost('0.10', 'monthly')!.yearly)).toBe('1.20');
    expect(normalizeCost('0', 'free')).toEqual({ monthly: 0n, yearly: 0n });
    expect(normalizeCost(null, 'free')).toEqual({ monthly: 0n, yearly: 0n });
    expect(normalizeCost(null, 'annual')).toBeNull();
    expect(normalizeCost('5.00', 'unknown')).toBeNull();
    expect(BILLING_CYCLES.map(cycleMonths)).toEqual([1, 3, 6, 12, 24, 36, null, null]);
  });

  it('totals per currency, never across, and counts unknown costs', () => {
    const totals = totalCosts([
      { price: '34.82', currency: 'USD', billingCycle: 'biennial' },
      { price: '39.88', currency: 'USD', billingCycle: 'annual' },
      { price: '39.88', currency: 'USD', billingCycle: 'annual' },
      { price: '59.99', currency: 'USD', billingCycle: 'annual' },
      { price: '62.49', currency: 'USD', billingCycle: 'annual' },
      { price: '62.49', currency: 'USD', billingCycle: 'annual' },
      { price: null, currency: 'USD', billingCycle: 'unknown' },
      { price: '5.00', currency: 'EUR', billingCycle: 'monthly' }
    ]);
    expect(totals).toEqual([
      { currency: 'USD', monthly: '23.51', yearly: '282.14', counted: 6, unknown: 1 },
      { currency: 'EUR', monthly: '5.00', yearly: '60.00', counted: 1, unknown: 0 }
    ]);
    expect(totalCosts([{ price: '1', currency: 'GBP', billingCycle: 'annual' }, { price: '1', currency: 'CHF', billingCycle: 'annual' }]).map((t) => t.currency)).toEqual(['CHF', 'GBP']);
    expect(totalCosts([])).toEqual([]);
  });
});

describe('calendar dates', () => {
  it('validates dates, including leap days and years below 100', () => {
    expect(dayNumber('1970-01-02')).toBe(1);
    expect(dayNumber('2028-02-29')).not.toBeNull();
    for (const bad of ['2027-02-29', '2027-13-01', '2027-1-01', 'today']) expect(dayNumber(bad), bad).toBeNull();
    expect(fromDayNumber(dayNumber('0050-03-01')!)).toBe('0050-03-01');
  });

  it('adds calendar months, clamping to the month end', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2027-11-15', 3)).toBe('2028-02-15');
    expect(addMonths('2027-03-31', -1)).toBe('2027-02-28');
    expect(addMonths('0050-01-31', 1)).toBe('0050-02-28');
    expect(() => addMonths('soon', 1)).toThrow(RangeError);
    expect(() => addMonths('2027-01-01', 0.5)).toThrow(RangeError);
  });

  it('projects a passed renewal forward by whole cycles and says so', () => {
    expect(projectRenewal('2027-01-16', 'annual', '2026-11-03')).toEqual({ date: '2027-01-16', daysUntil: 74, projected: false, stored: '2027-01-16' });
    expect(projectRenewal('2025-01-16', 'annual', '2026-11-03')).toMatchObject({ date: '2027-01-16', projected: true });
    expect(projectRenewal('2026-11-03', 'monthly', '2026-11-03')).toMatchObject({ daysUntil: 0, projected: false });
    expect(projectRenewal('2026-10-01', 'unknown', '2026-11-03')).toMatchObject({ daysUntil: -33, projected: false });
    expect(projectRenewal(null, 'annual', '2026-11-03')).toBeNull();
    expect(projectRenewal('2026-02-30', 'annual', '2026-11-03')).toBeNull();
  });

  it('rolls forward from the stored date, so a clamped month does not drift', () => {
    expect(projectRenewal('2026-01-31', 'monthly', '2026-03-01')).toMatchObject({ date: '2026-03-31' });
    expect(renewalsWithin('2026-01-31', 'monthly', '2026-02-10', 80)).toEqual(['2026-02-28', '2026-03-31', '2026-04-30']);
  });

  it('projects across centuries without a step limit', () => {
    expect(projectRenewal('1700-06-15', 'monthly', '2026-11-03')).toMatchObject({ date: '2026-11-15', daysUntil: 12, projected: true });
  });

  it('lists renewals inside a horizon', () => {
    expect(renewalsWithin('2026-12-01', 'monthly', '2026-11-03', 90)).toEqual(['2026-12-01', '2027-01-01', '2027-02-01']);
    expect(renewalsWithin('2027-05-22', 'biennial', '2026-11-03', 365)).toEqual(['2027-05-22']);
    expect(renewalsWithin('2026-12-01', 'unknown', '2026-11-03', 365)).toEqual(['2026-12-01']);
    expect(renewalsWithin('2026-10-01', 'unknown', '2026-11-03', 365)).toEqual([]);
    expect(renewalsWithin('2027-12-01', 'monthly', '2026-11-03', 30)).toEqual([]);
    expect(renewalsWithin('2026-11-03', 'monthly', '2026-11-03', 0)).toEqual(['2026-11-03']);
    expect(() => renewalsWithin('2026-11-03', 'monthly', '2026-11-03', Infinity)).toThrow(RangeError);
  });

  it('reads today in a time zone', () => {
    const instant = new Date('2026-11-03T02:00:00Z');
    expect(isoDateIn(instant, 'UTC')).toBe('2026-11-03');
    expect(isoDateIn(instant, 'America/Los_Angeles')).toBe('2026-11-02');
    expect(() => isoDateIn(instant, 'Not/AZone')).toThrow(RangeError);
  });
});
