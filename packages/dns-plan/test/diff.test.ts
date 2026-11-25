/**
 * The diff engine, exhaustively. Pure: no database, no network, no clock.
 *
 * The four outcomes and their inverses, the record-identity rule, TTL and
 * proxy comparison, and the two operations the reconciler may NEVER derive:
 * rewriting a `manual` record and deleting an `unexpected` one.
 */
import { describe, expect, it } from "bun:test";
import {
  assertNoUnexpectedDeletes,
  diffRecords,
  planOperations,
  toFqdn,
  toRelativeName,
} from "../src/index.ts";
import type { DesiredRecord, ObservedRecord } from "../src/index.ts";


function intent(
  overrides: Partial<DesiredRecord> & { id: string },
): DesiredRecord & { id: string } {
  return {
    type: "A",
    name: "@",
    content: "203.0.113.10",
    ttlSeconds: null,
    priority: null,
    proxied: false,
    
    recordId: null,
    ...overrides,
  };
}

function observed(overrides: Partial<ObservedRecord> & { recordId: string }): ObservedRecord {
  return { type: "A", name: "@", content: "203.0.113.10", ttlSeconds: null, priority: null, proxied: false, proxiable: true, ...overrides };
}

describe("diffRecords — the four outcomes", () => {
  it("reports no-op when both sides agree exactly", () => {
    const diff = diffRecords(
      [intent({ id: "i1" })],
      [observed({ recordId: "r1" })],
    );
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.missing).toHaveLength(0);
    expect(diff.modified).toHaveLength(0);
    expect(diff.unexpected).toHaveLength(0);
  });

  it("reports 'missing' when intent has a record the provider does not", () => {
    const diff = diffRecords([intent({ id: "i1" })], []);
    expect(diff.missing).toHaveLength(1);
    expect(diff.missing[0]?.desired.id).toBe("i1");
  });

  it("reports 'unexpected' when the provider has a record intent never described", () => {
    // The single most important drift class: how a hand-edit in a provider
    // dashboard becomes visible.
    const diff = diffRecords(
      [],
      [observed({ recordId: "r1", type: "TXT", name: "_acme-challenge" })],
    );
    expect(diff.unexpected).toHaveLength(1);
    expect(diff.unexpected[0]?.observed.recordId).toBe("r1");
  });

  it("reports 'modified' — not missing+unexpected — when content changed", () => {
    const diff = diffRecords(
      [intent({ id: "i1", content: "203.0.113.10" })],
      [observed({ recordId: "r1", content: "203.0.113.99" })],
    );
    expect(diff.modified).toHaveLength(1);
    expect(diff.missing).toHaveLength(0);
    expect(diff.unexpected).toHaveLength(0);
    expect(diff.modified[0]?.changed).toEqual(["content"]);
  });
});

describe("the comparable attributes", () => {
  it("detects a proxied-flag change on otherwise identical records", () => {
    const diff = diffRecords(
      [intent({ id: "i1", proxied: true })],
      [observed({ recordId: "r1", proxied: false })],
    );
    expect(diff.modified[0]?.changed).toEqual(["proxied"]);
  });

  it("treats null TTL on both sides as equal — the provider default", () => {
    // The adapter has already translated its sentinel back to null, which is
    // the entire reason that translation lives at the boundary.
    const diff = diffRecords(
      [intent({ id: "i1", ttlSeconds: null })],
      [observed({ recordId: "r1", ttlSeconds: null })],
    );
    expect(diff.unchanged).toHaveLength(1);
  });

  it("detects a TTL change, including automatic-versus-explicit", () => {
    expect(
      diffRecords(
        [intent({ id: "i1", ttlSeconds: 300 })],
        [observed({ recordId: "r1", ttlSeconds: 600 })],
      ).modified[0]?.changed,
    ).toEqual(["ttlSeconds"]);

    expect(
      diffRecords(
        [intent({ id: "i1", ttlSeconds: null })],
        [observed({ recordId: "r1", ttlSeconds: 300 })],
      ).modified[0]?.changed,
    ).toEqual(["ttlSeconds"]);
  });

  it("detects a priority change and treats undefined as null", () => {
    expect(
      diffRecords(
        [intent({ id: "i1", type: "MX", content: "mx.test", priority: 10 })],
        [
          observed({
            recordId: "r1",
            type: "MX",
            content: "mx.test",
            priority: 20,
          }),
        ],
      ).modified[0]?.changed,
    ).toEqual(["priority"]);
  });

  it("reports every changed attribute, not just the first", () => {
    const diff = diffRecords(
      [intent({ id: "i1", content: "a", proxied: true, ttlSeconds: 300 })],
      [
        observed({
          recordId: "r1",
          content: "b",
          proxied: false,
          ttlSeconds: 600,
        }),
      ],
    );
    expect(diff.modified[0]?.changed).toEqual([
      "content",
      "proxied",
      "ttlSeconds",
    ]);
  });
});

