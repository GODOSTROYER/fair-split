// /ops (W-OP-01): what the operator sees, what a judge sees (their own workspace only), latency metrics from
// our own clock readings, and the treasurer's browser-key registration with proof of possession (I6: a key is
// on the chain before it can sign anything a Proof shows).
import { type ApiError, LedgerPayloads, OfficerKey, PublishedKeys } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { ed25519FromSeed, ed25519Sign, sha256Hex } from "@fairsplit/domain";
import { getFigures, getProof, getRun } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registrationBytes } from "../../ops/keys.js";
import type { OpsMetrics } from "../../ops/metrics.js";
import { latency, percentile } from "../../ops/metrics.js";
import type { OpsOverview } from "../../ops/overview.js";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
let w: ShowcaseWorld;
let operator: { cookie: string };
let otherWs: string;

beforeAll(async () => {
  t = await createTestApp({ db: "postgres", env: { FS_KILL: "ai_live" } });
  w = await loadShowcase(t.deps.db);
  operator = t.credentials.operator(t.credentials.operatorCookie()) as { cookie: string };
  const other = await t.fixture({
    kind: "judge",
    withRun: true,
    expiresAt: new Date("2026-10-29T00:00:00.000Z"),
  });
  otherWs = other.workspaceId;
  // a dead task in the other workspace, with an error only the operator may read
  await t.deps.db.insert(schema.taskOutbox).values({
    workspaceId: otherWs,
    name: "explain",
    args: { lineId: "x", lang: "en" },
    dedupeKey: "explain:dead:test",
    state: "dead",
    attempts: 8,
    lastError: "statement template refused",
  });
});
afterAll(async () => t.close());

describe("GET /v1/ops/overview", () => {
  it("the operator sees every workspace: rail, ledger key, forced kill switches, items, ledger heads", async () => {
    const r = await t.json<OpsOverview>("/v1/ops/overview", { as: operator });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const o = r.body;
    expect(o.view).toBe("operator");
    expect(o.rail).toMatchObject({ mode: "simulator", label: "simulated", provenance: "simulated_rail" });
    expect(o.ledgerKey).toMatchObject({ keyId: "fs-ledger-s2", kind: "seeded", proofReads: "Sample" });
    expect(o.flags.forcedByEnv).toEqual(["kill_ai_live"]);
    expect(o.items).toEqual({ SUCCESS: getFigures().endPaidMembers, RETURNED: 1 });
    expect(o.runs.SETTLED).toBe(1);
    expect(o.ledger.find((l) => l.workspaceId === w.workspaceId)).toMatchObject({
      seq: getProof().ledger.length,
      verified: null,
    });
    expect(o.outbox.dead.find((d) => d.name === "explain")?.lastError).toBe("statement template refused");
    expect(o.limiter).toMatchObject({ perWindow: 40, backgroundPerWindow: 20, circuitOpen: false });
  });

  it("a judge sees only their own workspace, re-verifies its chain, and reads no other tenant's errors", async () => {
    const judge = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: w.workspaceId }));
    const r = await t.json<OpsOverview>("/v1/ops/overview", { as: judge });
    expect(r.status).toBe(200);
    const o = r.body;
    expect(o.view).toBe("workspace");
    expect(o.workspaceId).toBe(w.workspaceId);
    expect(o.ledger).toEqual([
      {
        workspaceId: w.workspaceId,
        kind: "showcase",
        seq: getProof().ledger.length,
        entryHash: getProof().ledger.at(-1)?.entryHash,
        verified: true,
        brokenAtSeq: null,
      },
    ]);
    expect(o.outbox.dead).toEqual([]);
    expect(o.flags.workspace?.find((f) => f.flag === "kill_ai_live")).toMatchObject({
      on: true,
      source: "env",
    });
    const text = JSON.stringify(o);
    expect(text).not.toContain(otherWs);
    for (const it of getRun().items) expect(text).not.toContain(it.receiver);
  });

  it("refuses: 401 without a credential, 403 for the clerk, a member link or the brand", async () => {
    expect((await t.json<ApiError>("/v1/ops/overview")).status).toBe(401);
    const clerk = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "clerk",
      persona: "jessie",
    });
    expect((await t.json<ApiError>("/v1/ops/overview", { as: t.credentials.bearer(clerk) })).status).toBe(
      403,
    );
    const member = t.credentials.memberLink({
      workspaceId: w.workspaceId,
      lineId: must(w.lineIds.get("M-014")),
    });
    expect((await t.json<ApiError>("/v1/ops/overview", { as: t.credentials.bearer(member) })).status).toBe(
      403,
    );
    const brand = t.credentials.brandLink({ workspaceId: w.workspaceId });
    expect((await t.json<ApiError>("/v1/ops/metrics", { as: t.credentials.bearer(brand) })).status).toBe(403);
  });
});

