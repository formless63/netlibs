# @formless63/dns-plan

A provider-neutral DNS record model with a diff and planner that will not touch records it does not own.
No dependencies, no I/O.

```ts
const diff = diffRecords(desired, observed, { pending: removing }); // missing, modified, unexpected, unchanged
const plan = planOperations(diff, { remove: removing });            // creates, updates, explicit removals
```

- **Unexpected records are never deleted or rewritten.** Deletes come only from `remove`.
- **Another record is never overwritten by guesswork.** A desired TXT beside an unrelated verification TXT is
  added, not swapped in. Replacement needs certainty: the same `recordId`, a single-valued type, one address on
  each side, or the same TXT version tag. `pairing: "positional"` opts out.
- **`managed: false`** records are compared and reported, never written.
- Equivalent spellings (case, trailing dots, IPv6 forms, TXT quoting and string splits) are not drift.
  `normalizeContent` is the comparison form; store what was written.

## Replacing a record

Pass the records you are about to remove as `pending` to the diff and as `remove` to the planner. A record in
`pending` but not in `remove` stays where it is. The plan then runs:

1. **in place**: a removal and a new record of the same type that are certainly one record become one update;
2. **type changes**: the conflicting removals, then the creates that need the name, sharing a `group`;
3. other creates, before any other delete, so a set never has a gap;
4. updates;
5. other removals;
6. creates blocked by a record that stays. Nothing is removed to make room; the provider refuses them last.

`planChanges` returns the same plan with the desired or removed record behind each operation.
`recordsConflict(a, b)` is the coexistence rule it uses (CNAME, NS, single-valued types).

Because an unmatched desired record is added, check for a second SPF or DMARC record when you take over an
existing zone; those two are paired by version tag.

## Providers

Implement `DnsProvider` to add a host. Names are zone-relative (`@`, `*`, `www`); `ttlSeconds: null` means the
provider default. `apply` runs in order and rejects with `DnsApplyError` (the results so far, the failed
operation, and the cause's `kind`). A provider whose `capabilities().atomicGroups` is true applies each `group`
all or nothing; others apply it in order. A create refused because the name is taken is `already_present` only
when that record is read back, with `differingAttributes` for TTL or proxying.