describe("record identity — pairing on (type, name), matching content first", () => {
  it("does not confuse two records that differ only by type", () => {
    const diff = diffRecords(
      [
        intent({ id: "i1", type: "A", content: "203.0.113.10" }),
        intent({ id: "i2", type: "AAAA", content: "2001:db8::10" }),
      ],
      [
        observed({ recordId: "r1", type: "A", content: "203.0.113.10" }),
        observed({
          recordId: "r2",
          type: "AAAA",
          content: "2001:db8::10",
        }),
      ],
    );
    expect(diff.unchanged).toHaveLength(2);
  });

  it("keeps an unchanged member of a MULTI-VALUED set out of the drift report", () => {
    // The failure this prevents: a sweep reporting drift on a correct zone
    // forever, which is what makes people stop reading drift reports.
    const diff = diffRecords(
      [
        intent({ id: "i1", type: "MX", content: "mx1.test", priority: 10 }),
        intent({ id: "i2", type: "MX", content: "mx2.test", priority: 20 }),
      ],
      [
        // Deliberately in the OPPOSITE order to intent.
        observed({
          recordId: "r2",
          type: "MX",
          content: "mx2.test",
          priority: 20,
        }),
        observed({
          recordId: "r1",
          type: "MX",
          content: "mx1.test",
          priority: 10,
        }),
      ],
    );
    expect(diff.unchanged).toHaveLength(2);
    expect(diff.modified).toHaveLength(0);
  });

  it("reports only the changed member of a multi-valued set", () => {
    const diff = diffRecords(
      [
        intent({ id: "i1", type: "TXT", content: "v=spf1 -all" }),
        intent({ id: "i2", type: "TXT", content: "keep-me" }),
      ],
      [
        observed({ recordId: "r1", type: "TXT", content: "keep-me" }),
        observed({
          recordId: "r2",
          type: "TXT",
          content: "v=spf1 include:old -all",
        }),
      ],
    );
    expect(diff.unchanged.map((entry) => entry.desired.id)).toEqual(["i2"]);
    expect(diff.modified.map((entry) => entry.desired.id)).toEqual(["i1"]);
    expect(diff.unexpected).toHaveLength(0);
  });

  it("reports the surplus provider values as unexpected when it has more", () => {
    const diff = diffRecords(
      [intent({ id: "i1", type: "TXT", content: "a" })],
      [
        observed({ recordId: "r1", type: "TXT", content: "a" }),
        observed({ recordId: "r2", type: "TXT", content: "b" }),
      ],
    );
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.unexpected.map((entry) => entry.observed.recordId)).toEqual([
      "r2",
    ]);
  });

  it("reports the surplus intent values as missing when intent has more", () => {
    const diff = diffRecords(
      [
        intent({ id: "i1", type: "TXT", content: "a" }),
        intent({ id: "i2", type: "TXT", content: "b" }),
      ],
      [observed({ recordId: "r1", type: "TXT", content: "a" })],
    );
    expect(diff.unchanged).toHaveLength(1);
    expect(diff.missing.map((entry) => entry.desired.id)).toEqual(["i2"]);
  });

  it("is empty in both directions for empty inputs", () => {
    const diff = diffRecords([], []);
    expect(diff).toEqual({ missing: [], modified: [], unexpected: [], unchanged: [] });
  });

});

