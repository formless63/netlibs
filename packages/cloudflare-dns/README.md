# @formless63/cloudflare-dns

Cloudflare zones and DNS records, implementing `DnsProvider` from `@formless63/dns-plan`.

```ts
const dns = createCloudflareDns({ apiToken });
const zone = await dns.findZone("example.com");
if (!zone) throw new Error('no such zone');
const records = await dns.listRecords({ zoneId: zone.zoneId, zoneName: zone.name });
```

- API tokens only, never the global key. Reads need Zone:Read and DNS:Read, writes DNS:Edit.
- `apply` runs in order. On failure it throws `DnsApplyError` with the completed operations and the cause.
- Repeated creates and deletes converge; a create that conflicts with a different record is still an error.
- Proxying a type that cannot be proxied is refused, because writing it unproxied would expose the origin.
- Updates use PUT. Whether Cloudflare keeps a record's comment and tags when they are omitted is not
  documented; assume it does not.
- Share one `rateBudget` across clients of the same Cloudflare user: the limit also covers the dashboard.

Creating zones and tokens is out of scope. Verified against stubs, not a live account.
