# @formless63/purelymail-client

A typed client for the [Purelymail](https://purelymail.com) API (domains, mailboxes, routing rules, credit),
and the DNS records a Purelymail domain needs as [`dns-plan`](../dns-plan) records.

```ts
import { createPurelymailClient, purelymailDnsRecords } from '@formless63/purelymail-client';
import { diffRecords, planOperations } from '@formless63/dns-plan';

const mail = createPurelymailClient({ apiToken });
const ownershipCode = await mail.getOwnershipCode();           // one per account
const desired = purelymailDnsRecords({ domain: 'example.com', ownershipCode });
await dns.apply(zone, planOperations(diffRecords(desired, await dns.listRecords(zone))));
await mail.addDomain('example.com');                           // after the ownership TXT resolves
await mail.createUser({ userName: 'postmaster', domainName: 'example.com', password });
```

## API

- Domains: `getOwnershipCode`, `addDomain`, `listDomains({ includeShared })`, `findDomain`, `recheckDomainDns`.
- Mailboxes: `createUser` (local part plus domain), `deleteUser` (full address; `purelymailAddress` joins
  them), `listUsers`.
- Routing (aliases, catch-alls): `listRoutingRules`, `createRoutingRule`, `deleteRoutingRule`.
- `checkAccountCredit` returns Purelymail's decimal string untouched; `probe()` reports whether the token works.
- `PURELYMAIL_OPERATIONS` lists all nineteen API operations; `purelymailPath` gives the path of one.

**Creates are not idempotent**, and `createUser` is billable: after an ambiguous failure, read `listUsers`,
`listDomains` or `listRoutingRules` back before trying again.

## DNS records

`purelymailDnsRecords({ domain, zone?, ownershipCode? })` returns MX (`mailserver.purelymail.com`, priority 50),
SPF, three DKIM CNAMEs, DMARC as a CNAME to `dmarcroot.purelymail.com`, and the ownership TXT when you have the
code. Names are relative to `zone` (default: the domain itself), so `mail.example.com` in `example.com` gets
`_dmarc.mail`. Every record is unproxied with the provider's default TTL. Checked against
[Purelymail's setup page](https://purelymail.com/docs/domainDocs) on 2026-11-26.

If the zone already has an SPF record, `dns-plan` pairs the two by version tag and would replace it: merge
the `include:` yourself when the domain sends mail from elsewhere too.

## Errors

Every failure is a `PurelymailError` (a `ProviderError`) with `kind`, `status`, `operation` (e.g. `user.create`)
and `providerCode` (Purelymail's code, e.g. `invalidToken`).

- Purelymail reports most failures at **HTTP 200** in a `{type: "error"}` envelope, so the envelope is checked on
  every answer. `invalidToken` is `unauthorized`; any other refusal is `invalid_request`, which will not
  succeed on retry.
- A wrong operation name answers 404 with HTML: `not_found` with `detail.notEnvelope`.
- A successful answer missing a field is `invalid_response` with `detail.field`.
- A local rate-budget refusal is `rate_limited` with `detail.source: 'local_rate_budget'`, before any request.

## Credential safety

The token is sent only in the `Purelymail-Api-Token` header: never in a URL or body. Redirects are refused and
https is required (loopback http with `allowLoopbackHttp`). Errors hold no headers, URLs or bodies; provider text
in them has the token and, for `createUser`, the mailbox password removed. The password is write-only:
`createUser` returns nothing.

## Limitations

- `listUsers` cannot page and Purelymail returns at most 1000 addresses, so a list of 1000 or more is an error
  rather than possibly incomplete.
- Routing rule ids are int64 in the API and read as JavaScript numbers; ids above 2^53 would lose precision.
- Not called: domain deletion, user changes, password-reset methods and app passwords.
- Error codes other than `invalidToken` (`noSuchUser`, `noSuchDomain`) are unconfirmed.
- Operation names and bodies follow Purelymail's OpenAPI document; verified against stubs, not a live account.
