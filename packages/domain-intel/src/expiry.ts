import { normalizeStatus } from './status.ts';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days since the epoch for an ISO calendar date, or null when it is not one. */
export function dayNumber(date: string): number | null {
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  if (back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return Math.round(ms / 86_400_000);
}

/** Whole days from `today` to `date` (negative when past). Both are ISO calendar dates. */
export function daysUntil(date: string | null, today: string): number | null {
  if (date === null) return null;
  const a = dayNumber(date);
  const b = dayNumber(today);
  return a === null || b === null ? null : a - b;
}

export type ExpiryLevel = 'expired' | 'critical' | 'warning' | 'ok' | 'unknown';

/**
 * Severity against alert windows such as `[60, 30, 7]`: inside the widest is a
 * warning, inside the closest is critical.
 */
export function expiryLevel(days: number | null, windows: readonly number[]): ExpiryLevel {
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (windows.length === 0) return 'ok';
  if (days <= Math.min(...windows)) return 'critical';
  if (days <= Math.max(...windows)) return 'warning';
  return 'ok';
}

/**
 * - `grace`: past expiry, or auto-renewed by the registry on the registrar's
 *   behalf; usually renewable at the normal price.
 * - `redemption`: deleted by the registrar; restoring costs a fee.
 * - `pending_delete`: about to be released.
 */
export type ExpiryPhase = 'upcoming' | 'grace' | 'redemption' | 'pending_delete';

export interface ExpiryPhaseOptions {
  /** Assumed grace length when no status says otherwise. Default 45. */
  graceDays?: number;
  /** Days past expiry after which no phase is assumed. Default 80. */
  redemptionEndDays?: number;
}

/**
 * Where a registration is in its expiry lifecycle. Status beats the date,
 * because registries move the date of an auto-renewed name forward before
 * anyone has paid. The day-based fallbacks are typical gTLD values; ccTLDs vary.
 */
export function expiryPhase(
  days: number | null,
  statuses: readonly string[],
  { graceDays = 45, redemptionEndDays = 80 }: ExpiryPhaseOptions = {}
): ExpiryPhase | null {
  const present = new Set(statuses.map(normalizeStatus));
  if (present.has('pending delete')) return 'pending_delete';
  if (present.has('redemption period') || present.has('pending restore')) return 'redemption';
  if (present.has('auto renew period')) return 'grace';
  if (days === null) return null;
  if (days >= 0) return 'upcoming';
  if (days >= -graceDays) return 'grace';
  if (days >= -redemptionEndDays) return 'redemption';
  return null;
}
