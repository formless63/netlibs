import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WriteBehind } from '../src/index.ts';

const states: WriteBehind<number>[] = [];
function setup() {
  const store = vi.fn<() => Promise<number>>().mockResolvedValue(1);
  const onRetryStored = vi.fn();
  const state = new WriteBehind({
    initialResult: 0,
    store,
    retryable: (error) => error !== 'invalid',
    onRetryStored
  });
  states.push(state);
  return { state, store, onRetryStored };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  states.splice(0).forEach((state) => state.dispose());
  vi.useRealTimers();
});

describe('durability accounting', () => {
  it('throws final-store failure, stays dirty and retries without another edit', async () => {
    const { state, store, onRetryStored } = setup();
    state.markDirty();
    store.mockRejectedValueOnce(new Error('DB unavailable'));
    await expect(state.flush()).rejects.toThrow('DB unavailable');
    expect(state.failed).toBe(true);
    expect(() => state.assertClean()).toThrow('not stored');
    await vi.advanceTimersByTimeAsync(2_000);
    expect(store).toHaveBeenCalledTimes(2);
    expect(onRetryStored).toHaveBeenCalledOnce();
    expect(state.pending).toBe(false);
    expect(state.failed).toBe(false);
    expect(() => state.assertClean()).not.toThrow();
  });

  it('coalesces simultaneous explicit and debounced flushes into one write', async () => {
    const { state, store } = setup();
    state.markDirty();
    expect(await Promise.all([state.flush(), state.flush(), state.flush()])).toEqual([1, 1, 1]);
    expect(store).toHaveBeenCalledOnce();
  });

  it('does not acknowledge a newer generation through an older in-flight write', async () => {
    const { state, store } = setup();
    let release!: (value: number) => void;
    store
      .mockImplementationOnce(
        () =>
          new Promise<number>((resolve) => {
            release = resolve;
          })
      )
      .mockResolvedValue(2);
    state.markDirty();
    const first = state.flush();
    await vi.advanceTimersByTimeAsync(0);
    state.markDirty();
    const newer = state.flush();
    expect(store).toHaveBeenCalledOnce();
    release(1);
    expect(await first).toBe(1);
    expect(await newer).toBe(2);
    expect(store).toHaveBeenCalledTimes(2);
    expect(state.pending).toBe(false);
  });

  it('a clean flush returns the last durable version without a duplicate write', async () => {
    const { state, store } = setup();
    expect(await state.flush()).toBe(0);
    expect(store).not.toHaveBeenCalled();
  });

  it('retains failure across capped retries and only deliberate invalid discard permits unload', async () => {
    const { state, store } = setup();
    state.markDirty();
    store.mockRejectedValue(new Error('DB unavailable'));
    await expect(state.flush()).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(62_000);
    expect(store.mock.calls.length).toBeLessThan(10);
    expect(() => state.assertClean()).toThrow();
    state.discard();
    expect(() => state.assertClean()).not.toThrow();
    const calls = store.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store).toHaveBeenCalledTimes(calls);
  });

  it('does not automatically retry a validation rejection', async () => {
    const { state, store } = setup();
    state.markDirty();
    store.mockRejectedValue('invalid');
    await expect(state.flush()).rejects.toBe('invalid');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(store).toHaveBeenCalledOnce();
    state.discard();
    expect(state.pending).toBe(false);
  });
});
