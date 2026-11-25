# @formless63/registrar-spaceship

Read-only [Spaceship](https://docs.spaceship.dev) adapter for `@formless63/registrar`.

```ts
const spaceship = createSpaceshipRegistrar({ apiKey, apiSecret }); // needs only domains:read
const domains = await spaceship.listDomains();
```

Renewal prices cost one request per domain, paced to the published limit. Pass `withPricing: false` to skip
them. A missing price is `null`; authentication failures, limits and outages reject.

Verified against recorded-shape fixtures, not a live account.
