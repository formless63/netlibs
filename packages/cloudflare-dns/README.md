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
- A `group` of deletes followed by creates (a type change) is one `POST /dns_records/batch`: Cloudflare runs
  it as one transaction, so the name keeps the old records or gets the new ones. A failed batch changes
  nothing. Propagation to the edge is still per record. Other groups go one operation at a time.
- Repeated creates and deletes converge. A create refused because the name is taken reads that name back
  (at most five pages) and succeeds only if the same record is there; otherwise the error names what holds
  the name.
- Updates use PUT and never change a record's type; Cloudflare no longer allows that.
- Proxying a type that cannot be proxied is refused, because writing it unproxied would expose the origin.
- Whether Cloudflare keeps a record's comment and tags when an update omits them is not documented; assume
  it does not.
- A list that does not end, or has an empty page before its last, is an error, never a partial result.
- Share one `rateBudget` across clients of the same Cloudflare user: the limit also covers the dashboard.

Creating zones and tokens is out of scope. Verified against stubs, not a live account.
