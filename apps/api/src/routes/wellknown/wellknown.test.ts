// /.well-known/fairsplit-keys.json: the trust anchors a Proof verifier pins, kept apart from every bundle.
import { type ApiError, PublishedKeys } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { ed25519FromSeed, sha256Hex } from "@fairsplit/domain";
import { getPublishedKeys } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SAMPLE_LEDGER_KEY_ID } from "../../ledger/keys.js";
import { storedPublicKeyOf } from "../../proof/keys.js";
import { loadShowcase, type ShowcaseWorld } from "../../proof/testing/world.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
let w: ShowcaseWorld;
let judgeWs: string;
let judgeSlug: string;
const demo = ed25519FromSeed(sha256Hex("judge demo key"));
const impostor = ed25519FromSeed(sha256Hex("another co-op's fs-analyn-a1"));

beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
  w = await loadShowcase(t.deps.db, { keys: "app" });
  // a judge workspace whose session made a labelled browser demo key for the Chair
  const judge = await t.fixture({
    kind: "judge",
    withRun: true,
    expiresAt: new Date("2026-10-29T02:00:00.000Z"),
  });
  judgeWs = judge.workspaceId;
  const runs = await t.deps.db
    .select({ slug: schema.payRuns.runSlug, ws: schema.payRuns.workspaceId })
    .from(schema.payRuns);
  judgeSlug = runs.find((r) => r.ws === judgeWs)?.slug as string;
  await t.deps.db.insert(schema.deviceKeys).values({
    workspaceId: judgeWs,
    keyId: "fs-ernesto-w1",
    persona: "board:ernesto",
    publicKey: storedPublicKeyOf(demo.publicKeyHex),
    kind: "web_demo",
  });
  // a second real co-op that reuses the showcase treasurer's key ID with another key: ambiguous, so withheld
  const other = await t.fixture({ kind: "real" });
  await t.deps.db.insert(schema.deviceKeys).values({
    workspaceId: other.workspaceId,
    keyId: "fs-analyn-a1",
    persona: "treasurer:analyn",
    publicKey: storedPublicKeyOf(impostor.publicKeyHex),
    kind: "app",
  });
});
afterAll(async () => t.close());

describe("GET /.well-known/fairsplit-keys.json", () => {
  it("publishes officer and ledger keys (public halves), the sample keys labelled, cacheable and open to any origin", async () => {
    const r = await t.request("/.well-known/fairsplit-keys.json");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=60");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    const keys = PublishedKeys.parse(await r.json());
    expect(keys.ledger[0]).toMatchObject({ keyId: SAMPLE_LEDGER_KEY_ID, kind: "seeded" });
    expect(keys.ledger.slice(1)).toEqual(getPublishedKeys().ledger);
    for (const sample of getPublishedKeys().officers) expect(keys.officers).toContainEqual(sample);
    expect(JSON.stringify(keys)).not.toMatch(/private/i);
  });

  it("withholds a key ID that two co-ops publish with different keys (fail closed), keeps the unambiguous one", async () => {
    const keys = PublishedKeys.parse((await t.json("/.well-known/fairsplit-keys.json")).body);
    const ids = keys.officers.map((k) => k.keyId);
    expect(ids).not.toContain("fs-analyn-a1");
    expect(keys.officers.find((k) => k.keyId === "fs-ernesto-a1")).toEqual({
      keyId: "fs-ernesto-a1",
      approverId: "board:ernesto",
      role: "chair",
      publicKeyHex: w.appKeys?.chair.publicKeyHex,
      kind: "app",
      revokedAt: null,
    });
  });

  it("a judge session's demo keys are published only for its own run, labelled web_demo", async () => {
    const global = PublishedKeys.parse((await t.json("/.well-known/fairsplit-keys.json")).body);
    expect(global.officers.some((k) => k.publicKeyHex === demo.publicKeyHex)).toBe(false);
    const scoped = PublishedKeys.parse(
      (await t.json(`/.well-known/fairsplit-keys.json?run=${judgeSlug}`)).body,
    );
    expect(scoped.officers.find((k) => k.keyId === "fs-ernesto-w1")).toMatchObject({
      kind: "web_demo",
      role: "chair",
      publicKeyHex: demo.publicKeyHex,
    });
    const showcase = PublishedKeys.parse(
      (await t.json(`/.well-known/fairsplit-keys.json?run=${w.runSlug}`)).body,
    );
    expect(showcase.officers.find((k) => k.keyId === "fs-analyn-a1")?.publicKeyHex).toBe(
      w.appKeys?.treasurer.publicKeyHex,
    );
  });

  it("NOT_FOUND for an unknown run; VALIDATION_FAILED for something that is not a run slug", async () => {
    const missing = await t.json<ApiError>("/.well-known/fairsplit-keys.json?run=2026A-r9999999");
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("NOT_FOUND");
    const bad = await t.json<ApiError>("/.well-known/fairsplit-keys.json?run=../../etc");
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
  });
});
