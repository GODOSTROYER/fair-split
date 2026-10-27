import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  claimIdempotencyKey,
  completeIdempotencyKey,
  type IdempotencyClaim,
  type IdempotencyHold,
  purgeExpiredIdempotencyKeys,
  releaseIdempotencyKey,
} from "../src/idempotency.js";
import { idempotencyKeys } from "../src/schema/index.js";
import type { WorkspaceScope } from "../src/scope.js";
import { fixtureWorkspace, openTestDb, type TestDb } from "../src/testing/index.js";
import { scopeOf } from "./helpers.js";

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb({ max: 8 });
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

/** The claim must be new; returns the claimer's hold on the key. */
function held(claim: IdempotencyClaim): IdempotencyHold {
  if (claim.kind !== "new") throw new Error(`expected a new claim, got ${claim.kind}`);
  return claim;
}

const freshScope = async () => scopeOf((await fixtureWorkspace(t.app.db)).workspaceId);

async function stored(scope: WorkspaceScope, key: string) {
  const [row] = await t.owner.db
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.workspaceId, scope.workspaceId), eq(idempotencyKeys.key, key)));
  return row ?? null;
}

/** What 24 hours do to a key. */
const expire = (scope: WorkspaceScope, key: string) =>
  t.owner.db
    .update(idempotencyKeys)
    .set({ expiresAt: sql`now() - interval '1 minute'` })
    .where(and(eq(idempotencyKeys.workspaceId, scope.workspaceId), eq(idempotencyKeys.key, key)));

