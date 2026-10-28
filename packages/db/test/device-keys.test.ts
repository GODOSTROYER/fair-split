/**
 * S3.8, C-13: a registered key's kind fits its ID. `device_keys.kind` is one of the kinds a person's key can have
 * (contracts `DeviceKeyKind`: app, web, web_demo; a seeded key is never registered), and one CHECK per kind holds
 * `key_id` to that kind's shape, built from contracts' `DEVICE_KEY_ID_PATTERN_BY_KIND` (migrations/0017): an app key
 * is `fs-{p}-a{n}`, a persisted browser key `fs-{p}-w{n}`, a judge-session key `fs-{p}-demo-{6}`. So a judge's demo
 * key can never be registered under a real key's ID, nor a real key under another kind's ID.
 */
import { DEVICE_KEY_ID_PATTERN_BY_KIND, DeviceKeyKind, deviceKeyIdFitsKind } from "@fairsplit/contracts";
import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pgError } from "../src/errors.js";
import { deviceKeys } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { caught } from "./helpers.js";

let t: TestDb;
let workspaceId: string;
beforeAll(async () => {
  t = await openTestDb();
  workspaceId = (await fixtureWorkspace(t.app.db)).workspaceId;
});
afterAll(async () => {
  await t?.close();
});

const KINDS = DeviceKeyKind.options;

/** One well-formed ID of each kind. */
const SAMPLE: Readonly<Record<DeviceKeyKind, string>> = {
  app: "fs-ernesto-a1",
  web: "fs-analyn-w1",
  web_demo: "fs-analyn-demo-k3x9q2",
};

class Accepted extends Error {}

/**
 * Registers the key as the app role, in a transaction that is always rolled back (so IDs may repeat): null when the
 * row was accepted, otherwise the name of the CHECK that refused it. Any other error fails the test.
 */
async function refusedBy(kind: string, keyId: string): Promise<string | null> {
  const e = await caught(() =>
    t.app.db.transaction(async (tx) => {
      await tx.insert(deviceKeys).values({
        workspaceId,
        keyId,
        persona: "analyn",
        publicKey: "A".repeat(43),
        kind: kind as DeviceKeyKind,
      });
      throw new Accepted();
    }),
  );
  if (e instanceof Accepted) return null;
  const pg = pgError(e) as { code: string; constraint_name?: string } | null;
  if (pg?.code !== "23514") throw e;
  return pg.constraint_name ?? "(unnamed)";
}

describe("device_keys: a key's kind fits its ID shape (S3.8, C-13)", () => {
  it("accepts app, web and web_demo keys, each with its own ID shape", async () => {
    for (const kind of KINDS) expect(await refusedBy(kind, SAMPLE[kind]), kind).toBeNull();
  });

  it("each kind refuses the other kinds' shapes, by that kind's own CHECK", async () => {
    for (const kind of KINDS) {
      for (const other of KINDS.filter((k) => k !== kind)) {
        expect(await refusedBy(kind, SAMPLE[other]), `${kind} with ${SAMPLE[other]}`).toBe(
          `device_keys_key_id_${kind}_ck`,
        );
      }
    }
  });

  it("every kind refuses seeded, ledger and malformed IDs", async () => {
    const bad = [
      "fs-analyn-s1", // a seed-only officer key is never registered
      "fs-ledger-k1", // the server's ledger key
      "fs-ledger-s1",
      "fs-ledger-a1", // persona `ledger` marks ledger keys
      "fs-demo-a1", // persona `demo` marks demo keys
      "fs-demo-demo-k3x9q2",
      "fs-analyn-a0",
      "fs-analyn-a01", // no leading zero
      "fs-analyn-w10000", // n is 1-9999
      "fs-an4lyn-a1", // a persona is letters only
      `fs-${"a".repeat(25)}-a1`, // at most 24 letters
      "fs-Analyn-w1",
      "fs-analyn-demo-K3X9Q2",
      "fs-analyn-demo-k3x9q",
      "fs-analyn-demo-k3x9q2a",
      "fs-analyn-demo-k3x9q2\n",
      " fs-analyn-a1",
      "fs-analyn-a1 ",
      "fs-analyn-a1-w1",
      "fs--a1",
      "",
    ];
    for (const kind of KINDS) {
      for (const keyId of bad) {
        expect(await refusedBy(kind, keyId), `${kind} ${JSON.stringify(keyId)}`).toBe(
          `device_keys_key_id_${kind}_ck`,
        );
      }
    }
  });

  it("refuses any other kind, seeded included", async () => {
    expect(await refusedBy("seeded", "fs-analyn-s1")).toBe("device_keys_kind_ck");
    expect(await refusedBy("demo", SAMPLE.web_demo)).toBe("device_keys_kind_ck");
    expect(await refusedBy("APP", SAMPLE.app)).toBe("device_keys_kind_ck");
  });

  it("one CHECK per kind, each carrying contracts' DEVICE_KEY_ID_PATTERN_BY_KIND pattern verbatim", async () => {
    const rows = await t.owner.sql<{ name: string; def: string }[]>`
      select conname as name, pg_get_constraintdef(oid) as def
        from pg_constraint
       where conrelid = 'device_keys'::regclass and contype = 'c'`;
    const byName = new Map(rows.map((r) => [r.name, r.def]));
    expect([...byName.keys()].sort()).toEqual(
      ["device_keys_kind_ck", ...KINDS.map((k) => `device_keys_key_id_${k}_ck`)].sort(),
    );
    for (const kind of KINDS) {
      const def = byName.get(`device_keys_key_id_${kind}_ck`) ?? "";
      expect(def, kind).toContain(`'${kind}'::text`);
      expect(def, kind).toContain(`'${DEVICE_KEY_ID_PATTERN_BY_KIND[kind]}'::text`);
    }
    for (const kind of KINDS) expect(byName.get("device_keys_kind_ck")).toContain(`'${kind}'::text`);
  });

  it("property: the database accepts (kind, key ID) exactly when contracts' deviceKeyIdFitsKind does", async () => {
    const persona = fc.oneof(
      fc.stringMatching(/^[a-z]{1,24}$/),
      fc.constantFrom("analyn", "ernesto", "ledger", "demo", "Analyn", "an4lyn", "a".repeat(25)),
    );
    const n = fc.oneof(fc.integer({ min: 1, max: 9999 }).map(String), fc.constantFrom("0", "01", "10000"));
    const keyId = fc.oneof(
      fc.tuple(persona, fc.constantFrom("a", "w", "s", "k"), n).map(([p, c, s]) => `fs-${p}-${c}${s}`),
      fc
        .tuple(persona, fc.oneof(fc.stringMatching(/^[a-z0-9]{6}$/), fc.stringMatching(/^[a-zA-Z0-9]{5,7}$/)))
        .map(([p, d]) => `fs-${p}-demo-${d}`),
      fc.string({ maxLength: 40 }).filter((s) => !s.includes("\u0000")),
    );
    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...KINDS), keyId, async (kind, id) => {
        const accepted = (await refusedBy(kind, id)) === null;
        expect(accepted, `${kind} ${JSON.stringify(id)}`).toBe(deviceKeyIdFitsKind(kind, id));
      }),
      { numRuns: 150 },
    );
  });
});
