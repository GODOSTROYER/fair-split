// Two keys (I6, MM-5) at the HTTP boundary, on embedded Postgres and the seeded season: the payload is built
// by code from the database batch (8 items, US$368.39), each signature is checked against the `device_keys`
// registry in the domain's order, and every listed error code of approvalPayload, submitApproval and
// declineApproval is reached.
import { type ApprovalPayload, LedgerPayloads } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { approvalBytes, approvalJcs, batchDigest, ed25519Sign, linesDigest } from "@fairsplit/domain";
import { getSnapshot } from "@fairsplit/seed";
import { and, asc, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, startRuns } from "../runs/test/app.js";
import { registerKey } from "../runs/test/world.js";

type KeyPair = Awaited<ReturnType<typeof registerKey>>;

let h: RunsHarness;
let analyn: KeyPair;
let ernesto: KeyPair;
const figures = getSnapshot().figures;

const sign = (key: KeyPair, payload: ApprovalPayload) => ed25519Sign(key.privateKey, approvalBytes(payload));

async function payloadFor(role: "treasurer" | "chair", token: string) {
  return h.t.client(token).approvalPayload({ params: { runSlug: h.world.runSlug }, query: { role } });
}

beforeAll(async () => {
  h = await startRuns();
  const ws = h.world.workspaceId;
  const db = h.t.pg?.app.db;
  if (!db) throw new Error("db");
  analyn = await registerKey(db, ws, { keyId: "fs-analyn-a1", persona: "analyn" });
  ernesto = await registerKey(db, ws, { keyId: "fs-ernesto-a1", persona: "ernesto" });
});
afterAll(async () => h?.close());

