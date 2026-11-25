import { ProviderError } from './errors.ts';

export interface RateBudgetStats {
  capacity: number;
  refillPerSecond: number;
  /** Tokens available now; 0 while waiters have reserved ahead. */
  available: number;
  /** Acquisitions waiting on refill. */
  pending: number;
  acquired: number;
  rejected: number;
}

export interface RateBudget {
  /** Takes `cost` tokens, waiting for refill when needed. */
  acquire(cost?: number, options?: { maxWaitMs?: number; signal?: AbortSignal }): Promise<void>;
  /** Takes `cost` tokens only if that needs no wait. */
  tryAcquire(cost?: number): boolean;
  stats(): RateBudgetStats;
}

export interface RateBudgetOptions {
  /** Names the budget in errors. */
  provider?: string;
  capacity: number;
  refillPerSecond: number;
  /** Longest wait `acquire` accepts before failing. Default 30 000. */
  maxWaitMs?: number;
  /** Test seams. */
  now?: () => number;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** A promise-based delay that rejects with the signal's reason when aborted. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason as Error);
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal!.reason as Error);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A token bucket: starts full, refills continuously, and makes waiters reserve
 * ahead so they are served roughly in order. In-memory and per-process; divide
 * the rate when several processes share one account.
 */
export function createRateBudget(options: RateBudgetOptions): RateBudget {
  const { capacity, refillPerSecond } = options;
  const provider = options.provider ?? 'provider';
  const defaultMaxWaitMs = options.maxWaitMs ?? 30_000;
  const now = options.now ?? Date.now;
  const wait = options.sleep ?? sleep;

  const invalid = (message: string): never => {
    throw new ProviderError({ provider, kind: 'invalid_input', message });
  };
  if (!Number.isFinite(capacity) || capacity <= 0) invalid('rate budget capacity must be positive');
  if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    invalid('rate budget refillPerSecond must be positive');
  }

  let tokens = capacity;
  let refilledAt = now();
  let pending = 0;
  let acquired = 0;
  let rejected = 0;

  const refill = (): void => {
    const at = now();
    if (at > refilledAt) tokens = Math.min(capacity, tokens + ((at - refilledAt) / 1000) * refillPerSecond);
    refilledAt = at;
  };
  const check = (cost: number): void => {
    if (!Number.isFinite(cost) || cost <= 0 || cost > capacity) {
      invalid('rate budget cost must be positive and no greater than capacity');
    }
  };

  return {
    async acquire(cost = 1, { maxWaitMs = defaultMaxWaitMs, signal } = {}) {
      check(cost);
      refill();
      if (tokens >= cost) {
        tokens -= cost;
        acquired += 1;
        return;
      }
      const waitMs = Math.ceil(((cost - tokens) / refillPerSecond) * 1000);
      if (waitMs > maxWaitMs) {
        rejected += 1;
        throw new ProviderError({
          provider,
          kind: 'rate_limited',
          message: `the local ${provider} rate budget is exhausted`,
          retryAfterMs: waitMs,
          detail: { source: 'local_rate_budget', maxWaitMs }
        });
      }
      tokens -= cost;
      pending += 1;
      try {
        await wait(waitMs, signal);
      } catch {
        // Abandoned: give the reservation back so later callers are not charged for it.
        refill();
        tokens = Math.min(capacity, tokens + cost);
        throw new ProviderError({
          provider,
          kind: 'aborted',
          message: `the ${provider} request was aborted while waiting for the rate budget`
        });
      } finally {
        pending -= 1;
      }
      acquired += 1;
    },

    tryAcquire(cost = 1) {
      check(cost);
      refill();
      if (tokens < cost) return false;
      tokens -= cost;
      acquired += 1;
      return true;
    },

    stats() {
      refill();
      return { capacity, refillPerSecond, available: Math.max(0, tokens), pending, acquired, rejected };
    }
  };
}
