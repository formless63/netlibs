import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DiscardedError, NotStoredError, WriteBehind } from '../src/index.ts';

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('WriteBehind', () => {
  it('stores changes made during a write without another flush', async () => {
    let release!: () => void;
    const store = vi.fn(() => Promise.resolve(1));
    store.mockImplementationOnce(() => new Promise((r) => (release = () => r(0))));
    const onRetryStored = vi.fn();
    const state = new WriteBehind({ initialResult: -1, store, onRetryStored });
    state.markDirty();
    const first = state.flush();
    await vi.advanceTimersByTimeAsync(0);
    state.markDirty();
    release();
    expect(await first).toBe(0);
    expect(state.pending).toBe(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(state.pending).toBe(false);
    expect(onRetryStored).toHaveBeenCalledWith(1);
  });

  it('backs off exponentially to the cap', async () => {
    const times: number[] = [];
    const state = new WriteBehind({
      initialResult: 0,
      store: async () => {
        times.push(Date.now());
        throw new Error('down');
      },
      retryBaseMs: 100,
      retryMaxMs: 1_000,
    });
    const errors: unknown[] = [];
    state.markDirty();
    await state.flush().catch((error: unknown) => errors.push(error));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(
      times
        .slice(1)
        .map((t, i) => t - times[i]!)
        .slice(0, 6),
    ).toEqual([200, 400, 800, 1000, 1000, 1000]);
    state.dispose();
    const count = times.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(times).toHaveLength(count);
    expect(state.pending).toBe(true);
  });

  it('rejects flushes after a discard, including one in flight, and reports no retry error', async () => {
    let release!: () => void;
    const onRetryError = vi.fn();
    const state = new WriteBehind({
      initialResult: 0,
      store: () => new Promise<number>((r) => (release = () => r(1))),
      onRetryError,
    });
    state.markDirty();
    const inFlight = state.flush();
    await vi.advanceTimersByTimeAsync(0);
    state.discard();
    release();
    await expect(inFlight).rejects.toBeInstanceOf(DiscardedError);
    await expect(state.flush()).rejects.toBeInstanceOf(DiscardedError);
    state.markDirty();
    expect(state.pending).toBe(false);
    expect(onRetryError).not.toHaveBeenCalled();
  });

  it('never overlaps writes', async () => {
    let active = 0;
    let most = 0;
    const state = new WriteBehind({
      initialResult: 0,
      store: async () => {
        most = Math.max(most, ++active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        return 0;
      },
    });
    const all: Promise<number>[] = [];
    for (let i = 0; i < 20; i++) {
      state.markDirty();
      all.push(state.flush());
    }
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all(all);
    expect(most).toBe(1);
  });

  it('leaves no unhandled rejection behind a failed flush nobody awaits', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    const state = new WriteBehind({
      initialResult: 0,
      store: () => Promise.reject(new Error('x')),
      retryable: () => false,
    });
    state.markDirty();
    void state.flush();
    await vi.advanceTimersByTimeAsync(10);
    vi.useRealTimers();
    await new Promise((r) => setTimeout(r, 10));
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(() => state.assertClean()).toThrow(NotStoredError);
  });
});