describe("Idempotency-Key (S3.10)", () => {
  it("first use is new; a retry while it runs is in flight; after completion the stored response replays", async () => {
    const scope = await freshScope();
    const claim = held(await claimIdempotencyKey(t.app.db, scope, req("k1")));
    expect(claim).toMatchObject({ kind: "new", key: "k1" });
    expect(claim.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(await claimIdempotencyKey(t.app.db, scope, req("k1"))).toEqual({ kind: "in_flight" });
    expect(
      await completeIdempotencyKey(t.app.db, scope, claim, {
        status: 201,
        body: { holdId: "H1", state: "RESOLVED" },
      }),
    ).toBe(true);
    expect(await claimIdempotencyKey(t.app.db, scope, req("k1"))).toEqual({
      kind: "replay",
      status: 201,
      body: { holdId: "H1", state: "RESOLVED" },
    });
  });

  it("the same key with a different body is a mismatch (422 IDEMPOTENCY_KEY_REUSED)", async () => {
    const scope = await freshScope();
    await claimIdempotencyKey(t.app.db, scope, req("k2", "a"));
    expect(await claimIdempotencyKey(t.app.db, scope, req("k2", "b"))).toEqual({ kind: "mismatch" });
  });

  it("keys are per workspace, can be released after a retryable failure, and expire after 24 h", async () => {
    const a = await freshScope();
    const b = await freshScope();
    const ca = held(await claimIdempotencyKey(t.app.db, a, req("k3")));
    const cb = held(await claimIdempotencyKey(t.app.db, b, req("k3")));

    expect(await releaseIdempotencyKey(t.app.db, a, ca)).toBe(true);
    expect(await claimIdempotencyKey(t.app.db, a, req("k3"))).toMatchObject({ kind: "new" });

    expect(await completeIdempotencyKey(t.app.db, b, cb, { status: 200, body: null })).toBe(true);
    await expire(b, "k3");
    // an expired key behaves as new, even with a different body
    expect(await claimIdempotencyKey(t.app.db, b, req("k3", "c"))).toMatchObject({ kind: "new" });

    await t.owner.db.update(idempotencyKeys).set({ expiresAt: sql`now() - interval '1 minute'` });
    expect(await purgeExpiredIdempotencyKeys(t.app.db)).toBeGreaterThanOrEqual(2);
  });
});

/**
 * SECURITY (automated review, MEDIUM, idempotency.ts): complete and release were not bound to the claimer. A claim
 * that outlived its key (24 h, then reclaimed by a retry) or that had been released could overwrite or delete the
 * result of the request that holds the key now. Every claim now carries a random token stored in the row: complete
 * needs that token and a key still in flight, release needs that token, and both report whether they did anything.
 */
describe("inv.i7.idempotency-claim: only the request holding a key completes or releases it", () => {
  it("inv.i7.idempotency-claim: a claim that outlived its key cannot overwrite or delete the next claimer's", async () => {
    const scope = await freshScope();
    const first = held(await claimIdempotencyKey(t.app.db, scope, req("k-stale")));
    await expire(scope, "k-stale");
    const second = held(await claimIdempotencyKey(t.app.db, scope, req("k-stale")));
    expect(second.token).not.toBe(first.token);
    // the first request finally finishes: neither its result nor its release touches the second's claim
    expect(await completeIdempotencyKey(t.app.db, scope, first, { status: 201, body: { stale: true } })).toBe(
      false,
    );
    expect(await releaseIdempotencyKey(t.app.db, scope, first)).toBe(false);
    expect(await stored(scope, "k-stale")).toMatchObject({ claimToken: second.token, responseStatus: null });
    expect(await claimIdempotencyKey(t.app.db, scope, req("k-stale"))).toEqual({ kind: "in_flight" });
    expect(await completeIdempotencyKey(t.app.db, scope, second, { status: 201, body: { ok: 2 } })).toBe(
      true,
    );
    expect(await claimIdempotencyKey(t.app.db, scope, req("k-stale"))).toEqual({
      kind: "replay",
      status: 201,
      body: { ok: 2 },
    });
  });

  it("inv.i7.idempotency-claim: a released claim is dead: it cannot complete the key a retry claimed after it", async () => {
    const scope = await freshScope();
    const first = held(await claimIdempotencyKey(t.app.db, scope, req("k-released")));
    expect(await releaseIdempotencyKey(t.app.db, scope, first)).toBe(true);
    const retry = held(await claimIdempotencyKey(t.app.db, scope, req("k-released")));
    expect(await completeIdempotencyKey(t.app.db, scope, first, { status: 500, body: null })).toBe(false);
    expect(await releaseIdempotencyKey(t.app.db, scope, first)).toBe(false);
    expect(await stored(scope, "k-released")).toMatchObject({
      claimToken: retry.token,
      responseStatus: null,
    });
    // a token that never claimed anything does nothing either
    const forged = { key: "k-released", token: "00000000-0000-4000-8000-000000000000" };
    expect(await completeIdempotencyKey(t.app.db, scope, forged, { status: 200, body: null })).toBe(false);
    expect(await releaseIdempotencyKey(t.app.db, scope, forged)).toBe(false);
    expect(await completeIdempotencyKey(t.app.db, scope, retry, { status: 200, body: { ok: 1 } })).toBe(true);
  });

  it("inv.i7.idempotency-claim: a stored response never changes, and a completed key is never released", async () => {
    const scope = await freshScope();
    const claim = held(await claimIdempotencyKey(t.app.db, scope, req("k-done")));
    expect(await completeIdempotencyKey(t.app.db, scope, claim, { status: 201, body: { n: 1 } })).toBe(true);
    expect(await completeIdempotencyKey(t.app.db, scope, claim, { status: 500, body: { n: 2 } })).toBe(false);
    expect(await releaseIdempotencyKey(t.app.db, scope, claim)).toBe(false);
    expect(await claimIdempotencyKey(t.app.db, scope, req("k-done"))).toEqual({
      kind: "replay",
      status: 201,
      body: { n: 1 },
    });
    // the key is the workspace's: the same hold names nothing in another workspace
    const other = await freshScope();
    held(await claimIdempotencyKey(t.app.db, other, req("k-done")));
    expect(await completeIdempotencyKey(t.app.db, other, claim, { status: 200, body: null })).toBe(false);
  });

  it("inv.i7.idempotency-claim: two concurrent claimers of one key: exactly one holds it, fresh or expired", async () => {
    const scope = await freshScope();
    const race = () =>
      Promise.all(Array.from({ length: 6 }, () => claimIdempotencyKey(t.app.db, scope, req("k-race"))));
    const fresh = await race();
    expect(fresh.filter((c) => c.kind === "new")).toHaveLength(1);
    expect(fresh.filter((c) => c.kind === "in_flight")).toHaveLength(5);
    await expire(scope, "k-race");
    const again = await race();
    const winners = again.filter((c): c is Extract<IdempotencyClaim, { kind: "new" }> => c.kind === "new");
    expect(winners).toHaveLength(1);
    expect(again.filter((c) => c.kind === "in_flight")).toHaveLength(5);
    expect(await stored(scope, "k-race")).toMatchObject({ claimToken: winners[0]?.token });
  });
});
