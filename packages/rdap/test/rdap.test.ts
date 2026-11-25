/**
 * RDAP normalization and the lookup path, with a stub fetch (no network).
 * Fixtures are synthetic RFC 9083 objects for RFC 2606 names.
 */
import { describe, expect, it } from "bun:test";
import type { FetchLike } from "@formless63/provider-http";
import { RdapError, createRdapClient, normalizeRdapDomain, rdapBaseUrl } from "../src/index.ts";

const BOOTSTRAP = {
  version: "1.0",
  services: [
    [["example", "test"], ["http://rdap.example.invalid/v1/", "https://rdap.example.invalid/v1/"]],
    [["co.example"], ["https://rdap-co.example.invalid/"]],
  ],
};

function domainObject(overrides: Record<string, unknown> = {}) {
  return {
    objectClassName: "domain",
    ldhName: "SAMPLE.EXAMPLE",
    status: ["client transfer prohibited", "Client Transfer Prohibited"],
    events: [
      { eventAction: "registration", eventDate: "2020-08-08T15:00:00Z" },
      { eventAction: "expiration", eventDate: "2027-08-08T15:00:00Z" },
      { eventAction: "last changed", eventDate: "2026-07-09T01:02:03Z" },
    ],
    nameservers: [{ ldhName: "NS2.DNS.EXAMPLE." }, { ldhName: "ns1.dns.example" }],
    secureDNS: { delegationSigned: false },
    entities: [
      {
        roles: ["registrar"],
        publicIds: [{ type: "IANA Registrar ID", identifier: "9999" }],
        vcardArray: ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar, Inc."]]],
      },
      {
        roles: ["registrant"],
        vcardArray: ["vcard", [["fn", {}, "text", "REDACTED FOR PRIVACY"]]],
      },
    ],
    ...overrides,
  };
}

function stub(routes: Record<string, { status: number; body?: unknown; text?: string }>) {
  const calls: string[] = [];
  const impl: FetchLike = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) return { status: 404, text: async () => "" };
    return { status: route.status, url, text: async () => route.text ?? JSON.stringify(route.body ?? null) };
  };
  return { impl, calls };
}

describe("normalizeRdapDomain", () => {
  it("keeps registrar, IANA id, dates, status, nameservers, DNSSEC and privacy", () => {
    const facts = normalizeRdapDomain(domainObject(), "https://rdap.example.invalid/v1/domain/sample.example");
    expect(facts).toEqual({
      name: "sample.example",
      url: "https://rdap.example.invalid/v1/domain/sample.example",
      registrar: "Example Registrar, Inc.",
      registrarIanaId: "9999",
      registeredOn: "2020-08-08",
      expiresOn: "2027-08-08",
      lastChangedOn: "2026-07-09",
      status: ["client transfer prohibited"],
      nameservers: ["ns1.dns.example", "ns2.dns.example"],
      dnssec: false,
      privacy: true,
    });
  });

  it("says unknown, not false, when there is no registrant and no remark", () => {
    const facts = normalizeRdapDomain(
      domainObject({ entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "R"]]] }], secureDNS: undefined }),
      "u",
    );
    expect(facts.privacy).toBeNull();
    expect(facts.dnssec).toBeNull();
    expect(facts.registrarIanaId).toBeNull();
  });

  it("finds a registrar nested under another entity", () => {
    const facts = normalizeRdapDomain(
      domainObject({
        entities: [{ roles: ["reseller"], entities: [{ roles: ["registrar"], vcardArray: ["vcard", [["fn", {}, "text", "Nested"]]] }] }],
      }),
      "u",
    );
    expect(facts.registrar).toBe("Nested");
  });

  it("rejects something that is not a domain object", () => {
    expect(() => normalizeRdapDomain({ objectClassName: "entity" }, "u")).toThrow(RdapError);
    expect(() => normalizeRdapDomain("nope", "u")).toThrow(/domain object/);
  });
});

describe("rdapBaseUrl", () => {
  it("prefers https and the longest suffix", () => {
    expect(rdapBaseUrl(BOOTSTRAP, "sample.example")).toBe("https://rdap.example.invalid/v1/");
    expect(rdapBaseUrl(BOOTSTRAP, "shop.co.example")).toBe("https://rdap-co.example.invalid/");
    expect(rdapBaseUrl(BOOTSTRAP, "sample.invalid")).toBeNull();
  });
});

