# netlibs

Small, independent TypeScript libraries: domain names, DNS and the APIs around them, and a rich-text editor.
Use one or combine several. ESM, Node 22+ and Bun.

## Domains and DNS

| Package | Use it to | Depends on |
| --- | --- | --- |
| [`rdap`](packages/rdap) | Look up a domain's public registration data | zod, `domain-intel`, `provider-http` |
| [`domain-intel`](packages/domain-intel) | Normalize names and statuses, recognize DNS hosts, detect changes, judge expiry | nothing |
| [`registrar`](packages/registrar) | Share one shape across registrar adapters, and test that they honour it | nothing |
| [`registrar-spaceship`](packages/registrar-spaceship) | Read a Spaceship account | zod, `registrar`, `domain-intel`, `provider-http` |
| [`registrar-namecheap`](packages/registrar-namecheap) | Read a Namecheap account | zod, `registrar`, `domain-intel`, `provider-http` |
| [`dns-plan`](packages/dns-plan) | Compare desired and actual DNS records and plan safe changes | nothing |
| [`cloudflare-dns`](packages/cloudflare-dns) | Read and change Cloudflare DNS | zod, `dns-plan`, `provider-http` |
| [`pangolin-client`](packages/pangolin-client) | Use the Pangolin Integration API | zod, `provider-http` |
| [`purelymail-client`](packages/purelymail-client) | Manage Purelymail mail domains, and plan their DNS records | zod, `dns-plan`, `provider-http` |
| [`provider-http`](packages/provider-http) | Write a safe API client of your own | nothing |

## Utilities

| Package | Use it to | Depends on |
| --- | --- | --- |
| [`json-redact`](packages/json-redact) | Redact secret-named keys before logging or storing JSON | nothing |
| [`recurring-costs`](packages/recurring-costs) | Total recurring prices exactly and project renewal dates | nothing |

## Rich text

| Package | Use it to | Runs in |
| --- | --- | --- |
| [`editor-core`](packages/editor-core) | Define, validate, convert, edit and version documents | Node, Bun, browser |
| [`editor-core/model`](packages/editor-core) | The same model without Tiptap or ProseMirror | anywhere |
| [`editor-renderer`](packages/editor-renderer) | Render documents read-only with React or to HTML | server or client |
| [`editor-react`](packages/editor-react) | Edit documents in React, with media viewers | browser |

The editor packages need no router, database, auth or Tailwind. They use the Tiptap, CodeMirror and Radix
libraries and share nothing with the domain packages. Guides: [API](docs/editor/api.md),
[TanStack Start](docs/editor/tanstack-start.md), [limitations](docs/editor/limitations.md).

All names are under `@formless63/`. Not on npm yet; build tarballs with `bun run pack:all`.

## Composing the domain packages

```ts
import { compareRegistrations, describeChange } from '@formless63/domain-intel';
import { createRdapClient } from '@formless63/rdap';

const rdap = createRdapClient();
const now = await rdap.lookup('example.com');
for (const change of compareRegistrations(previous, now)) console.log(describeChange(change));
```

```ts
import { createCloudflareDns } from '@formless63/cloudflare-dns';
import { diffRecords, planOperations } from '@formless63/dns-plan';

const dns = createCloudflareDns({ apiToken });
const zone = await dns.findZone('example.com');
if (!zone) throw new Error('no such zone');
const ref = { zoneId: zone.zoneId, zoneName: zone.name };
const plan = planOperations(diffRecords(desired, await dns.listRecords(ref)));
await dns.apply(ref, plan);
```

## Shared rules for API clients

- **One error vocabulary.** Every client throws a `ProviderError` subclass with a `kind`
  (`unauthorized`, `not_found`, `rate_limited`, …), `status`, `retryAfterMs` and `retryable`.
- **Errors are safe to log.** They never hold headers, URLs, bodies, causes or credentials. Provider text is
  stripped of secrets, control characters and excess length.
- **Credentials stay put.** Clients that send credentials refuse redirects and require https.
- **Bounded.** Every response has a size limit, every request a timeout, and every call takes an `AbortSignal`.
- **Complete or an error.** A listing is never silently truncated.
- **No hidden retries, storage, scheduling, logging or environment variables.** The application owns those.

## Developing

```bash
bun install
bun run ci               # build, typecheck, test, examples, verify packed packages in clean directories
bun run playground       # the editor, at http://localhost:5173
bun run pack:all         # ./artifacts/*.tgz
```

Structure and reasons: [docs/architecture.md](docs/architecture.md). MIT licensed; the editor packages also carry
[third-party notices](THIRD_PARTY_NOTICES.md).
