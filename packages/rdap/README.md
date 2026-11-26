# @formless63/rdap

Domain registration data over RDAP (the successor to WHOIS), normalized to a small typed object.

```ts
import { createRdapClient, RdapError } from "@formless63/rdap";

const rdap = createRdapClient({ userAgent: "my-app/1.0" });
try {
  const domain = await rdap.lookup("example.com");
  // { name, registrar, registrarIanaId, registeredOn, expiresOn, lastChangedOn,
  //   status, nameservers, dnssec, privacy, url }
} catch (error) {
  if (error instanceof RdapError && error.code === "unsupported_tld") {
    // The TLD publishes no RDAP service. Several ccTLDs do not.
  }
}
```

- `null` always means "the server did not say".
- `not_found` usually means unregistered. It is not proof of availability.
- The IANA bootstrap file is cached for 24 hours per client.
- Servers are third parties, so every hop must be https to a public host; redirects are checked before they
  are requested. One timeout covers a request with all its redirects.
- Names are not resolved unless you pass `resolveHost`; then a hop whose name resolves to a private address
  is refused before it is asked. `fetch` resolves the name again when it connects, so a server that changes
  its answer in between (DNS rebinding) still gets through: only an egress policy stops that.

```ts
import { lookup } from "node:dns/promises";

const rdap = createRdapClient({
  resolveHost: async (host) => (await lookup(host, { all: true })).map((entry) => entry.address),
});
```

- A refused hop has `code` `refused_redirect` (a redirect) or `refused_server` (named by the bootstrap file).
- Registries rate limit. Pace bulk lookups and honour `retryAfterMs`.

Contacts are not returned. Entities, IP networks and AS numbers are not supported.