describe("approvals (approvalPayload, submitApproval, declineApproval)", () => {
  it("BLOCKING_HOLDS_OPEN: nothing can be signed while a hold blocks approval", async () => {
    await expect(payloadFor("treasurer", h.tokens.treasurer)).rejects.toMatchObject({
      code: "BLOCKING_HOLDS_OPEN",
      status: 409,
    });
    const body = {
      role: "treasurer" as const,
      keyId: "fs-analyn-a1",
      signature: "0".repeat(128),
      payload: {
        v: 1,
        runId: h.world.runId,
        seasonId: h.world.seasonId,
        rateCardSha256: h.world.rateCardSha256,
        batchSha256: "a".repeat(64),
        linesDigest: "b".repeat(64),
        itemCount: 8,
        totalCents: 1,
        currency: "USD",
        role: "treasurer",
        approverId: "treasurer:analyn",
        nonce: "nonce-blocking",
        exp: "2026-10-28T02:10:00.000Z",
      } as const,
    };
    await expect(
      h.t.client(h.tokens.treasurer).submitApproval({ params: { runSlug: h.world.runSlug }, body }),
    ).rejects.toMatchObject({ code: "BLOCKING_HOLDS_OPEN" });
    await resolveAll(h);
  });

  it("INVALID_TRANSITION: the Chair has nothing to sign before the treasurer; FORBIDDEN for a clerk", async () => {
    await expect(payloadFor("chair", h.tokens.chair)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    await expect(payloadFor("treasurer", h.tokens.clerk)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      h.t.client(h.tokens.chair).declineApproval({
        params: { runSlug: h.world.runSlug },
        body: { role: "chair", reason: "not yet" },
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("the payload is code's: the seeded batch (8 items, US$368.39), a fresh nonce, exp in 30 minutes; /batch lets the app re-hash it", async () => {
    const { payload, jcs } = await payloadFor("treasurer", h.tokens.treasurer);
    expect(payload).toMatchObject({
      v: 1,
      runId: h.world.runId,
      seasonId: h.world.seasonId,
      rateCardSha256: h.world.rateCardSha256,
      itemCount: figures.batchItemCount,
      totalCents: figures.batchTotalCents,
      currency: "USD",
      role: "treasurer",
      approverId: "treasurer:analyn",
      exp: new Date(h.t.clock.nowMs() + 30 * 60_000).toISOString(),
    });
    expect(jcs).toBe(approvalJcs(payload));
    const again = await payloadFor("treasurer", h.tokens.treasurer);
    expect(again.payload.nonce).not.toBe(payload.nonce);
    const batch = await h.t.json<{
      items: { senderItemId: string; receiver: string; amountCents: number; currency: "USD" }[];
      senderBatchId: string;
      batchSha256: string;
      chairRequired: boolean;
    }>(`/v1/runs/${h.world.runSlug}/batch`, { as: h.t.credentials.bearer(h.tokens.chair) });
    expect(batch.status).toBe(200);
    const recomputed = batchDigest(
      {
        runId: h.world.runId,
        senderBatchId: batch.body.senderBatchId,
        rateCardSha256: h.world.rateCardSha256,
      },
      batch.body.items.map(({ senderItemId, receiver, amountCents, currency }) => ({
        senderItemId,
        receiver,
        amountCents,
        currency,
      })),
    );
    expect(recomputed.batchSha256).toBe(payload.batchSha256);
    expect(batch.body.chairRequired).toBe(true);
  });

  it("inv.i4.lines-digest: the payload also signs every member line (linesDigest): the run's lines root, recomputable from /batch", async () => {
    const { payload } = await payloadFor("treasurer", h.tokens.treasurer);
    const view = await h.t.json<{
      memberLines: { memberNo: string; lineSha256: string | null }[];
      linesDigest: string | null;
      items: { memberNo: string }[];
    }>(`/v1/runs/${h.world.runSlug}/batch`, { as: h.t.credentials.bearer(h.tokens.chair) });
    const stored = await h.t.deps.db
      .select({ memberNo: schema.members.memberNo, lineSha256: schema.memberLines.lineSha256 })
      .from(schema.memberLines)
      .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
      .where(eq(schema.memberLines.runId, h.world.runId));
    // every member line, the cash lines too: more lines than PayPal items
    expect(view.body.memberLines).toHaveLength(stored.length);
    expect(view.body.memberLines.length).toBeGreaterThan(view.body.items.length);
    const lines = view.body.memberLines.map((l) => ({
      memberNo: l.memberNo,
      lineSha256: l.lineSha256 ?? "",
    }));
    expect(linesDigest(lines)).toBe(view.body.linesDigest);
    expect(payload.linesDigest).toBe(view.body.linesDigest);
    // the root the run's latest lines.computed carries (Proof plate 4 recomputes the same)
    const computed = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(eq(schema.ledgerEntries.runId, h.world.runId), eq(schema.ledgerEntries.kind, "lines.computed")),
      )
      .orderBy(asc(schema.ledgerEntries.seq));
    const latest = LedgerPayloads["lines.computed"].parse(computed.at(-1)?.payload);
    expect(latest.linesRootSha256).toBe(payload.linesDigest);
  });

  it("DIGEST_MISMATCH: a payload whose linesDigest is not the lines' (a cash line changed) is refused", async () => {
    const { payload } = await payloadFor("treasurer", h.tokens.treasurer);
    const forged = { ...payload, linesDigest: "e".repeat(64) };
    await expect(
      h.t.client(h.tokens.treasurer).submitApproval({
        params: { runSlug: h.world.runSlug },
        body: { role: "treasurer", keyId: "fs-analyn-a1", signature: sign(analyn, forged), payload: forged },
      }),
    ).rejects.toMatchObject({
      code: "DIGEST_MISMATCH",
      details: {
        expected: { linesDigest: payload.linesDigest },
        got: { linesDigest: "e".repeat(64) },
      },
    });
    const live = await h.t.deps.db
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.runId, h.world.runId), isNull(schema.approvals.voidedAt)));
    expect(live.filter((a) => a.nonce === forged.nonce)).toHaveLength(0);
  });

  it("refuses every bad signature in the domain's order, each with its own code", async () => {
    const api = h.t.client(h.tokens.treasurer);
    const runSlug = h.world.runSlug;
    const submit = (keyId: string, payload: ApprovalPayload, signature: string) =>
      api.submitApproval({ params: { runSlug }, body: { role: "treasurer", keyId, signature, payload } });
    const db = h.t.pg?.app.db;
    if (!db) throw new Error("db");
    const fresh = async () => (await payloadFor("treasurer", h.tokens.treasurer)).payload;

    const p1 = await fresh();
    await expect(submit("fs-ghost-a1", p1, sign(analyn, p1))).rejects.toMatchObject({
      code: "KEY_NOT_REGISTERED",
      status: 403,
    });
    const revoked = await registerKey(db, h.world.workspaceId, {
      keyId: "fs-analyn-a9",
      persona: "analyn",
      revokedAt: new Date("2026-01-01T00:00:00Z"),
    });
    await expect(submit("fs-analyn-a9", p1, sign(revoked, p1))).rejects.toMatchObject({
      code: "KEY_NOT_REGISTERED",
    });
    await expect(submit("fs-ernesto-a1", p1, sign(ernesto, p1))).rejects.toMatchObject({
      code: "KEY_NOT_REGISTERED",
    });
    const maria = await registerKey(db, h.world.workspaceId, {
      keyId: "fs-maria-a1",
      persona: "treasurer:maria",
    });
    await expect(submit("fs-maria-a1", p1, sign(maria, p1))).rejects.toMatchObject({
      code: "APPROVER_MISMATCH",
      status: 403,
    });
    await expect(submit("fs-analyn-a1", p1, sign(ernesto, p1))).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
      status: 422,
    });
    const otherSeason = { ...(await fresh()), seasonId: h.world.lotId };
    await expect(submit("fs-analyn-a1", otherSeason, sign(analyn, otherSeason))).rejects.toMatchObject({
      code: "SEASON_MISMATCH",
    });
    const tampered = { ...(await fresh()), batchSha256: "f".repeat(64) };
    await expect(submit("fs-analyn-a1", tampered, sign(analyn, tampered))).rejects.toMatchObject({
      code: "DIGEST_MISMATCH",
      status: 409,
    });
    const other = { ...(await fresh()), approverId: "treasurer:maria" };
    await expect(submit("fs-analyn-a1", other, sign(analyn, other))).rejects.toMatchObject({
      code: "APPROVER_MISMATCH",
    });

    const expiring = await fresh();
    h.t.clock.advance(31 * 60_000);
    await expect(submit("fs-analyn-a1", expiring, sign(analyn, expiring))).rejects.toMatchObject({
      code: "APPROVAL_EXPIRED",
    });

    // kill_payouts on: signing is 423 (S3.11); off again by a fresh treasurer action
    await api.setFlag({ body: { flag: "kill_payouts", on: true } });
    const killed = await fresh();
    await expect(submit("fs-analyn-a1", killed, sign(analyn, killed))).rejects.toMatchObject({
      code: "KILL_SWITCH_ON",
      status: 423,
    });
    await api.setFlag({ body: { flag: "kill_payouts", on: false } });

    await expect(
      h.t.client(h.tokens.chair).submitApproval({
        params: { runSlug },
        body: {
          role: "chair",
          keyId: "fs-ernesto-a1",
          signature: sign(ernesto, killed),
          payload: { ...killed, role: "chair", approverId: "board:ernesto" },
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const none = await db.select().from(schema.approvals).where(eq(schema.approvals.runId, h.world.runId));
    expect(none).toHaveLength(0);
  });

  it("MM-5 key 1: the treasurer signs; over US$300 the run waits for the Chair (R5); the key enters the ledger first", async () => {
    const { payload } = await payloadFor("treasurer", h.tokens.treasurer);
    const r = await h.t.client(h.tokens.treasurer).submitApproval({
      params: { runSlug: h.world.runSlug },
      body: { role: "treasurer", keyId: "fs-analyn-a1", signature: sign(analyn, payload), payload },
    });
    expect(r).toMatchObject({
      runState: "AWAITING_BOARD",
      needsChair: true,
      approval: {
        role: "treasurer",
        keyId: "fs-analyn-a1",
        keyLabel: "Device key",
        voidedAt: null,
        nonce: payload.nonce,
      },
    });
    const kinds = (
      await h.t.deps.db
        .select({ kind: schema.ledgerEntries.kind })
        .from(schema.ledgerEntries)
        .where(eq(schema.ledgerEntries.workspaceId, h.world.workspaceId))
        .orderBy(asc(schema.ledgerEntries.seq))
    ).map((x) => x.kind);
    expect(kinds.indexOf("key.registered")).toBeGreaterThan(-1);
    expect(kinds.indexOf("key.registered")).toBeLessThan(kinds.lastIndexOf("approval.signed"));
  });

  it("NONCE_REUSED and SIGNERS_NOT_DISTINCT: a spent nonce, and the treasurer's own key presented as the Chair's", async () => {
    const chairApi = h.t.client(h.tokens.chair);
    const runSlug = h.world.runSlug;
    const [treasurer] = await h.t.deps.db
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.runId, h.world.runId), isNull(schema.approvals.voidedAt)));
    const fresh = (await payloadFor("chair", h.tokens.chair)).payload;
    const reused = { ...fresh, nonce: treasurer?.nonce as string };
    await expect(
      chairApi.submitApproval({
        params: { runSlug },
        body: { role: "chair", keyId: "fs-ernesto-a1", signature: sign(ernesto, reused), payload: reused },
      }),
    ).rejects.toMatchObject({ code: "NONCE_REUSED", status: 409 });
    const db = h.t.pg?.app.db;
    if (!db) throw new Error("db");
    const twin = await registerKey(db, h.world.workspaceId, {
      keyId: "fs-ernesto-a2",
      persona: "ernesto",
      seed: `runs-slice test key fs-analyn-a1 ${h.world.workspaceId}`,
    });
    expect(twin.publicKeyHex).toBe(analyn.publicKeyHex);
    await expect(
      chairApi.submitApproval({
        params: { runSlug },
        body: { role: "chair", keyId: "fs-ernesto-a2", signature: sign(twin, fresh), payload: fresh },
      }),
    ).rejects.toMatchObject({ code: "SIGNERS_NOT_DISTINCT", status: 403 });
  });

  it("declineApproval: FORBIDDEN for the clerk; the Chair's decline voids key 1 and sends the run back", async () => {
    await expect(
      h.t.client(h.tokens.clerk).declineApproval({
        params: { runSlug: h.world.runSlug },
        body: { role: "chair", reason: "not mine" },
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const r = await h.t.client(h.tokens.chair).declineApproval({
      params: { runSlug: h.world.runSlug },
      body: { role: "chair", reason: "Check slip 0457 again" },
    });
    expect(r.runState).toBe("IN_REVIEW");
    const live = await h.t.deps.db
      .select()
      .from(schema.approvals)
      .where(
        and(
          eq(schema.approvals.runId, h.world.runId),
          eq(schema.approvals.decision, "SIGNED"),
          isNull(schema.approvals.voidedAt),
        ),
      );
    expect(live).toHaveLength(0);
  });

  it("MM-5 key 2: both keys move the run to APPROVED, lock the 8 PayPal lines and queue the POST (I7)", async () => {
    const t1 = (await payloadFor("treasurer", h.tokens.treasurer)).payload;
    await h.t.client(h.tokens.treasurer).submitApproval({
      params: { runSlug: h.world.runSlug },
      body: { role: "treasurer", keyId: "fs-analyn-a1", signature: sign(analyn, t1), payload: t1 },
    });
    const c = (await payloadFor("chair", h.tokens.chair)).payload;
    expect(c).toMatchObject({ role: "chair", approverId: "board:ernesto", batchSha256: t1.batchSha256 });
    const r = await h.t.client(h.tokens.chair).submitApproval({
      params: { runSlug: h.world.runSlug },
      body: { role: "chair", keyId: "fs-ernesto-a1", signature: sign(ernesto, c), payload: c },
    });
    expect(r).toMatchObject({ runState: "APPROVED", needsChair: false, approval: { role: "chair" } });
    const run = await h.t.json<{
      run: { state: string; batchSha256: string | null; senderBatchId: string | null };
      lines: Record<string, number>;
    }>(`/v1/runs/${h.world.runSlug}`, { as: h.t.credentials.bearer(h.tokens.treasurer) });
    expect(run.body.run).toMatchObject({ state: "APPROVED", batchSha256: t1.batchSha256 });
    expect(run.body.lines.LOCKED).toBe(figures.batchItemCount);
    const tasks = await h.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
          eq(schema.taskOutbox.name, "postPayoutBatch"),
        ),
      );
    expect(tasks).toHaveLength(1);
    expect(tasks[0]?.args).toEqual({ runId: h.world.runId, senderBatchId: run.body.run.senderBatchId });
  });
});

describe("inv.i6.edit-voids: a line edit after key 1 voids both approvals and sends the run back", () => {
  let g: RunsHarness;
  beforeAll(async () => {
    g = await startRuns();
  });
  afterAll(async () => g?.close());

  it("re-entering slip 0462 at AWAITING_BOARD voids the treasurer's signature (its digest can never pay the new batch)", async () => {
    await resolveAll(g);
    const db = g.t.pg?.app.db;
    if (!db) throw new Error("db");
    const key = await registerKey(db, g.world.workspaceId, { keyId: "fs-analyn-a1", persona: "analyn" });
    const { payload } = await g.t
      .client(g.tokens.treasurer)
      .approvalPayload({ params: { runSlug: g.world.runSlug }, query: { role: "treasurer" } });
    const signed = await g.t.client(g.tokens.treasurer).submitApproval({
      params: { runSlug: g.world.runSlug },
      body: {
        role: "treasurer",
        keyId: "fs-analyn-a1",
        signature: ed25519Sign(key.privateKey, approvalBytes(payload)),
        payload,
      },
    });
    expect(signed.runState).toBe("AWAITING_BOARD");
    const edit = await g.t
      .client(g.tokens.treasurer)
      .enterField({ params: { fieldId: g.world.fields0462.gross }, body: { value: "64.90" } });
    expect(edit.derived).toEqual({ net_kg: "64.60" });
    expect(edit.logbookMatch).toBe(false);
    const run = await g.t.json<{ run: { state: string }; approvals: { voidedAt: string | null }[] }>(
      `/v1/runs/${g.world.runSlug}`,
      { as: g.t.credentials.bearer(g.tokens.treasurer) },
    );
    expect(run.body.run.state).toBe("IN_REVIEW");
    expect(run.body.approvals).toHaveLength(1);
    expect(run.body.approvals[0]?.voidedAt).not.toBeNull();
    const fresh = await g.t
      .client(g.tokens.treasurer)
      .approvalPayload({ params: { runSlug: g.world.runSlug }, query: { role: "treasurer" } });
    expect(fresh.payload.batchSha256).not.toBe(payload.batchSha256);
  });
});
