import { describe, expect, it } from "bun:test";
import {
  compareRegistrations, compareSources, daysUntil, describeChange, dnsProviderMoved, expiryLevel, expiryPhase,
  inferDnsProvider, isDomainName, isTransferLocked, normalizeDomainName, normalizeNameservers, normalizeStatus, statusSignals,
} from "../src/index.ts";

const rdap = {
  registrar: "Example Registrar, Inc.",
  expiresOn: "2027-01-01",
  status: ["client transfer prohibited"],
  nameservers: ["a.ns.cloudflare.com", "b.ns.cloudflare.com"],
};
const base = { ...rdap, registrar: "Example Registrar", status: ["ok"] };

describe("RDAP signals", () => {
  it("normalizes EPP status wording from camelCase and RDAP text alike", () => {
    expect(normalizeStatus("clientHold")).toBe("client hold");
    expect(normalizeStatus("Redemption Period")).toBe("redemption period");
    expect(normalizeStatus("pendingDelete")).toBe("pending delete");
    expect(statusSignals(["clientHold", "pending delete", "redemption period", "ok"])).toEqual([
      "client_hold",
      "redemption_period",
      "pending_delete",
    ]);
    expect(statusSignals(["client transfer prohibited", "auto renew period"])).toEqual([]);
  });

  it("flags a new hold status, a registrar change and a move to another DNS provider", () => {
    const next = {
      ...rdap,
      registrar: "Other Registrar LLC",
      status: ["client transfer prohibited", "client hold"],
      nameservers: ["ns1.domaincontrol.com", "ns2.domaincontrol.com"],
    };
    const changes = compareRegistrations(rdap, next);
    expect(changes.find((c) => c.field === "registrar")?.signals).toEqual(["registrar_changed"]);
    expect(changes.find((c) => c.field === "status")?.signals).toEqual(["client_hold"]);
    expect(changes.find((c) => c.field === "nameservers")?.signals).toEqual(["dns_moved"]);
    expect(describeChange(changes.find((c) => c.field === "status")!)).toContain("Client hold");
  });

  it("does not flag routine changes", () => {
    const renewed = compareRegistrations(rdap, { ...rdap, expiresOn: "2028-01-01" });
    expect(renewed).toEqual([{ field: "expiresOn", before: "2027-01-01", after: "2028-01-01", signals: [] }]);
    // A nameserver swap inside the same provider is not a move.
    const swapped = compareRegistrations(rdap, { ...rdap, nameservers: ["c.ns.cloudflare.com", "d.ns.cloudflare.com"] });
    expect(swapped[0]!.signals).toEqual([]);
    // A status that was already there is not new.
    const held = { ...rdap, status: ["client hold"] };
    expect(compareRegistrations(held, { ...held, status: ["client hold", "client transfer prohibited"] })[0]!.signals).toEqual([]);
  });

  it("treats unrecognized nameserver hosts as moved only when they share no parent domain", () => {
    expect(dnsProviderMoved(["ns1.example.net", "ns2.example.net"], ["ns3.example.net"])).toBe(false);
    expect(dnsProviderMoved(["ns1.example.net"], ["ns1.example.org"])).toBe(true);
    expect(dnsProviderMoved([], ["ns1.example.org"])).toBe(false);
  });
});

describe("expiry", () => {
  it("phases follow the date, and the registry status over the date", () => {
    expect(expiryPhase(10, [])).toBe("upcoming");
    expect(expiryPhase(0, [])).toBe("upcoming");
    expect(expiryPhase(-1, [])).toBe("grace");
    expect(expiryPhase(-45, [])).toBe("grace");
    expect(expiryPhase(-46, [])).toBe("redemption");
    expect(expiryPhase(-81, [])).toBeNull();
    // A gTLD the registry auto-renewed: the date moved forward, nobody paid.
    expect(expiryPhase(340, ["auto renew period"])).toBe("grace");
    expect(expiryPhase(300, ["redemption period"])).toBe("redemption");
    expect(expiryPhase(-90, ["pendingDelete"])).toBe("pending_delete");
    expect(expiryPhase(null, [])).toBeNull();
  });

  it("accepts other lifecycles", () => {
    expect(expiryPhase(-20, [], { graceDays: 10, redemptionEndDays: 15 })).toBeNull();
  });
  it("expiry tones against the windows", () => {
    expect(expiryLevel(null, [60, 30, 7])).toBe("unknown");
    expect(expiryLevel(-1, [60, 30, 7])).toBe("expired");
    expect(expiryLevel(7, [60, 30, 7])).toBe("critical");
    expect(expiryLevel(45, [60, 30, 7])).toBe("warning");
    expect(expiryLevel(61, [60, 30, 7])).toBe("ok");
  });


  it("counts calendar days and rejects impossible dates", () => {
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
    expect(daysUntil("2027-02-30", "2027-01-01")).toBeNull();
    expect(daysUntil(null, "2027-01-01")).toBeNull();
  });
});

