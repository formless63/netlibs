# @formless63/registrar-namecheap

Read-only Namecheap adapter for `@formless63/registrar`.

```ts
const namecheap = createNamecheapRegistrar({ apiUser, apiKey, userName, clientIp });
const domains = await namecheap.listDomains();
```

- Namecheap answers only whitelisted IPv4 addresses. `code: "ip_not_whitelisted"` and `"api_disabled"` tell
  you what to fix.
- Credentials travel in the query string because the API offers nothing else. Errors never contain the URL;
  keep request logging off for this host in proxies and APM tools.
- Nameservers cost one request per domain at about 17 per minute. Pass `withNameservers: false` to skip them.
- Prices and EPP statuses are not available from these endpoints (`capabilities` says so).
- The XML reader refuses DOCTYPE and entity declarations.

Verified against recorded-shape fixtures, not a live account.