describe("GET /v1/ops/metrics", () => {
  it("percentiles are nearest-rank, and say so when there are no samples", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    expect(latency([]).display).toBe("No samples yet");
    expect(latency([12_000, 4_000]).display).toBe("p50 4 s, p95 12 s");
  });

  it("measures POST → first item event, → SUCCESS and → UNCLAIMED from verified deliveries", async () => {
    const posted = new Date("2026-10-29T02:10:35.000Z");
    const events = getProof().ledger.flatMap((e) => {
      const p = LedgerPayloads["webhook.applied"].safeParse(e.payload);
      return e.kind === "webhook.applied" && p.success && p.data.resource === "payout_item"
        ? [{ p: p.data, at: e.at }]
        : [];
    });
    for (const { p, at } of events) {
      await t.deps.db.insert(schema.webhookEvents).values({
        workspaceId: w.workspaceId,
        paypalEventId: p.eventId,
        eventType: p.eventType,
        resourceType: "payouts_item",
        resourceKey: p.senderItemId,
        verified: "self",
        raw: "{}",
        status: "applied",
        receivedAt: new Date(at),
        provenance: "seeded",
      });
    }
    const r = await t.json<OpsMetrics>("/v1/ops/metrics", { as: operator });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const ms = (at: string) => Date.parse(at) - posted.getTime();
    const ofType = (type: string) =>
      events
        .filter((e) => e.p.eventType === type)
        .map((e) => ms(e.at))
        .sort((a, b) => a - b);
    const success = ofType("PAYMENT.PAYOUTS-ITEM.SUCCEEDED");
    expect(r.body.latency.postToFirstItemEvent).toMatchObject({
      samples: 1,
      p50Ms: Math.min(...events.map((e) => ms(e.at))),
    });
    expect(r.body.latency.postToSuccess).toMatchObject({
      samples: success.length,
      p50Ms: percentile(success, 50),
      p95Ms: percentile(success, 95),
    });
    expect(r.body.latency.postToUnclaimed.samples).toBe(1);
    expect(r.body.latency.recordToInvoicePaid.samples).toBe(0);
    expect(r.body.runs).toMatchObject({ settled: 1 });
    // a judge's view counts only their own workspace
    const judge = t.credentials.judge(t.credentials.judgeCookie({ workspaceId: otherWs }));
    const mine = await t.json<OpsMetrics>("/v1/ops/metrics", { as: judge });
    expect(mine.body.latency.postToSuccess.samples).toBe(0);
    expect(mine.body.posts.batches).toBe(0);
  });
});

