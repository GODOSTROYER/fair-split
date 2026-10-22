import { SAMPLE_KEY_KINDS } from "@fairsplit/contracts";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { keyIdIsSample } from "./sample-keys.js";

describe("inv.i8.sample-key-ids: one rule decides which keys are samples (officer and ledger keys alike)", () => {
  it("the registered kind decides first: seeded, web_demo and any unknown kind are samples", () => {
    for (const kind of [...SAMPLE_KEY_KINDS, "demo", "web-demo", "Seeded", "", "APP", null, undefined]) {
      for (const id of ["fs-analyn-w1", "fs-ernesto-a1", "fs-ledger-k1"]) {
        expect(keyIdIsSample(id, kind), `${id} ${String(kind)}`).toBe(true);
      }
    }
  });

  it("real keys of a real kind are not samples: a person's app or web key, the server's ledger key", () => {
    expect(keyIdIsSample("fs-ernesto-a1", "app")).toBe(false);
    expect(keyIdIsSample("fs-analyn-a2", "app")).toBe(false);
    expect(keyIdIsSample("fs-ledger-k1", "server")).toBe(false);
    expect(keyIdIsSample("fs-ledger-k12", "server")).toBe(false);
  });

  it("a kind and an ID shape that do not belong together make a sample", () => {
    expect(keyIdIsSample("fs-ledger-k1", "app")).toBe(true);
    expect(keyIdIsSample("fs-ledger-k1", "web")).toBe(true);
    expect(keyIdIsSample("fs-ernesto-a1", "server")).toBe(true);
    expect(keyIdIsSample("fs-analyn-w1", "server")).toBe(true);
  });

  it("fs-analyn-w1, the treasurer's real browser key (S3.8), is not a sample unless its kind says demo", () => {
    expect(keyIdIsSample("fs-analyn-w1", "web")).toBe(false);
    expect(keyIdIsSample("fs-analyn-w1", "app")).toBe(false);
    expect(keyIdIsSample("fs-analyn-w1", "web_demo")).toBe(true);
    // Judge-session w keys are told apart by their registered kind, never by their ID.
    expect(keyIdIsSample("fs-ernesto-w7", "web_demo")).toBe(true);
    expect(keyIdIsSample("fs-ernesto-w7", "web")).toBe(false);
  });

  it("a seeded ID (fs-{persona}-s{n}, including fs-ledger-s{n}) is a sample whatever its kind", () => {
    for (const id of ["fs-analyn-s1", "fs-ernesto-s1", "fs-ledger-s1", "fs-ledger-s2"]) {
      for (const kind of ["app", "web", "server"])
        expect(keyIdIsSample(id, kind), `${id} ${kind}`).toBe(true);
    }
  });

  it("mismatch: a labelled demo ID (fs-{persona}-demo-{6}, C-13) is a sample even when its kind says web or app", () => {
    for (const id of ["fs-ernesto-demo-a1b2c3", "fs-analyn-demo-000000", "fs-demo-a1", "fs-ledger-demo-k1"]) {
      for (const kind of ["web", "app", "server"])
        expect(keyIdIsSample(id, kind), `${id} ${kind}`).toBe(true);
    }
  });

  it("an ID of no recognised real shape is a sample: an ID can only make a key more sample", () => {
    for (const id of [
      "",
      "fs-analyn-x1",
      "fs-Analyn-a1",
      "fs-analyn-a1 ",
      "fs-analyn-a",
      "fs-analyn-а1",
      "fs-ledger-k",
      "analyn-a1",
      "fs-analyn-a1\n",
    ]) {
      expect(keyIdIsSample(id, "app"), JSON.stringify(id)).toBe(true);
    }
    expect(keyIdIsSample(42 as unknown as string, "app")).toBe(true);
  });

  it("property: no key ID turns a sample kind into a real key", () => {
    fc.assert(
      fc.property(fc.string(), fc.constantFrom(...SAMPLE_KEY_KINDS), (id, kind) => {
        expect(keyIdIsSample(id, kind)).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("property: a real verdict needs a real kind and a real ID shape, never a seeded or demo ID", () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.string(),
          fc.stringMatching(/^fs-[a-z]{1,8}-[aswk]\d{1,3}$/),
          fc.stringMatching(/^fs-[a-z]{1,8}-demo-[a-z0-9]{6}$/),
        ),
        fc.constantFrom("app", "web", "server", "web_demo", "seeded", "other"),
        (id, kind) => {
          const real = !keyIdIsSample(id, kind);
          if (real) {
            expect(["app", "web", "server"]).toContain(kind);
            expect(id).toMatch(kind === "server" ? /^fs-ledger-k\d+$/ : /^fs-[a-z]+-[aw]\d+$/);
            expect(id).not.toMatch(/(?:^|-)demo(?:-|$)/);
          }
        },
      ),
      { numRuns: 500 },
    );
  });
});
