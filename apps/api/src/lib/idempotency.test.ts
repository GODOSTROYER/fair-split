// S3.10 at the store: a `new` claim is a hold, and only that hold completes or releases the key. Both stores
// (Postgres in the app, memory in the no-database harness) keep the same contract.
import { systemScope } from "@fairsplit/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestApp, type TestApp } from "../test/index.js";
import { dbIdempotencyStore, type IdempotencyStore, memoryIdempotencyStore } from "./idempotency.js";

const req = (key: string, sha = "a".repeat(64)) => ({
  key,
  method: "POST",
  route: "/v1/slips",
  requestSha256: sha,
});
const ok = { status: 201, body: { id: "one" } };

function contract(name: string, setup: () => Promise<{ store: IdempotencyStore; workspaceId: string }>) {
  describe(name, () => {
    let store: IdempotencyStore;
    let scope: ReturnType<typeof systemScope>;
    beforeAll(async () => {
      const s = await setup();
      store = s.store;
      scope = systemScope(s.workspaceId, { kind: "system", id: "system:test", impersonatedBy: null });
    });

    it("a new claim is a hold: the holder completes it and a retry replays the stored response", async () => {
      const claim = await store.claim(scope, req("k-hold-1"));
      expect(claim.kind).toBe("new");
      if (claim.kind !== "new") return;
      expect(claim.key).toBe("k-hold-1");
      expect(claim.token).toMatch(/^[0-9a-f-]{36}$/);
      expect(await store.claim(scope, req("k-hold-1"))).toEqual({ kind: "in_flight" });
      expect(await store.complete(scope, { key: claim.key, token: claim.token }, ok)).toBe(true);
      expect(await store.claim(scope, req("k-hold-1"))).toEqual({ kind: "replay", ...ok });
      expect(await store.claim(scope, req("k-hold-1", "b".repeat(64)))).toEqual({ kind: "mismatch" });
    });

    it("a hold with another token completes or releases nothing", async () => {
      const claim = await store.claim(scope, req("k-hold-2"));
      if (claim.kind !== "new") throw new Error("expected a new claim");
      const forged = { key: claim.key, token: "00000000-0000-4000-8000-000000000000" };
      expect(await store.complete(scope, forged, ok)).toBe(false);
      expect(await store.release(scope, forged)).toBe(false);
      expect(await store.claim(scope, req("k-hold-2"))).toEqual({ kind: "in_flight" });
    });

    it("a released claim is dead: completing it later writes nothing, and the next claim is new", async () => {
      const first = await store.claim(scope, req("k-hold-3"));
      if (first.kind !== "new") throw new Error("expected a new claim");
      expect(await store.release(scope, first)).toBe(true);
      const second = await store.claim(scope, req("k-hold-3"));
      expect(second.kind).toBe("new");
      if (second.kind !== "new") return;
      expect(second.token).not.toBe(first.token);
      expect(await store.complete(scope, first, { status: 500, body: null })).toBe(false);
      expect(await store.release(scope, first)).toBe(false);
      expect(await store.complete(scope, second, ok)).toBe(true);
      expect(await store.claim(scope, req("k-hold-3"))).toEqual({ kind: "replay", ...ok });
    });

    it("a completed key is never completed again, even by its own hold", async () => {
      const claim = await store.claim(scope, req("k-hold-4"));
      if (claim.kind !== "new") throw new Error("expected a new claim");
      expect(await store.complete(scope, claim, ok)).toBe(true);
      expect(await store.complete(scope, claim, { status: 409, body: null })).toBe(false);
      expect(await store.release(scope, claim)).toBe(false);
      expect(await store.claim(scope, req("k-hold-4"))).toEqual({ kind: "replay", ...ok });
    });
  });
}

contract("memoryIdempotencyStore", async () => ({
  store: memoryIdempotencyStore(),
  workspaceId: "00000000-0000-7000-8000-000000000001",
}));

let t: TestApp;
afterAll(async () => {
  await t?.close();
});
contract("dbIdempotencyStore (Postgres)", async () => {
  t = await createTestApp({ db: "postgres" });
  const fx = await t.fixture();
  return { store: dbIdempotencyStore(t.deps.db), workspaceId: fx.workspaceId };
});