describe("planOperations — what apply may and may not do", () => {
  it("creates for a missing record and updates for a modified one", () => {
    const diff = diffRecords(
      [
        intent({ id: "i1", name: "a" }),
        intent({ id: "i2", name: "b", content: "want" }),
      ],
      [observed({ recordId: "r2", name: "b", content: "have" })],
    );
    const operations = planOperations(diff);
    expect(operations).toEqual([
      {
        kind: "create",
        record: {
          type: "A",
          name: "a",
          content: "203.0.113.10",
          ttlSeconds: null,
          priority: null,
          proxied: false,
        },
      },
      {
        kind: "update",
        recordId: "r2",
        record: {
          type: "A",
          name: "b",
          content: "want",
          ttlSeconds: null,
          priority: null,
          proxied: false,
        },
      },
    ]);
  });

  it("NEVER rewrites a manual record, even when it drifted", () => {
    // "A reconciler that deletes it on the next sweep is a reconciler nobody
    // will run." Comparison is free; only rewriting is dangerous.
    const diff = diffRecords(
      [intent({ id: "i1", managed: false, content: "authored" })],
      [observed({ recordId: "r1", content: "hand-edited" })],
    );
    expect(diff.modified).toHaveLength(1);
    expect(planOperations(diff)).toEqual([]);
  });

  it("never creates a manual record either", () => {
    const diff = diffRecords([intent({ id: "i1", managed: false })], []);
    expect(diff.missing).toHaveLength(1);
    expect(planOperations(diff)).toEqual([]);
  });

  it("NEVER deletes an unexpected record", () => {
    const diff = diffRecords(
      [],
      [
        observed({ recordId: "r1", name: "surprise" }),
        observed({ recordId: "r2", name: "another" }),
      ],
    );
    expect(diff.unexpected).toHaveLength(2);
    expect(planOperations(diff)).toEqual([]);
  });

  it("deletes ONLY the records the caller lists", () => {
    const record = observed({ recordId: "r1" });
    const diff = diffRecords([], [record]);
    const operations = planOperations(diff, { remove: [record] });
    expect(operations).toEqual([{ kind: "delete", recordId: "r1", record: { type: "A", name: "@", content: "203.0.113.10" } }]);
    expect(() => assertNoUnexpectedDeletes(diff, operations, { remove: [record] })).not.toThrow();
  });

  it("guards the unexpected rule structurally, not just by omission", () => {
    const diff = diffRecords([], [observed({ recordId: "r1" })]);
    // A hand-assembled operation list that violates the rule must throw.
    expect(() =>
      assertNoUnexpectedDeletes(diff, [
        {
          kind: "delete",
          recordId: "r1",
          record: { type: "A", name: "@", content: "203.0.113.10" },
        },
      ]),
    ).toThrow(/refusing to delete an unexpected/);

    // And the operations the builder actually produces must pass it.
    expect(() =>
      assertNoUnexpectedDeletes(diff, planOperations(diff)),
    ).not.toThrow();
  });
});

