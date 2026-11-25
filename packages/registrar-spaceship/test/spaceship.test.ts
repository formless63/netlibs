/**
 * Spaceship normalization and client paths with a stub fetch (no network).
 * Fixtures are synthetic answers for RFC 2606 names.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  SpaceshipError,
  createSpaceshipRegistrar,
  normalizeSpaceshipDomain,
  pickSpaceshipRenewalPrice,
} from "../src/index.ts";
import type { FetchLike } from "@formless63/provider-http";
import { assertRegistrarConformance } from "@formless63/registrar/testing";

const BASE = "https://api.example.invalid/v1";
const KEY = "synthetic-key-value-0001";
const SECRET = "synthetic-secret-value-0001";

function fixture(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

const PAGE1 = fixture("domains-page1.json") as { items: unknown[]; total: number };
const PAGE2 = fixture("domains-page2.json");
const PRICING = fixture("pricing.json");
const PRICING_ERROR = fixture("pricing-error.json");

type Route = { status: number; body?: unknown; text?: string };

function stub(routes: Record<string, Route>) {
  const calls: Array<{ url: string; headers: Record<string, string>; redirect: string }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, headers: init.headers, redirect: init.redirect });
    const route = routes[url.slice(BASE.length)];
    if (!route) return { status: 404, text: async () => JSON.stringify({ detail: "Not found" }) };
    return {
      status: route.status,
      text: async () => route.text ?? JSON.stringify(route.body ?? null),
    };
  };
  return { impl, calls };
}

function client(
  routes: Record<string, Route>,
  extra: Partial<Parameters<typeof createSpaceshipRegistrar>[0]> = {},
) {
  const s = stub(routes);
  const sleeps: number[] = [];
  const c = createSpaceshipRegistrar({
    apiKey: KEY,
    apiSecret: SECRET,
    baseUrl: BASE,
    fetch: s.impl,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { c, calls: s.calls, sleeps };
}

async function caught(promise: Promise<unknown>): Promise<SpaceshipError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(SpaceshipError);
    const e = error as SpaceshipError;
    expect(e.message).not.toContain(KEY);
    expect(e.message).not.toContain(SECRET);
    return e;
  }
  throw new Error("expected a SpaceshipError");
}

describe("normalizeSpaceshipDomain", () => {
  it("maps every field and drops contacts", () => {
    const record = normalizeSpaceshipDomain(PAGE1.items[0], { amount: "10.98", currency: "USD" });
    expect(record).toEqual({
      name: "example.com",
      registeredOn: "2021-03-04",
      expiresOn: "2027-03-04",
      autoRenew: true,
      privacy: true,
      transferLock: true,
      nameservers: ["ns1.example.net", "ns2.example.net"],
      status: ["client delete prohibited", "client transfer prohibited"],
      renewalPrice: { amount: "10.98", currency: "USD" },
      usesRegistrarDns: true,
      expired: false,
      lifecycle: "registered",
      premium: false,
    });
    expect(JSON.stringify(record)).not.toContain("contact");
  });

  it("maps public privacy, custom DNS, no lock, expired lifecycle and UTC dates", () => {
    const record = normalizeSpaceshipDomain(PAGE1.items[1]);
    expect(record).toMatchObject({
      name: "example.net",
      registeredOn: "2019-12-31",
      expiresOn: "2026-12-31",
      autoRenew: false,
      privacy: false,
      transferLock: false,
      nameservers: ["ns.example.org"],
      status: [],
      renewalPrice: null,
      usesRegistrarDns: false,
      expired: true,
      lifecycle: "expired",
      premium: true,
    });
  });

  it("says unknown (null) for absent fields", () => {
    const record = normalizeSpaceshipDomain({ name: "example.org." });
    expect(record).toEqual({
      name: "example.org",
      registeredOn: null,
      expiresOn: null,
      autoRenew: null,
      privacy: null,
      transferLock: null,
      nameservers: [],
      status: [],
      renewalPrice: null,
      usesRegistrarDns: null,
      expired: null,
      lifecycle: null,
      premium: null,
    });
  });

  it("rejects items that are not domains", () => {
    expect(() => normalizeSpaceshipDomain({ nope: 1 })).toThrow(SpaceshipError);
    expect(() => normalizeSpaceshipDomain({ name: "not a domain" })).toThrow(/valid name/);
  });

});

describe("pickSpaceshipRenewalPrice", () => {
  it("takes the 1-year renew final price, upper-casing the currency", () => {
    expect(pickSpaceshipRenewalPrice(PRICING)).toEqual({ amount: "10.98", currency: "USD" });
  });

  it("falls back to the first renew entry", () => {
    const payload = {
      prices: {
        renew: [
          {
            period: { value: 3, unit: "y" },
            priceInDefaultCurrency: { finalPrice: { amount: 30, currency: "EUR" } },
          },
        ],
      },
    };
    expect(pickSpaceshipRenewalPrice(payload)).toEqual({ amount: "30", currency: "EUR" });
  });

  it("is null for an errorCode, no renew entry, or a malformed amount", () => {
    expect(pickSpaceshipRenewalPrice(PRICING_ERROR)).toBeNull();
    expect(pickSpaceshipRenewalPrice({ prices: { renew: [] } })).toBeNull();
    const bad = (amount: string, currency = "USD") => ({
      prices: {
        renew: [
          {
            period: { value: 1, unit: "y" },
            priceInDefaultCurrency: { finalPrice: { amount, currency } },
          },
        ],
      },
    });
    expect(pickSpaceshipRenewalPrice(bad("10.987"))).toBeNull();
    expect(pickSpaceshipRenewalPrice(bad("-1"))).toBeNull();
    expect(pickSpaceshipRenewalPrice(bad("1e3"))).toBeNull();
    expect(pickSpaceshipRenewalPrice(bad("10.98", "US"))).toBeNull();
  });
});

describe("createSpaceshipRegistrar", () => {
  const listRoutes: Record<string, Route> = {
    "/domains?take=100&skip=0": { status: 200, body: PAGE1 },
    "/domains?take=100&skip=2": { status: 200, body: PAGE2 },
    "/domains/example.com/pricing": { status: 200, body: PRICING },
    "/domains/example.net/pricing": { status: 200, body: PRICING_ERROR },
  };

  it("paginates the list, prices each domain and paces pricing calls", async () => {
    const { c, calls, sleeps } = client(listRoutes, { pricingPauseMs: 7 });
    const records = await c.listDomains();
    expect(records.map((r) => r.name)).toEqual(["example.com", "example.net", "example.org"]);
    expect(records[0]).toMatchObject({ renewalPrice: { amount: "10.98", currency: "USD" } });
    expect(records[1]).toMatchObject({ renewalPrice: null });
    // example.org has no pricing route: a 404 price is null, not a failure.
    expect(records[2]).toMatchObject({
      renewalPrice: null,
      usesRegistrarDns: true,
      expired: false,
    });
    expect(calls.map((x) => x.url.slice(BASE.length))).toEqual([
      "/domains?take=100&skip=0",
      "/domains?take=100&skip=2",
      "/domains/example.com/pricing",
      "/domains/example.net/pricing",
      "/domains/example.org/pricing",
    ]);
    expect(sleeps).toEqual([7, 7]);
  });

  it("stops on an empty page even when total says more", async () => {
    const { c, calls } = client(
      {
        "/domains?take=100&skip=0": { status: 200, body: { items: [PAGE1.items[0]], total: 50 } },
        "/domains?take=100&skip=1": { status: 200, body: { items: [], total: 50 } },
      },
      { withPricing: false },
    );
    expect((await c.listDomains()).map((r) => r.name)).toEqual(["example.com"]);
    expect(calls).toHaveLength(2);
  });

  it("refuses an account above the 5000-domain cap", async () => {
    const { c } = client({
      "/domains?take=100&skip=0": { status: 200, body: { items: [], total: 5001 } },
    });
    expect((await caught(c.listDomains())).kind).toBe("invalid_response");
  });

  it("sends the API key and secret as headers and refuses redirects", async () => {
    const { c, calls } = client({
      "/domains?take=1&skip=0": { status: 200, body: { items: [], total: 12 } },
    });
    expect(await c.probe()).toEqual({ domains: 12 });
    expect(calls).toHaveLength(1);
    const sent = calls[0]!;
    expect(sent.url).toBe(`${BASE}/domains?take=1&skip=0`);
    expect(sent.headers["X-Api-Key"] === KEY).toBe(true);
    expect(sent.headers["X-Api-Secret"] === SECRET).toBe(true);
    expect(sent.redirect).toBe("error");
    expect(sent.url.includes(KEY) || sent.url.includes(SECRET)).toBe(false);
  });

  it("gets one domain and its price", async () => {
    const { c, calls } = client({
      "/domains/example.com": { status: 200, body: PAGE1.items[0] },
      "/domains/example.com/pricing": { status: 200, body: PRICING },
    });
    const record = await c.getDomain("EXAMPLE.com.");
    expect(record).toMatchObject({
      name: "example.com",
      renewalPrice: { amount: "10.98", currency: "USD" },
      transferLock: true,
    });
    expect(calls).toHaveLength(2);
    expect(await c.getRenewalPrice("example.com")).toEqual({ amount: "10.98", currency: "USD" });
  });

  it("refuses an invalid domain name without calling out", async () => {
    const { c, calls } = client({});
    expect((await caught(c.getDomain("../domains"))).kind).toBe("invalid_input");
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "unauthorized", /HTTP 401/],
    [403, "forbidden", /domains:read scope/],
    [404, "not_found", /HTTP 404/],
    [429, "rate_limited", /rate limiting/],
    [500, "unavailable", /HTTP 500/],
  ])("classifies HTTP %i as %s and includes the server detail", async (status, kind, pattern) => {
    const { c } = client({
      "/domains/example.com": { status, body: { detail: `server says ${status}` } },
    });
    const error = await caught(c.getDomain("example.com"));
    expect(error.kind).toBe(kind as never);
    expect(error.status).toBe(status);
    expect(error.message).toMatch(pattern);
    expect(error.message).toContain(`server says ${status}`);
  });

  it("truncates a long server detail to 200 characters", async () => {
    const { c } = client({
      "/domains?take=1&skip=0": { status: 500, body: { detail: "x".repeat(500) } },
    });
    const error = await caught(c.probe());
    expect(error.message).toContain(`${"x".repeat(200)}…`);
    expect(error.message).not.toContain("x".repeat(201));
  });

  it("rejects non-JSON, misshapen and oversize answers as invalid_response", async () => {
    const bad = client({ "/domains?take=1&skip=0": { status: 200, text: "<html>" } });
    expect((await caught(bad.c.probe())).kind).toBe("invalid_response");
    const shape = client({ "/domains?take=1&skip=0": { status: 200, body: { items: "no" } } });
    expect((await caught(shape.c.probe())).kind).toBe("invalid_response");
    const big = client({ "/domains?take=1&skip=0": { status: 200, text: " ".repeat(1_000_001) } });
    const error = await caught(big.c.probe());
    expect(error.kind).toBe("invalid_response");
    expect(error.message).toMatch(/too large/);
  });

  it("times out with a null status", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const c = createSpaceshipRegistrar({
      apiKey: KEY,
      apiSecret: SECRET,
      baseUrl: BASE,
      fetch: hang,
      timeoutMs: 10,
    });
    const error = await caught(c.probe());
    expect(error.kind).toBe("timeout");
    expect(error.status).toBeNull();
    expect(error.message).toMatch(/within 10 ms/);
  });

  it("maps a network failure to unavailable without echoing the cause", async () => {
    const fail: FetchLike = async () => {
      throw new Error(`connect failed with ${KEY}`);
    };
    const c = createSpaceshipRegistrar({ apiKey: KEY, apiSecret: SECRET, baseUrl: BASE, fetch: fail });
    const error = await caught(c.probe());
    expect(error).toMatchObject({ kind: "unavailable", status: null });
  });

  it("propagates auth failures from pricing during a list", async () => {
    const { c } = client({
      "/domains?take=100&skip=0": { status: 200, body: { items: [PAGE1.items[0]], total: 1 } },
      "/domains/example.com/pricing": { status: 403, body: { detail: "Forbidden" } },
    });
    expect((await caught(c.listDomains())).kind).toBe("forbidden");
  });

  it("enforces https unless loopback http is explicitly allowed", () => {
    const base = { apiKey: KEY, apiSecret: SECRET };
    expect(() =>
      createSpaceshipRegistrar({ ...base, baseUrl: "http://api.example.invalid/v1" }),
    ).toThrow(/must use https/);
    expect(() => createSpaceshipRegistrar({ ...base, baseUrl: "http://127.0.0.1:8080/v1" })).toThrow(
      /must use https/,
    );
    expect(() =>
      createSpaceshipRegistrar({
        ...base,
        baseUrl: "http://127.0.0.1:8080/v1",
        allowLoopbackHttp: true,
      }),
    ).not.toThrow();
    expect(() =>
      createSpaceshipRegistrar({
        ...base,
        baseUrl: "http://api.example.invalid/v1",
        allowLoopbackHttp: true,
      }),
    ).toThrow(/must use https/);
    expect(() => createSpaceshipRegistrar(base)).not.toThrow();
  });

  it("rejects missing or header-breaking credentials without echoing them", () => {
    expect(() => createSpaceshipRegistrar({ apiKey: "", apiSecret: SECRET })).toThrow(
      /API key is missing/,
    );
    try {
      createSpaceshipRegistrar({ apiKey: KEY, apiSecret: `${SECRET}\r\nX-Evil: 1` });
      throw new Error("expected a throw");
    } catch (error) {
      expect((error as Error).message).toMatch(/API secret/);
      expect((error as Error).message).not.toContain(SECRET);
    }
  });

  it("honours the registrar contract", async () => {
    const { c } = client({ ...listRoutes, "/domains/example.com": { status: 200, body: PAGE1.items[0] } }, { pricingPauseMs: 0 });
    await assertRegistrarConformance(c, { knownDomain: "example.com" });
  });

  it("redacts credentials the server echoes", async () => {
    const { c } = client({ "/domains?take=1&skip=0": { status: 400, body: { detail: `bad key ${KEY} / ${encodeURIComponent(SECRET)}` } } });
    expect((await caught(c.probe())).message).toContain("[redacted]");
  });

  it("stops when the caller aborts", async () => {
    const { c } = client(listRoutes);
    const error = await caught(c.listDomains({ signal: AbortSignal.abort() }));
    expect(error.kind).toBe("aborted");
  });
});
