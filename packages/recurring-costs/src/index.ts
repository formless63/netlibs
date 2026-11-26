/**
 * Recurring-cost arithmetic: a price per billing cycle as monthly and yearly
 * figures, totals per currency, and renewal dates. Pure and browser-safe.
 *
 * Money is exact. A price is parsed into integer hundred-thousandths of a unit
 * (`bigint`) and divided once, never through a JavaScript `number`. Figures
 * are rounded half-up to cents only when formatted, and totals add the
 * unrounded values.
 *
 * Dates are ISO calendar dates (`2027-01-31`) with no time zone. Use
 * {@link isoDateIn} for "today" in a given zone.
 */

export const BILLING_CYCLES = [
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
  'biennial',
  'triennial',
  'free',
  'unknown'
] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

/** Months per billing period, or null for `free` and `unknown`. */
export function cycleMonths(cycle: BillingCycle): number | null {
  switch (cycle) {
    case 'monthly':
      return 1;
    case 'quarterly':
      return 3;
    case 'semiannual':
      return 6;
    case 'annual':
      return 12;
    case 'biennial':
      return 24;
    case 'triennial':
      return 36;
    default:
      return null;
  }
}

/** Scaled units per currency unit: `1.00` is `100_000n`. */
export const MONEY_SCALE = 100_000n;
const CENT = MONEY_SCALE / 100n;
const MONEY = /^(\d{1,10})(?:\.(\d{1,2}))?$/;

/**
 * A non-negative decimal price with at most two decimals (`"34.82"`, `"39.8"`,
 * `"0"`) in scaled units, or null for anything else, including negatives,
 * three decimals, signs, exponents and thousands separators.
 */
export function parseMoney(value: string | null | undefined): bigint | null {
  if (value === null || value === undefined) return null;
  const match = MONEY.exec(value.trim());
  if (!match) return null;
  return BigInt(match[1]!) * MONEY_SCALE + BigInt((match[2] ?? '').padEnd(2, '0')) * CENT;
}

/** Scaled units as a decimal with two places, rounding half away from zero. */
export function formatScaled(value: bigint): string {
  const negative = value < 0n;
  const cents = ((negative ? -value : value) + CENT / 2n) / CENT;
  return `${negative ? '-' : ''}${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

export interface NormalizedCost {
  /** Scaled units per month; see {@link formatScaled}. */
  monthly: bigint;
  yearly: bigint;
}

/**
 * The monthly and yearly cost of one price. `free` is zero; `unknown`, a
 * missing or malformed price is null: unknown, not zero.
 */
export function normalizeCost(price: string | null, cycle: BillingCycle): NormalizedCost | null {
  if (cycle === 'free') return { monthly: 0n, yearly: 0n };
  const months = cycleMonths(cycle);
  const amount = parseMoney(price);
  if (months === null || amount === null) return null;
  const m = BigInt(months);
  return { monthly: amount / m, yearly: (amount * 12n) / m };
}

export interface CostItem {
  price: string | null;
  /** Grouped verbatim: `usd` and `USD` are different groups. */
  currency: string;
  billingCycle: BillingCycle;
}

export interface CostTotal {
  currency: string;
  monthly: string;
  yearly: string;
  /** Items that contributed a figure. */
  counted: number;
  /** Items in this currency whose cost is unknown. */
  unknown: number;
}

/** Totals per currency, never across currencies, largest yearly first, then by currency. */
export function totalCosts(items: ReadonlyArray<CostItem>): CostTotal[] {
  const groups = new Map<string, { monthly: bigint; yearly: bigint; counted: number; unknown: number }>();
  for (const item of items) {
    const group = groups.get(item.currency) ?? { monthly: 0n, yearly: 0n, counted: 0, unknown: 0 };
    const cost = normalizeCost(item.price, item.billingCycle);
    if (cost === null) group.unknown += 1;
    else {
      group.monthly += cost.monthly;
      group.yearly += cost.yearly;
      group.counted += 1;
    }
    groups.set(item.currency, group);
  }
  return [...groups.entries()]
    .toSorted(([a, x], [b, y]) => (y.yearly > x.yearly ? 1 : y.yearly < x.yearly ? -1 : a.localeCompare(b)))
    .map(([currency, g]) => ({
      currency,
      monthly: formatScaled(g.monthly),
      yearly: formatScaled(g.yearly),
      counted: g.counted,
      unknown: g.unknown
    }));
}

// Calendar dates -----------------------------------------------------------

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Milliseconds for a UTC calendar date; years below 100 are not shifted to 19xx. */
function utc(year: number, monthIndex: number, day: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, monthIndex, day);
  return date.getTime();
}

/** Days since 1970-01-01 for a valid ISO calendar date, or null. */
export function dayNumber(date: string): number | null {
  const m = ISO_DATE.exec(date);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const back = new Date(utc(year, month - 1, day));
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return Math.round(back.getTime() / DAY_MS);
}

/** The ISO date of a {@link dayNumber}, for years 0000 to 9999. */
export function fromDayNumber(day: number): string {
  const date = new Date(day * DAY_MS);
  const pad = (value: number, width: number): string => String(value).padStart(width, '0');
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`;
}

