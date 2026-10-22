import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  purgeExpiredIdempotencyKeys,
  releaseIdempotencyKey,
} from "../src/idempotency.js";
import { idempotencyKeys } from "../src/schema/index.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t?.close();
});

const req = (key: string, digest = "a") => ({
  key,
  method: "POST",
  route: "/v1/holds/:holdId/resolve",
  requestSha256: digest.repeat(64),
});

describe("Idempotency-Key (S3.10)", () => {
  it("first use is new; a retry while it runs is in flight; after completion the stored response replays", async () => {
    const scope = scopeOf((await fixtureWorkspace(t.app.db)).workspaceId);
    expect(await claimIdempotencyKey(t.app.db, scope, req("k1"))).toEqual({ kind: "new" });
    expect(await claimIdempotencyKey(t.app.db, scope, req("k1"))).toEqual({ kind: "in_flight" });
    await completeIdempotencyKey(t.app.db, scope, "k1", {
      status: 201,
      body: { holdId: "H1", state: "RESOLVED" },
    });
    expect(await claimIdempotencyKey(t.app.db, scope, req("k1"))).toEqual({
      kind: "replay",
      status: 201,
      body: { holdId: "H1", state: "RESOLVED" },
    });
  });

  it("the same key with a different body is a mismatch (422 IDEMPOTENCY_KEY_REUSED)", async () => {
    const scope = scopeOf((await fixtureWorkspace(t.app.db)).workspaceId);
    await claimIdempotencyKey(t.app.db, scope, req("k2", "a"));
    expect(await claimIdempotencyKey(t.app.db, scope, req("k2", "b"))).toEqual({ kind: "mismatch" });
  });

  it("keys are per workspace, can be released after a retryable failure, and expire after 24 h", async () => {
    const a = scopeOf((await fixtureWorkspace(t.app.db)).workspaceId);
    const b = scopeOf((await fixtureWorkspace(t.app.db)).workspaceId);
    expect(await claimIdempotencyKey(t.app.db, a, req("k3"))).toEqual({ kind: "new" });
    expect(await claimIdempotencyKey(t.app.db, b, req("k3"))).toEqual({ kind: "new" });

    await releaseIdempotencyKey(t.app.db, a, "k3");
    expect(await claimIdempotencyKey(t.app.db, a, req("k3"))).toEqual({ kind: "new" });

    await completeIdempotencyKey(t.app.db, b, "k3", { status: 200, body: null });
    await t.owner.db
      .update(idempotencyKeys)
      .set({ expiresAt: sql`now() - interval '1 minute'` })
      .where(sql`${idempotencyKeys.workspaceId} = ${b.workspaceId}`);
    // an expired key behaves as new, even with a different body
    expect(await claimIdempotencyKey(t.app.db, b, req("k3", "c"))).toEqual({ kind: "new" });

    await t.owner.db.update(idempotencyKeys).set({ expiresAt: sql`now() - interval '1 minute'` });
    expect(await purgeExpiredIdempotencyKeys(t.app.db)).toBeGreaterThanOrEqual(2);
  });
});