describe("createRdapClient", () => {
  const BOOT = "https://bootstrap.example.invalid/dns.json";

  it("reads the bootstrap once and one query per domain", async () => {
    const { impl, calls } = stub({
      [BOOT]: { status: 200, body: BOOTSTRAP },
      "https://rdap.example.invalid/v1/domain/sample.example": { status: 200, body: domainObject() },
      "https://rdap.example.invalid/v1/domain/other.example": {
        status: 200,
        body: domainObject({ ldhName: "other.example" }),
      },
    });
    const client = createRdapClient({ fetch: impl, bootstrapUrl: BOOT });
    expect((await client.lookup("Sample.Example.")).expiresOn).toBe("2027-08-08");
    expect((await client.lookup("other.example")).name).toBe("other.example");
    expect(calls).toEqual([
      BOOT,
      "https://rdap.example.invalid/v1/domain/sample.example",
      "https://rdap.example.invalid/v1/domain/other.example",
    ]);
  });

  it("classifies 404, 429, an unknown TLD and bad input", async () => {
    const { impl } = stub({
      [BOOT]: { status: 200, body: BOOTSTRAP },
      "https://rdap.example.invalid/v1/domain/busy.example": { status: 429, text: "slow down" },
    });
    const client = createRdapClient({ fetch: impl, bootstrapUrl: BOOT });
    await expect(client.lookup("missing.example")).rejects.toMatchObject({ kind: "not_found" });
    await expect(client.lookup("busy.example")).rejects.toMatchObject({ kind: "rate_limited" });
    await expect(client.lookup("sample.invalid")).rejects.toMatchObject({ kind: "not_found", code: "unsupported_tld" });
    await expect(client.lookup("not a domain")).rejects.toMatchObject({ kind: "invalid_input" });
  });

  it("refuses plain http unless it is loopback and allowed", async () => {
    const { impl } = stub({});
    await expect(
      createRdapClient({ fetch: impl, bootstrapUrl: "http://bootstrap.example.invalid/dns.json" }).lookup("a.example"),
    ).rejects.toMatchObject({ kind: "invalid_input" });
    const local = stub({
      "http://127.0.0.1:9/dns.json": { status: 200, body: { services: [[["example"], ["http://127.0.0.1:9/rdap/"]]] } },
      "http://127.0.0.1:9/rdap/domain/a.example": { status: 200, body: domainObject({ ldhName: "a.example" }) },
    });
    const client = createRdapClient({ fetch: local.impl, bootstrapUrl: "http://127.0.0.1:9/dns.json", allowLoopbackHttp: true });
    expect((await client.lookup("a.example")).name).toBe("a.example");
  });

  it("never returns more than the normalized facts", async () => {
    const { impl } = stub({
      [BOOT]: { status: 200, body: BOOTSTRAP },
      "https://rdap.example.invalid/v1/domain/sample.example": {
        status: 200,
        body: domainObject({ notices: [{ title: "zzz-raw-notice-marker-zzz" }] }),
      },
    });
    const facts = await createRdapClient({ fetch: impl, bootstrapUrl: BOOT }).lookup("sample.example");
    expect(JSON.stringify(facts)).not.toContain("zzz-raw-notice-marker-zzz");
  });
});