/**
 * Adds calendar months, clamping to the month's last day: `2027-01-31` plus
 * one is `2027-02-28`. Throws a `RangeError` for a malformed date.
 */
export function addMonths(date: string, months: number): string {
  const m = ISO_DATE.exec(date);
  if (!m || !Number.isInteger(months)) throw new RangeError(`not an ISO date and whole months: ${date}, ${months}`);
  const month = Number(m[2]) - 1 + months;
  const year = Number(m[1]) + Math.floor(month / 12);
  const monthIndex = ((month % 12) + 12) % 12;
  const last = new Date(utc(year, monthIndex + 1, 0)).getUTCDate();
  return fromDayNumber(Math.round(utc(year, monthIndex, Math.min(Number(m[3]), last)) / DAY_MS));
}

export interface RenewalProjection {
  /** The next renewal on or after today. */
  date: string;
  daysUntil: number;
  /** The stored date had passed and this one was projected by the cycle: confirm it with the provider. */
  projected: boolean;
  /** The stored date, as given. */
  stored: string;
}

/** The first `k` such that `addMonths(stored, months * k)` is on or after `today`. */
function firstCycleOnOrAfter(stored: string, months: number, today: number): number {
  const s = ISO_DATE.exec(stored)!;
  const t = fromDayNumber(today).split('-').map(Number);
  const between = (t[0]! - Number(s[1])) * 12 + (t[1]! - Number(s[2]));
  let k = Math.max(0, Math.floor(between / months) - 1);
  while (dayNumber(addMonths(stored, months * k))! < today) k += 1;
  return k;
}

/**
 * The next renewal on or after `today`. A stored date in the past is rolled
 * forward by whole cycles from the stored date (so `01-31` monthly renews on
 * `03-31`, not `03-28`). With no cycle it stays in the past and `daysUntil`
 * is negative. Null when either date is missing or invalid.
 */
export function projectRenewal(renewsOn: string | null, cycle: BillingCycle, today: string): RenewalProjection | null {
  if (renewsOn === null) return null;
  const stored = dayNumber(renewsOn);
  const now = dayNumber(today);
  if (stored === null || now === null) return null;
  const months = cycleMonths(cycle);
  if (stored >= now || months === null) {
    return { date: renewsOn, daysUntil: stored - now, projected: false, stored: renewsOn };
  }
  const date = addMonths(renewsOn, months * firstCycleOnOrAfter(renewsOn, months, now));
  return { date, daysUntil: dayNumber(date)! - now, projected: true, stored: renewsOn };
}

/**
 * Every renewal in `[today, today + horizonDays]`, projected by the cycle from
 * the stored date. A date with no cycle appears at most once.
 */
export function renewalsWithin(
  renewsOn: string | null,
  cycle: BillingCycle,
  today: string,
  horizonDays: number
): string[] {
  if (!Number.isFinite(horizonDays)) throw new RangeError('horizonDays must be finite');
  const first = projectRenewal(renewsOn, cycle, today);
  if (first === null || first.daysUntil < 0 || first.daysUntil > horizonDays) return [];
  const months = cycleMonths(cycle);
  if (months === null) return [first.date];
  const now = dayNumber(today)!;
  const out: string[] = [];
  for (let k = firstCycleOnOrAfter(renewsOn!, months, now); ; k += 1) {
    const date = addMonths(renewsOn!, months * k);
    if (dayNumber(date)! - now > horizonDays) return out;
    out.push(date);
  }
}

/** Today's ISO date in an IANA time zone. Throws a `RangeError` for an unknown zone. */
export function isoDateIn(now: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string): string => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
