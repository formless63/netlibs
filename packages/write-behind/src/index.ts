export interface WriteBehindOptions<Result> {
  /** The result a clean `flush()` returns before anything was stored. */
  initialResult: Result;
  /** Persist the current state. Never called concurrently with itself. */
  store: () => Promise<Result>;
  /** Whether to retry without another change. Default: always. */
  retryable?: ((error: unknown) => boolean) | undefined;
  /** A background retry stored the state. */
  onRetryStored?: ((result: Result) => void) | undefined;
  /** A background retry failed. It will be tried again if retryable. */
  onRetryError?: ((error: unknown) => void) | undefined;
  /** First retry delay; doubles per failure. Default 1000. */
  retryBaseMs?: number | undefined;
  /** Longest retry delay. Default 30000. */
  retryMaxMs?: number | undefined;
}

/** Thrown by `flush()` once the state was deliberately discarded. */
export class DiscardedError extends Error {
  override readonly name = 'DiscardedError';
  constructor() {
    super('The state was discarded');
  }
}

/** Thrown by `assertClean()` while changes are not stored. */
export class NotStoredError extends Error {
  override readonly name = 'NotStoredError';
  constructor() {
    super('Changes are not stored yet');
  }
}

/**
 * Durability accounting for state held in memory and stored elsewhere: a
 * collaboration room, a cached record, a queue.
 *
 * Writes are serialized, and flushes waiting behind one are answered by a single
 * write. A flush resolves only once every change made before it is stored, so an
 * older write in flight never acknowledges a newer change. Failures keep the
 * state dirty and are retried with capped backoff until they succeed or the
 * state is discarded; nothing is dropped for taking too long.
 *
 * This is not a crash journal. State not yet stored is lost with the process.
 */
export class WriteBehind<Result> {
  readonly #options: WriteBehindOptions<Result>;
  #sequence = 0;
  #storedSequence = 0;
  #queued = 0;
  #failures = 0;
  #discarded = false;
  #disposed = false;
  #retryTimer: ReturnType<typeof setTimeout> | undefined;
  #tail: Promise<unknown> = Promise.resolve();
  #lastResult: Result;

  constructor(options: WriteBehindOptions<Result>) {
    this.#options = options;
    this.#lastResult = options.initialResult;
  }

  /** Call after every change. */
  markDirty(): void {
    if (!this.#discarded) this.#sequence += 1;
  }

  /** Something is unsaved, or a write is under way. */
  get pending(): boolean {
    return !this.#discarded && (this.#sequence > this.#storedSequence || this.#queued > 0);
  }

  /** The last write failed. */
  get failed(): boolean {
    return this.#failures > 0;
  }

  /** Guard for unloading the state. */
  assertClean(): void {
    if (this.pending || this.failed) throw new NotStoredError();
  }

  /**
   * Resolves when every change made so far is stored. Rejects with the store's
   * error; the state stays dirty and, if retryable, is retried in the background.
   */
  flush(): Promise<Result> {
    const requested = this.#sequence;
    this.#queued += 1;
    const operation = this.#tail
      .catch(() => undefined)
      .then(() => this.#write(requested))
      .finally(() => {
        this.#queued -= 1;
      });
    this.#tail = operation;
    // Callers still see the rejection; keeping the tail must not make another,
    // unhandled one.
    void operation.catch(() => undefined);
    return operation;
  }

  /** Give up on unsaved changes on purpose: an invalid merge, a reset. */
  discard(): void {
    this.#discarded = true;
    this.#failures = 0;
    this.#stopTimer();
  }

  /** Stop background retries. Unsaved changes stay reported as pending. */
  dispose(): void {
    this.#disposed = true;
    this.#stopTimer();
  }

  async #write(requested: number): Promise<Result> {
    if (this.#discarded) throw new DiscardedError();
    if (this.#storedSequence >= requested && !this.failed) return this.#lastResult;
    const writing = this.#sequence;
    try {
      const result = await this.#options.store();
      if (this.#discarded) throw new DiscardedError();
      this.#lastResult = result;
      this.#storedSequence = writing;
      this.#failures = 0;
      this.#stopTimer();
      // Changes that arrived during the write must not wait for another flush.
      if (this.#sequence > this.#storedSequence) this.#scheduleRetry();
      return result;
    } catch (error) {
      if (this.#discarded) throw error;
      this.#failures += 1;
      if (this.#options.retryable?.(error) ?? true) this.#scheduleRetry();
      throw error;
    }
  }

  #scheduleRetry(): void {
    if (this.#retryTimer !== undefined || this.#discarded || this.#disposed) return;
    const { retryBaseMs = 1_000, retryMaxMs = 30_000 } = this.#options;
    const delay = Math.min(retryMaxMs, retryBaseMs * 2 ** Math.min(this.#failures, 30));
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      void this.flush().then(
        (result) => this.#options.onRetryStored?.(result),
        (error: unknown) => {
          if (!this.#discarded) this.#options.onRetryError?.(error);
        },
      );
    }, delay);
    // In Node, a retry must not keep the process alive.
    (this.#retryTimer as { unref?: () => void }).unref?.();
  }

  #stopTimer(): void {
    clearTimeout(this.#retryTimer);
    this.#retryTimer = undefined;
  }
}
