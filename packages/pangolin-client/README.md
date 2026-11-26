# @formless63/pangolin-client

A typed client for the [Pangolin](https://github.com/fosrl/pangolin) Integration API.

```ts
const pangolin = createPangolinClient({ baseUrl: "https://pangolin-api.example.com", apiKeyId, apiKeySecret, orgId });
const resources = await pangolin.listResources();
```

- `baseUrl` is the Integration API's own origin (a separate server, usually port 3003), not the dashboard.
- Reads: orgs, sites, resources, targets, rules, domains, DNS records. Lists are read to the end, or fail: a
  list that never ends, or a server that ignores paging and repeats rows, is an error, not a partial list.
  `probe` counts every site (or org), not just the first page.
- Writes: create resource, target and rule; update rule. **Creates are not idempotent**: read back before
  repeating one that failed ambiguously. Nothing is ever deleted.
- An update must send the whole rule; omitting `priority` would reorder evaluation.
- Every answer's envelope is checked, because HTTP 200 does not imply success.

Paths, verbs and paging were checked against Pangolin's source; not run against a live instance.
