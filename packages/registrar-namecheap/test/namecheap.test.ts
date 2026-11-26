/**
 * Namecheap normalization and client paths with a stub fetch (no network).
 * Fixtures are synthetic XML answers for RFC 2606 names; the client IP is
 * an RFC 5737 documentation address.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  NAMECHEAP_API_URL,
  NAMECHEAP_SANDBOX_API_URL,
  NamecheapError,
  createNamecheapRegistrar,
  namecheapDate,
  type NamecheapOptions,
} from "../src/index.ts";
import type { FetchLike } from "@formless63/provider-http";
import { assertRegistrarConformance } from "@formless63/registrar/testing";

const BASE = "https://api.example.invalid/xml.response";
const KEY = "synthetic-key-value-0001";
const IP = "192.0.2.10";

function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
}

type Route = { status?: number; text: string };
type Call = { url: string; params: URLSearchParams; redirect: string };

/** Routes keyed by `Command` or `Command Page` / `Command DomainName`. */
function stub(route: (params: URLSearchParams) => Route | undefined) {
  const calls: Call[] = [];
  const impl: FetchLike = async (url, init) => {
    const params = new URL(url).searchParams;
    calls.push({ url, params, redirect: init.redirect });
    const r = route(params) ?? { status: 200, text: fixture("error-notfound.xml") };
    return { status: r.status ?? 200, text: async () => r.text };
  };
  return { impl, calls };
}

function client(
  route: (params: URLSearchParams) => Route | undefined,
  extra: Partial<NamecheapOptions> = {},
) {
  const s = stub(route);
  const sleeps: number[] = [];
  const c = createNamecheapRegistrar({
    apiUser: "owner",
    apiKey: KEY,
    userName: "owner",
    clientIp: IP,
    baseUrl: BASE,
    fetch: s.impl,
    pauseMs: 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...extra,
  });
  return { c, calls: s.calls, sleeps };
}

const listRoute = (params: URLSearchParams): Route | undefined => {
  const command = params.get("Command");
  if (command === "namecheap.domains.getList") {
    return {
      text: fixture(params.get("Page") === "1" ? "getlist-page1.xml" : "getlist-page2.xml"),
    };
  }
  if (command === "namecheap.domains.getInfo" && params.get("DomainName") === "example.com") {
    return { text: fixture("getinfo.xml") };
  }
  return undefined;
};

async function caught(promise: Promise<unknown>): Promise<NamecheapError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NamecheapError);
    const e = error as NamecheapError;
    expect(e.message).not.toContain(KEY);
    expect(String(e.stack)).not.toContain(KEY);
    expect(JSON.stringify(e)).not.toContain(KEY);
    return e;
  }
  throw new Error("expected a NamecheapError");
}

describe("namecheapDate", () => {
  it("turns MM/DD/YYYY into an ISO date and rejects impossible dates", () => {
    expect(namecheapDate("02/15/2016")).toBe("2016-02-15");
    expect(namecheapDate("2/5/2016")).toBe("2016-02-05");
    expect(namecheapDate("02/30/2016")).toBeNull();
    expect(namecheapDate("2016-02-15")).toBeNull();
    expect(namecheapDate(null)).toBeNull();
  });
});

