# @formless63/write-behind

For state that lives in memory and is stored elsewhere: a collaboration room, a
cached record, a counter. Keeps honest account of what is stored.

```ts
import { WriteBehind } from '@formless63/write-behind';

const room = new WriteBehind({
  initialResult: loaded.version,
  store: async () => (await db.save(id, snapshot())).version,
  retryable: (error) => !(error instanceof ValidationError),
  onRetryError: (error) => log.warn(error),
});

onChange(() => {
  room.markDirty();
  scheduleFlush(); // your debounce
});

const version = await room.flush(); // every change so far is stored
room.assertClean(); // throws if unloading would lose anything
```

- `store` never runs twice at once, and flushes waiting behind it share one write.
- A flush never reports success because of an older write that was in flight.
- Failed writes keep the state dirty and retry with capped exponential backoff,
  without waiting for another change, for as long as it takes.
- A non-retryable failure stays visible in `failed` until you flush again or
  `discard()`.
- `dispose()` stops retries. `discard()` gives up unsaved changes on purpose.

It is not a crash journal: what is not yet stored is lost with the process. It
does not debounce; call `flush()` when you want to write.
