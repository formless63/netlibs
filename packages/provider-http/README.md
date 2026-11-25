# @formless63/provider-http

Plumbing for API clients: safe requests, safe errors, rate budgets. No dependencies.

```ts
import { createHttpClient, createRateBudget, kindFromStatus } from "@formless63/provider-http";

const http = createHttpClient({
  provider: "Acme",
  baseUrl: "https://api.acme.example/v1",
  headers: { authorization: `Bearer ${token}` },
  secrets: [token],
  rateBudget: createRateBudget({ provider: "Acme", capacity: 5, refillPerSecond: 1 })
});

const result = await http.request({ operation: "things.list", path: "/things", query: { page: 1 } });
if (result.status !== 200) {
  throw http.error({
    kind: kindFromStatus(result.status),
    message: `Acme refused: ${http.safeText(result.text)}`,
    status: result.status,
    retryAfterMs: result.retryAfterMs
  });
}
const body = result.json();
```

`request` resolves for any HTTP status and rejects only without a usable response: `timeout`, `aborted`,
`unavailable`, `rate_limited` (local budget) or `invalid_response` (too large). Redirects are refused.

Also exported: `normalizeBaseUrl`, `isPrivateHost` (literals and special names; it does not resolve DNS),
`parseRetryAfter`, `safeProviderText`, `readBounded`, `sleep`.

`retryable` means the request might succeed later. It does not mean repeating a write is safe.