describe("createNamecheapRegistrar", () => {
  it("paginates getList, enriches with getInfo nameservers, and normalizes every field", async () => {
    const { c, calls } = client(listRoute);
    const records = await c.listDomains();
    expect(records).toEqual([
      {
        name: "example.com",
        registeredOn: "2016-02-15",
        expiresOn: "2027-02-15",
        autoRenew: false,
        privacy: true,
        transferLock: true,
        nameservers: ["ns1.example.net", "ns2.example.net"],
        status: [],
        renewalPrice: null,
        // getInfo's IsUsingOurDNS (false) wins over getList's IsOurDNS.
        usesRegistrarDns: false,
        expired: false,
        lifecycle: "active",
        premium: false,
      },
      {
        name: "example.net",
        registeredOn: "2019-12-31",
        expiresOn: "2026-01-01",
        autoRenew: true,
        privacy: false,
        transferLock: false,
        nameservers: [],
        status: [],
        renewalPrice: null,
        usesRegistrarDns: false,
        expired: true,
        lifecycle: "expired",
        premium: true,
      },
      {
        name: "example.org",
        registeredOn: null,
        expiresOn: "2027-06-30",
        autoRenew: true,
        privacy: null,
        transferLock: false,
        nameservers: [],
        status: [],
        renewalPrice: null,
        usesRegistrarDns: true,
        expired: false,
        lifecycle: "active",
        premium: false,
      },
    ]);
    const summary = calls.map(
      (x) => `${x.params.get("Command")} ${x.params.get("Page") ?? x.params.get("DomainName")}`,
    );
    expect(summary).toEqual([
      "namecheap.domains.getList 1",
      "namecheap.domains.getList 2",
      "namecheap.domains.getInfo example.com",
      "namecheap.domains.getInfo example.net",
      "namecheap.domains.getInfo example.org",
    ]);
    expect(calls[0]!.params.get("PageSize")).toBe("100");
    expect(calls[0]!.params.get("ListType")).toBe("ALL");
  });

  it("sends the global parameters on every request and refuses redirects", async () => {
    const { c, calls } = client(listRoute, { withNameservers: false });
    await c.listDomains();
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.url.startsWith(`${BASE}?`)).toBe(true);
      expect(call.params.get("ApiUser")).toBe("owner");
      expect(call.params.get("UserName")).toBe("owner");
      expect(call.params.get("ClientIp")).toBe(IP);
      expect(call.params.get("ApiKey") === KEY).toBe(true);
      expect(call.redirect).toBe("error");
    }
  });

  it("paces requests with the injected sleep", async () => {
    const { c, sleeps } = client(listRoute, { pauseMs: 3500 });
    await c.listDomains();
    // Five requests: four pauses, none before the first.
    expect(sleeps).toEqual([3500, 3500, 3500, 3500]);
  });

  it("gets one domain from getInfo", async () => {
    const { c } = client(listRoute);
    expect(await c.getDomain("EXAMPLE.com.")).toMatchObject({
      name: "example.com",
      registeredOn: "2016-02-15",
      expiresOn: "2027-02-15",
      privacy: true,
      autoRenew: null,
      transferLock: null,
      nameservers: ["ns1.example.net", "ns2.example.net"],
      usesRegistrarDns: false,
      expired: false,
      lifecycle: "active",
      premium: false,
      renewalPrice: null,
    });
    expect((await caught(c.getDomain("not a domain"))).kind).toBe("invalid_input");
  });

  it("probes with one small getList", async () => {
    const { c, calls } = client(listRoute);
    expect(await c.probe()).toEqual({ domains: 3 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.params.get("PageSize")).toBe("10");
    expect(calls[0]!.params.get("Page")).toBe("1");
  });

  it("refuses an account above the 5000-domain cap", async () => {
    const big = fixture("getlist-page1.xml").replace(
      "<TotalItems>3</TotalItems>",
      "<TotalItems>5001</TotalItems>",
    );
    const { c } = client(() => ({ text: big }));
    expect((await caught(c.listDomains())).kind).toBe("invalid_response");
  });

  it.each([
    ["error-ip.xml", "forbidden", "ip_not_whitelisted", "1011150", /Profile → Tools → API Access.*clientIp/],
    ["error-key.xml", "unauthorized", null, "1011102", /API credentials/],
    ["error-disabled.xml", "forbidden", "api_disabled", "1011103", /not enabled/],
    ["error-notfound.xml", "not_found", null, "2019166", /no such domain/],
    ["error-ratelimit.xml", "rate_limited", null, "500000", /rate limiting/],
    ["error-other.xml", "unavailable", null, "3050900", /Unknown response/],
  ])("classifies %s as %s and keeps the provider number", async (file, kind, code, number, pattern) => {
    const { c } = client(() => ({ text: fixture(file) }));
    const error = await caught(c.probe());
    expect(error.kind).toBe(kind as never);
    expect(error.code).toBe(code as never);
    expect(error.providerCode).toBe(number);
    expect(error.message).toMatch(pattern);
  });

  it("redacts the API key if the provider echoes it", async () => {
    const echo = fixture("error-key.xml").replace(
      "Parameter APIKey is invalid",
      `Parameter APIKey ${KEY} is invalid`,
    );
    const { c } = client(() => ({ text: echo }));
    const error = await caught(c.probe());
    expect(error.message).toContain("[redacted]");
  });

  it("maps HTTP 429, other HTTP errors, bad XML, DOCTYPE and oversize answers", async () => {
    expect((await caught(client(() => ({ status: 429, text: "" })).c.probe())).kind).toBe(
      "rate_limited",
    );
    const http500 = await caught(client(() => ({ status: 503, text: "<html>busy" })).c.probe());
    expect(http500).toMatchObject({ kind: "unavailable", status: 503 });
    expect((await caught(client(() => ({ text: "not xml" })).c.probe())).kind).toBe(
      "invalid_response",
    );
    const xxe = `<?xml version="1.0"?><!DOCTYPE ApiResponse [<!ENTITY x SYSTEM "file:///etc/hostname">]><ApiResponse Status="OK">&x;</ApiResponse>`;
    expect((await caught(client(() => ({ text: xxe })).c.probe())).kind).toBe("invalid_response");
    expect((await caught(client(() => ({ text: "<Other/>" })).c.probe())).kind).toBe(
      "invalid_response",
    );
    const big = await caught(client(() => ({ text: " ".repeat(1_000_001) })).c.probe());
    expect(big).toMatchObject({ kind: "invalid_response", status: 200 });
    expect(big.message).toMatch(/too large/);
    const bigRefusal = await caught(client(() => ({ status: 503, text: " ".repeat(1_000_001) })).c.probe());
    expect(bigRefusal).toMatchObject({ kind: "unavailable", status: 503 });
    const bigLimit = await caught(client(() => ({ status: 429, text: " ".repeat(1_000_001) })).c.probe());
    expect(bigLimit).toMatchObject({ kind: "rate_limited", status: 429 });
    const noPaging = fixture("getlist-page1.xml").replace(/<Paging>.*<\/Paging>/, "");
    expect((await caught(client(() => ({ text: noPaging })).c.probe())).kind).toBe(
      "invalid_response",
    );
  });

  it("times out and fails to connect with a null status, never echoing the URL", async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
    const base = {
      apiUser: "owner",
      apiKey: KEY,
      userName: "owner",
      clientIp: IP,
      baseUrl: BASE,
      pauseMs: 0,
    };
    const timeout = await caught(
      createNamecheapRegistrar({ ...base, fetch: hang, timeoutMs: 10 }).probe(),
    );
    expect(timeout).toMatchObject({ kind: "timeout", status: null });
    expect(timeout.message).toMatch(/within 10 ms/);
    const fail: FetchLike = async (url) => {
      throw new TypeError(`fetch failed for ${url}`);
    };
    const unreachable = await caught(createNamecheapRegistrar({ ...base, fetch: fail }).probe());
    expect(unreachable).toMatchObject({ kind: "unavailable", status: null });
  });

  it("propagates errors other than not_found while enriching", async () => {
    const { c } = client((params) =>
      params.get("Command") === "namecheap.domains.getInfo"
        ? { text: fixture("error-ip.xml") }
        : listRoute(params),
    );
    expect((await caught(c.listDomains())).code).toBe("ip_not_whitelisted");
  });

  it("validates options without echoing them", () => {
    const base = { apiUser: "owner", apiKey: KEY, userName: "owner", clientIp: IP };
    for (const clientIp of ["192.0.2", "192.0.2.256", "2001:db8::1", "192.0.2.010", " "]) {
      try {
        createNamecheapRegistrar({ ...base, clientIp });
        throw new Error("expected a throw");
      } catch (error) {
        expect(error).toBeInstanceOf(NamecheapError);
        expect((error as Error).message).toMatch(/clientIp/);
        expect((error as Error).message).not.toContain(KEY);
      }
    }
    expect(() => createNamecheapRegistrar({ ...base, apiKey: "" })).toThrow(/apiKey/);
  });

  it("enforces https unless loopback http is explicitly allowed, and picks the sandbox", async () => {
    const base = { apiUser: "owner", apiKey: KEY, userName: "owner", clientIp: IP };
    expect(() =>
      createNamecheapRegistrar({ ...base, baseUrl: "http://api.example.invalid/xml.response" }),
    ).toThrow(/must use https/);
    expect(() =>
      createNamecheapRegistrar({ ...base, baseUrl: "http://127.0.0.1:9/xml.response" }),
    ).toThrow(/must use https/);
    expect(() =>
      createNamecheapRegistrar({
        ...base,
        baseUrl: "http://127.0.0.1:9/xml.response",
        allowLoopbackHttp: true,
      }),
    ).not.toThrow();
    const urls: string[] = [];
    const record: FetchLike = async (url) => {
      urls.push(url);
      return { status: 200, text: async () => fixture("getlist-page1.xml") };
    };
    await createNamecheapRegistrar({ ...base, sandbox: true, fetch: record }).probe();
    await createNamecheapRegistrar({ ...base, fetch: record }).probe();
    expect(urls[0]!.startsWith(`${NAMECHEAP_SANDBOX_API_URL}?`)).toBe(true);
    expect(urls[1]!.startsWith(`${NAMECHEAP_API_URL}?`)).toBe(true);
  });

  it("honours the registrar contract", async () => {
    await assertRegistrarConformance(client(listRoute).c, { knownDomain: "example.com" });
  });
});
