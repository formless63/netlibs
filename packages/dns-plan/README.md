# @formless63/dns-plan

A provider-neutral DNS record model with a diff and planner that will not touch records it does not own.
No dependencies, no I/O.

```ts
const diff = diffRecords(desired, observed);    // missing, modified, unexpected, unchanged
const plan = planOperations(diff, { remove });  // creates, updates, explicit removals
```

- **Unexpected records are never deleted.** Deletes come only from `remove`.
- **Another record is never overwritten by guesswork.** A desired TXT beside an unrelated verification TXT is
  added, not swapped in. Replacement needs certainty: the same `recordId`, a single-valued type, one address on
  each side, or the same TXT version tag. `pairing: "positional"` opts out.
- **`managed: false`** records are compared and reported, never written.
- Equivalent spellings (case, trailing dots, IPv6 forms, quoted TXT) are not drift.

Because an unmatched desired record is added, check for a second SPF or DMARC record when you take over an
existing zone; those two are paired by version tag.

Implement `DnsProvider` to add a host. Names are zone-relative (`@`, `*`, `www`); `ttlSeconds: null` means the
provider default.
