# @formless63/domain-intel

Domain-name facts with no I/O and no dependencies.

```ts
normalizeDomainName("https://MÜNCHEN.example/x");       // "xn--mnchen-3ya.example"
normalizeStatus("clientTransferProhibited");             // "client transfer prohibited"
normalizeStatus("ok");                                   // "active" (RFC 8056)
inferDnsProvider(["a.ns.cloudflare.com"]);               // "Cloudflare", or null when unsure
expiryLevel(daysUntil("2027-01-01", "2026-12-20"), [60, 30, 7]); // "warning"
expiryPhase(340, ["auto renew period"]);                 // "grace": status beats the date
compareRegistrations(previous, next);                    // changes, with signals such as "dns_moved"
compareSources(registrarAccount, publicFacts);           // where two sources disagree
```

Validation is syntactic: it does not use the public suffix list. Combine with
[`tldts`](https://www.npmjs.com/package/tldts) when you need the registrable domain. Expiry day counts are
typical gTLD values; pass your own for ccTLDs.