describe("names", () => {
  it("normalizes typed names", () => {
    expect(normalizeDomainName(" https://Shop.Example.COM/path ")).toBe("shop.example.com");
    expect(normalizeDomainName("localhost")).toBeNull();
    expect(normalizeDomainName("bad_name.example")).toBeNull();
  });

  it("handles internationalized names and refuses look-alikes of names", () => {
    expect(normalizeDomainName("M\u00dcNCHEN.example")).toBe("xn--mnchen-3ya.example");
    expect(normalizeDomainName("https://shop.example.com?x=1")).toBe("shop.example.com");
    for (const bad of ["1.2.3.44", "a@example.com", "example..com", "-a.example", "exa mple.com", "", ".", "\u00fc@evil.example", `${"a".repeat(64)}.com`]) {
      expect(normalizeDomainName(bad), bad).toBeNull();
    }
    expect(isDomainName("Example.com")).toBe(false);
    expect(normalizeNameservers(["NS2.x.test.", "ns1.x.test", "ns2.x.test", ""])).toEqual(["ns1.x.test", "ns2.x.test"]);
  });
});

describe("DNS providers and change detection", () => {
  it("infers the DNS provider only when every nameserver agrees", () => {
    expect(inferDnsProvider(["a.ns.cloudflare.com", "B.NS.CLOUDFLARE.COM."])).toBe("Cloudflare");
    expect(inferDnsProvider(["ns01.domaincontrol.com"])).toBe("GoDaddy");
    expect(inferDnsProvider(["ns-1.awsdns-01.org"])).toBe("Amazon Route 53");
    expect(inferDnsProvider(["a.ns.cloudflare.com", "ns1.example.net"])).toBeNull();
    expect(inferDnsProvider([])).toBeNull();
  });

  it("drift: nothing on a first look, each moved field after", () => {
    expect(compareRegistrations(null, base)).toEqual([]);
    expect(compareRegistrations(base, { ...base, nameservers: [...base.nameservers].reverse() })).toEqual([]);
    const moved = compareRegistrations(base, { ...base, expiresOn: "2028-01-01", status: ["ok", "client hold"] });
    expect(moved.map((d) => d.field)).toEqual(["expiresOn", "status"]);
    expect(describeChange(moved[0]!)).toBe("Expiry 2027-01-01 → 2028-01-01 (renewed)");
    // A blank expiry in an answer is not reported as a move.
    expect(compareRegistrations(base, { ...base, expiresOn: null })).toEqual([]);
  });


  it("accepts custom provider rules", () => {
    expect(inferDnsProvider(["ns1.acme.test"], [{ pattern: /\.acme\.test$/, provider: "Acme" }])).toBe("Acme");
  });

  it("treats EPP and RDAP spellings of a status as the same", () => {
    expect(compareRegistrations({ ...base, status: ["ok"] }, { ...base, status: ["active"] })).toEqual([]);
    expect(normalizeStatus("linked")).toBe("associated");
    expect(isTransferLocked(["clientTransferProhibited"])).toBe(true);
    expect(isTransferLocked([])).toBeNull();
  });

  it("cross-checks a registrar account against public data", () => {
    const account = { registrar: "Spaceship", expiresOn: "2027-03-01", nameservers: rdap.nameservers };
    expect(compareSources(account, { ...rdap, registrar: "Spaceship, Inc." })).toEqual([
      { field: "expiresOn", account: "2027-03-01", public: "2027-01-01" },
    ]);
    expect(compareSources({ ...account, expiresOn: "2027-01-02" }, rdap).map((m) => m.field)).toEqual(["registrar"]);
  });
});