describe("privacy", () => {
  it("treats a blank registrant name or an RFC 9537 marker as redacted", () => {
    const blank = normalizeRdapDomain(
      domainObject({ entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", ""]]] }] }),
      "u",
    );
    expect(blank.privacy).toBe(true);
    const marked = normalizeRdapDomain(
      domainObject({ entities: [], redacted: [{ name: { type: "Registrant Name" } }] }),
      "u",
    );
    expect(marked.privacy).toBe(true);
    const named = normalizeRdapDomain(
      domainObject({ entities: [{ roles: ["registrant"], vcardArray: ["vcard", [["fn", {}, "text", "Example Person"]]] }] }),
      "u",
    );
    expect(named.privacy).toBe(false);
  });
});

describe("safety", () => {
  const BOOT = "https://bootstrap.example.invalid/dns.json";
  const DOMAIN_URL = "https://rdap.example.invalid/v1/domain/sample.example";
  type Reply = { status: number; location?: string; body?: unknown; text?: string; length?: number };
  function client(route: (url: string) => Reply, extra: Parameters<typeof createRdapClient>[0] = {}) {
    const calls: string[] = [];
    const fetch: FetchLike = async (url) => {
      calls.push(url);
      const reply = url === BOOT ? { status: 200, body: BOOTSTRAP } : route(url);
      return new Response(reply.status === 204 ? null : (reply.text ?? JSON.stringify(reply.body ?? null)), {
        status: reply.status,
        headers: {
          ...(reply.location ? { location: reply.location } : {}),
          ...(reply.length ? { "content-length": String(reply.length) } : {}),
        },
      });
    };
    return { calls, client: createRdapClient({ fetch, bootstrapUrl: BOOT, ...extra }) };
  }

  it("follows a redirect to another public https host and reports the final URL", async () => {
    const { client: c } = client((url) =>
      url === DOMAIN_URL
        ? { status: 302, location: "https://rdap-2.example.invalid/domain/sample.example" }
        : { status: 200, body: domainObject() },
    );
    expect((await c.lookup("sample.example")).url).toBe("https://rdap-2.example.invalid/domain/sample.example");
  });

  it.each([
    "http://rdap.example.invalid/x",
    "https://127.0.0.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://10.0.0.5/x",
    "https://[::1]/x",
    "https://[fd00::1]/x",
    "https://[::ffff:10.0.0.1]/x",
    "https://metadata.internal/x",
    "https://user:pass@rdap.example.invalid/x",
    "file:///etc/passwd",
  ])("never requests a redirect to %s", async (location) => {
    const { client: c, calls } = client(() => ({ status: 302, location }));
    await expect(c.lookup("sample.example")).rejects.toMatchObject({ code: "refused_redirect" });
    expect(calls).toEqual([BOOT, DOMAIN_URL]);
  });

  it("bounds redirects and response size", async () => {
    const loop = client(() => ({ status: 302, location: DOMAIN_URL }), { maxRedirects: 2 });
    await expect(loop.client.lookup("sample.example")).rejects.toMatchObject({ kind: "invalid_response" });
    expect(loop.calls).toHaveLength(4);
    const big = client(() => ({ status: 200, text: " ".repeat(2000) }), { maxResponseBytes: 1500 });
    await expect(big.client.lookup("sample.example")).rejects.toMatchObject({ kind: "invalid_response" });
  });

  it("aborts, times out, and does not cache a failed bootstrap", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("x"))));
    await expect(createRdapClient({ fetch: hang, timeoutMs: 10 }).lookup("a.example")).rejects.toMatchObject({ kind: "timeout" });
    let attempts = 0;
    const flaky: FetchLike = async (url) => {
      if (url === BOOT) {
        attempts += 1;
        return new Response(attempts === 1 ? "oops" : JSON.stringify(BOOTSTRAP), { status: attempts === 1 ? 503 : 200 });
      }
      return new Response(JSON.stringify(domainObject()));
    };
    const c = createRdapClient({ fetch: flaky, bootstrapUrl: BOOT });
    await expect(c.lookup("sample.example")).rejects.toMatchObject({ kind: "unavailable", status: 503 });
    expect((await c.lookup("sample.example")).name).toBe("sample.example");
    const gone = AbortSignal.abort();
    await expect(c.lookup("sample.example", { signal: gone })).rejects.toMatchObject({ kind: "aborted" });
  });

  it("refreshes the bootstrap after its lifetime", async () => {
    let now = 0;
    const { client: c, calls } = client(() => ({ status: 200, body: domainObject() }), { bootstrapTtlMs: 1000, now: () => now });
    await c.lookup("sample.example");
    now = 500;
    await c.lookup("sample.example");
    now = 2000;
    await c.lookup("sample.example");
    expect(calls.filter((url) => url === BOOT)).toHaveLength(2);
  });

  it("maps EPP wording and internationalized names", async () => {
    expect(normalizeRdapDomain(domainObject({ status: ["ok", "clientHold"] }), "u").status).toEqual(["active", "client hold"]);
    const { client: c, calls } = client(() => ({ status: 200, body: domainObject() }));
    await c.lookup("m\u00fcnchen.example");
    expect(calls[1]).toBe("https://rdap.example.invalid/v1/domain/xn--mnchen-3ya.example");
  });
});