describe("never overwriting somebody else's record", () => {
  const txt = (content: string, recordId: string) => observed({ recordId, type: "TXT", content });

  it("adds a TXT record instead of replacing an unrelated one", () => {
    const diff = diffRecords(
      [intent({ id: "spf", type: "TXT", content: "v=spf1 -all" })],
      [txt("google-site-verification=abc", "theirs")],
    );
    expect(diff.modified).toEqual([]);
    expect(diff.missing).toHaveLength(1);
    expect(planOperations(diff).map((operation) => operation.kind)).toEqual(["create"]);
  });

  it("still updates the same TXT policy in place, and keeps other values", () => {
    const diff = diffRecords(
      [intent({ id: "spf", type: "TXT", content: "v=spf1 -all" })],
      [txt("google-site-verification=abc", "theirs"), txt('"v=spf1 include:old -all"', "ours")],
    );
    expect(diff.modified.map((entry) => entry.observed.recordId)).toEqual(["ours"]);
    expect(diff.unexpected.map((entry) => entry.observed.recordId)).toEqual(["theirs"]);
  });

  it.each(["MX", "NS", "CAA", "SRV"])("does not repurpose an unrelated %s record", (type) => {
    const diff = diffRecords(
      [intent({ id: "ours", type, content: "mine.example" })],
      [observed({ recordId: "theirs", type, content: "theirs.example" })],
    );
    expect(planOperations(diff).map((operation) => operation.kind)).toEqual(["create"]);
  });

  it("pairs exactly by recordId, and by position only when asked", () => {
    const want = intent({ id: "mx", type: "MX", content: "new.example" });
    const have = observed({ recordId: "r1", type: "MX", content: "old.example" });
    expect(diffRecords([{ ...want, recordId: "r1" }], [have]).modified).toHaveLength(1);
    expect(diffRecords([want], [have], { pairing: "positional" }).modified).toHaveLength(1);
    expect(diffRecords([want], [have]).modified).toHaveLength(0);
  });

  it("does not guess between several addresses", () => {
    const diff = diffRecords(
      [intent({ id: "a", content: "203.0.113.1" })],
      [observed({ recordId: "r1", content: "203.0.113.2" }), observed({ recordId: "r2", content: "203.0.113.3" })],
    );
    expect(diff.modified).toEqual([]);
    expect(diff.unexpected).toHaveLength(2);
  });
});

describe("equivalent spellings are not drift", () => {
  it.each([
    ["CNAME", "Target.Example.com.", "target.example.com"],
    ["AAAA", "2001:DB8:0:0::10", "2001:db8::10"],
    ["TXT", "hello world", '"hello" " world"'],
  ])("%s", (type, want, have) => {
    const diff = diffRecords([intent({ id: "x", type, content: want })], [observed({ recordId: "r", type, content: have })]);
    expect(diff.unchanged).toHaveLength(1);
  });
});

describe("plan order", () => {
  it("removes a blocking CNAME before creating, and other removals last", () => {
    const cname = observed({ recordId: "c", type: "CNAME", name: "www", content: "x.example" });
    const old = observed({ recordId: "o", name: "old" });
    const diff = diffRecords([intent({ id: "a", name: "www" })], [cname, old]);
    expect(planOperations(diff, { remove: [old, cname] }).map((op) => `${op.kind} ${op.record.name}`)).toEqual([
      "delete www",
      "create www",
      "delete old",
    ]);
  });
});

describe("names", () => {
  it("round-trips relative and qualified names", () => {
    for (const name of ["@", "*", "www", "key1._domainkey"]) expect(toRelativeName(toFqdn(name, "example.test"), "example.test")).toBe(name);
    expect(toFqdn("www.example.test", "Example.TEST.")).toBe("www.example.test");
    expect(toRelativeName("notexample.test", "example.test")).toBe("notexample.test");
  });
});

describe("unmanaged records", () => {
  it("report a hand edit as modified, after managed records take certain matches", () => {
    const diff = diffRecords(
      [
        intent({ id: "manual", type: "TXT", content: "by-hand", managed: false }),
        intent({ id: "spf", type: "TXT", content: "v=spf1 -all" }),
      ],
      [
        observed({ recordId: "old", type: "TXT", content: "v=spf1 ~all" }),
        observed({ recordId: "edited", type: "TXT", content: "edited" }),
      ],
    );
    expect(diff.modified.map((entry) => entry.observed.recordId)).toEqual(["old", "edited"]);
    expect(planOperations(diff).map((operation) => operation.kind)).toEqual(["update"]);
  });
});