describe("treasurer web-key registration (POST /v1/ops/keys)", () => {
  const browser = ed25519FromSeed(sha256Hex("analyn's non-extractable WebCrypto key"));
  const body = (over: Record<string, unknown> = {}, signer = browser) => {
    const req = {
      workspaceId: w.workspaceId,
      keyId: "fs-analyn-w1",
      publicKeyHex: browser.publicKeyHex,
      approverId: "treasurer:analyn",
      ...over,
    } as { workspaceId: string; keyId: string; publicKeyHex: string; approverId: string };
    const at = t.clock.now().toISOString();
    return {
      ...req,
      proof: { at, signatureHex: ed25519Sign(signer.privateKey, registrationBytes({ ...req, at })) },
    };
  };

  it("registers the key with proof of possession: device_keys and a key.registered ledger entry, together", async () => {
    const r = await t.json<{ key: OfficerKey; registered: boolean; ledgerSeq: number }>("/v1/ops/keys", {
      method: "POST",
      body: body(),
      as: operator,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(OfficerKey.parse(r.body.key)).toEqual({
      keyId: "fs-analyn-w1",
      approverId: "treasurer:analyn",
      role: "treasurer",
      publicKeyHex: browser.publicKeyHex,
      kind: "app",
      revokedAt: null,
    });
    const [entry] = await t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, w.workspaceId),
          eq(schema.ledgerEntries.seq, r.body.ledgerSeq),
        ),
      );
    expect(entry).toMatchObject({ kind: "key.registered", actorKind: "human", actorId: "operator" });
    expect(LedgerPayloads["key.registered"].parse(entry?.payload)).toEqual({
      keyId: "fs-analyn-w1",
      persona: "treasurer:analyn",
      kind: "app",
      publicKeyHex: browser.publicKeyHex,
    });
    const keys = PublishedKeys.parse(
      (await t.json(`/.well-known/fairsplit-keys.json?run=${w.runSlug}`)).body,
    );
    expect(keys.officers.find((k) => k.keyId === "fs-analyn-w1")?.publicKeyHex).toBe(browser.publicKeyHex);
    const list = await t.json<{ officers: OfficerKey[] }>(`/v1/ops/keys?ws=${w.workspaceId}`, {
      as: operator,
    });
    expect(list.body.officers.map((k) => k.keyId)).toContain("fs-analyn-w1");
  });

  it("the same registration again changes nothing (200, registered false)", async () => {
    const r = await t.json<{ registered: boolean }>("/v1/ops/keys", {
      method: "POST",
      body: body(),
      as: operator,
    });
    expect(r.status).toBe(200);
    expect(r.body.registered).toBe(false);
  });

  it("INVALID_TRANSITION: the key ID for another key, or this key under another ID", async () => {
    const other = ed25519FromSeed(sha256Hex("a different browser key"));
    const taken = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body({ publicKeyHex: other.publicKeyHex }, other),
      as: operator,
    });
    expect(taken.status).toBe(409);
    expect(taken.body).toMatchObject({ code: "INVALID_TRANSITION", details: { reason: "KEY_ID_TAKEN" } });
    const reused = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body({ keyId: "fs-analyn-w2" }),
      as: operator,
    });
    expect(reused.status).toBe(409);
    expect(reused.body.details).toMatchObject({ reason: "KEY_REUSED" });
  });

  it("SIGNATURE_INVALID when the browser cannot prove it holds the key", async () => {
    const thief = ed25519FromSeed(sha256Hex("someone else"));
    const r = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body({ keyId: "fs-analyn-w3" }, thief),
      as: operator,
    });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("SIGNATURE_INVALID");
  });

  it("VALIDATION_FAILED: a stale proof, a mismatched approver, an app (`a`) or seeded key ID", async () => {
    const stale = body({ keyId: "fs-analyn-w4" });
    stale.proof.at = new Date(t.clock.nowMs() - 10 * 60_000).toISOString();
    const r1 = await t.json<ApiError>("/v1/ops/keys", { method: "POST", body: stale, as: operator });
    expect(r1.status).toBe(400);
    expect(r1.body.details).toMatchObject({ issues: [{ path: "body.proof.at" }] });
    const r2 = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body({ keyId: "fs-analyn-w4", approverId: "treasurer:ernesto" }),
      as: operator,
    });
    expect(r2.status).toBe(400);
    for (const keyId of ["fs-analyn-a2", "fs-analyn-s9"]) {
      const r = await t.json<ApiError>("/v1/ops/keys", {
        method: "POST",
        body: body({ keyId }),
        as: operator,
      });
      expect(r.status, keyId).toBe(400);
    }
  });

  it("FORBIDDEN: a key ID that is not the treasurer's, a judge workspace; 404 for no such workspace", async () => {
    const chair = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body({ keyId: "fs-ernesto-w1", approverId: "treasurer:ernesto" }),
      as: operator,
    });
    expect(chair.status).toBe(403);
    const judge = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body({ workspaceId: otherWs }),
      as: operator,
    });
    expect(judge.status).toBe(403);
    const none = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body({ workspaceId: "0192f8a0-0000-7000-8000-00000000beef" }),
      as: operator,
    });
    expect(none.status).toBe(404);
  });

  it("only the operator: a treasurer token is FORBIDDEN, no credential is UNAUTHENTICATED", async () => {
    const tk = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
    const r = await t.json<ApiError>("/v1/ops/keys", {
      method: "POST",
      body: body(),
      as: t.credentials.bearer(tk),
    });
    expect(r.status).toBe(403);
    expect((await t.json<ApiError>("/v1/ops/keys", { method: "POST", body: body() })).status).toBe(401);
  });

  it("revokes on the chain (the reason kept only as its hash); a second revocation changes nothing", async () => {
    const reason = "Laptop replaced; registering w2.";
    const r = await t.json<{ key: OfficerKey; revoked: boolean }>("/v1/ops/keys/revoke", {
      method: "POST",
      body: { workspaceId: w.workspaceId, keyId: "fs-analyn-w1", reason },
      as: operator,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.revoked).toBe(true);
    expect(r.body.key.revokedAt).toBe(t.clock.now().toISOString());
    const [entry] = await t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, w.workspaceId),
          eq(schema.ledgerEntries.kind, "key.revoked"),
        ),
      );
    expect(entry?.payload).toEqual({
      keyId: "fs-analyn-w1",
      revokedAt: t.clock.now().toISOString(),
      reasonSha256: sha256Hex(reason),
    });
    const again = await t.json<{ revoked: boolean }>("/v1/ops/keys/revoke", {
      method: "POST",
      body: { workspaceId: w.workspaceId, keyId: "fs-analyn-w1", reason },
      as: operator,
    });
    expect(again.body.revoked).toBe(false);
    const missing = await t.json<ApiError>("/v1/ops/keys/revoke", {
      method: "POST",
      body: { workspaceId: w.workspaceId, keyId: "fs-analyn-w9", reason },
      as: operator,
    });
    expect(missing.status).toBe(404);
  });
});
