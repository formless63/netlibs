# Architecture

## Boundaries

A package exists when someone could want it without the others.

- **Pure logic is separate from I/O.** `domain-intel` and `dns-plan` have no dependencies and never touch the
  network, so a browser or a different client can use them.
- **Contracts are separate from adapters.** `registrar` and the `DnsProvider` interface carry no provider code.
  A new provider is a new package that changes nothing else.
- **One package per provider.** A Namecheap change cannot break a Spaceship user.
- **`provider-http` is the only shared runtime code.** It holds the rules that must not drift between
  clients: redirects, size limits, redaction, the error vocabulary, the rate budget. `ProviderError` is one
  class, so `instanceof` works across packages.

Dependencies point one way: provider → contract/pure → nothing, and provider → `provider-http` → nothing.
`zod` (MIT) is the only third-party dependency. Official SDKs were not adopted: they would put large generated
types on the public surface to save one header and an envelope.

## Repository

One monorepo, independent versions. Cross-package tests run together, and any package can move to its own
repository: each has its own manifest, README and tests, and `verify:packages` proves each tarball loads alone.

Before 1.0, a breaking change in `provider-http` requires a minor release of everything that depends on it.

## Adding a provider

1. Create `packages/<name>` with `provider-http` and the contract it implements.
2. Subclass `ProviderError`; add a `code` only for provider-specific reasons a caller can act on.
3. Parse every response with a schema; keep only normalized fields.
4. Test with a stubbed `fetch`, assert secrets never appear in errors, and run the conformance kit if there is one.
