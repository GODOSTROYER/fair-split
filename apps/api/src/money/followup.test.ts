// After the POST, on embedded Postgres with PayPal answered by msw: verified webhooks applied by rank
// (processWebhook), the settle GET, three parked items (Rhea M-031, M-002, M-007), and every listed error of
// payCash and resend (P1 re-route) on them, ending in a one-item re-route batch `-x1`.
import { randomUUID } from "node:crypto";
import type { ApprovalPayload } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import {
  approvalBytes,
  approvalJcs,
  batchDigest,
  ed25519Sign,
  senderBatchId,
  senderItemId,
} from "@fairsplit/domain";
import { and, eq, like } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/testing/app.js";
import { paypalScript } from "../runs/testing/paypal.js";
import { registerKey } from "../runs/testing/world.js";
import { PAYPAL_SANDBOX } from "../test/index.js";
import { processWebhook, settleBatch } from "./settle.js";

const script = paypalScript({ parked: ["rhea", "m002", "m007"] });
let h: RunsHarness;
let keys: Awaited<ReturnType<typeof signBoth>>["keys"];

interface LineView {
  id: string;
  memberNo: string;
  state: string;
  netCents: number;
}
const lines = async () =>
  (
    await h.t.json<{ lines: LineView[] }>(`/v1/runs/${h.world.runSlug}/lines`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    })
  ).body.lines;
const line = async (memberNo: string) => (await lines()).find((l) => l.memberNo === memberNo) as LineView;
const runState = async () =>
  (
    await h.t.json<{ run: { state: string } }>(`/v1/runs/${h.world.runSlug}`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    })
  ).body.run.state;

async function storeWebhook(
  event: { id: string; event_type: string; resource: Record<string, unknown> },
  verified: "self" | "fetched",
) {
  const db = h.t.pg?.owner.db;
  if (!db) throw new Error("db");
  const [row] = await db
    .insert(schema.webhookEvents)
    .values({
      paypalEventId: event.id,
      eventType: event.event_type,
      verified,
      raw: JSON.stringify(event),
      status: "received",
      provenance: "live",
    })
    .returning({ id: schema.webhookEvents.id });
  return row?.id as string;
}
const complete = { complete: async () => undefined };

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: {} });
  await resolveAll(h);
  ({ keys } = await signBoth(h));
  await runQueued(h, "postPayoutBatch");
});
afterAll(async () => h?.close());

describe("processWebhook: verified events applied by rank (S3.6.5)", () => {
  it("a self-verified PAYOUTS-ITEM.SUCCEEDED applies at once (MM-1), with webhook.applied in the ledger", async () => {
    const posted = script.posted[0];
    const i = posted?.items.findIndex((it) => it.sender_item_id.endsWith("M-014")) ?? -1;
    const id = await storeWebhook(
      {
        id: "WH-TEST-0001",
        event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        resource: {
          payout_item_id: script.itemIdOf(0, i),
          payout_batch_id: script.batchIdOf(0),
          transaction_status: "SUCCESS",
          payout_item: { sender_item_id: posted?.items[i]?.sender_item_id },
        },
      },
      "self",
    );
    const before = script.calls.length;
    await processWebhook(h.t.deps, { webhookEventId: id, paypalEventId: "WH-TEST-0001" }, complete);
    expect(script.calls.length).toBe(before); // no GET: the signature vouches for it
    expect((await line("M-014")).state).toBe("PAID");
    expect(await runState()).toBe("SETTLING");
    const [row] = await h.t.deps.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, id));
    expect(row).toMatchObject({ status: "applied", workspaceId: h.world.workspaceId });
    const applied = await h.t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, h.world.workspaceId),
          eq(schema.ledgerEntries.kind, "webhook.applied"),
        ),
      );
    expect(applied.map((a) => a.payload)).toEqual([
      expect.objectContaining({ resource: "payout_item", status: "SUCCESS", eventId: "WH-TEST-0001" }),
    ]);
  });

  it("anything a signature does not vouch for changes state only after a fresh GET; an unknown resource is an orphan", async () => {
    const posted = script.posted[0];
    const i = posted?.items.findIndex((it) => it.sender_item_id.endsWith("M-022")) ?? -1;
    const id = await storeWebhook(
      {
        id: "WH-TEST-0002",
        event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        resource: {
          payout_item_id: script.itemIdOf(0, i),
          payout_batch_id: script.batchIdOf(0),
          payout_item: { sender_item_id: posted?.items[i]?.sender_item_id },
        },
      },
      "fetched",
    );
    await processWebhook(h.t.deps, { webhookEventId: id, paypalEventId: "WH-TEST-0002" }, complete);
    expect(script.calls.at(-1)).toBe("get_payout_item");
    expect((await line("M-022")).state).toBe("PAID");
    const orphan = await storeWebhook(
      {
        id: "WH-TEST-0003",
        event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
        resource: { payout_item_id: "PITNOTOURS", payout_batch_id: "PBNOTOURS" },
      },
      "self",
    );
    await processWebhook(h.t.deps, { webhookEventId: orphan, paypalEventId: "WH-TEST-0003" }, complete);
    const [row] = await h.t.deps.db
      .select()
      .from(schema.webhookEvents)
      .where(eq(schema.webhookEvents.id, orphan));
    expect(row?.status).toBe("orphan");
  });

  it("the settle GET applies the rest by rank: 5 paid, 3 parked, the run needs follow-up", async () => {
    const [batch] = await h.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, h.world.runId));
    await settleBatch(h.t.deps, { batchId: batch?.id as string, n: 1 }, { workspaceId: h.world.workspaceId });
    const all = await lines();
    expect(all.filter((l) => l.state === "PAID")).toHaveLength(5);
    expect(
      all
        .filter((l) => l.state === "UNCLAIMED")
        .map((l) => l.memberNo)
        .sort(),
    ).toEqual(["M-002", "M-007", "M-031"]);
    expect(await runState()).toBe("NEEDS_FOLLOW_UP");
    // a follow-up GET was queued for the open items (+90 s)
    const next = await h.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(like(schema.taskOutbox.dedupeKey, `settle:${batch?.id}:2`));
    expect(next).toHaveLength(1);
  });
});

describe("resend (P1 re-route): every refusal, then a one-item batch", () => {
  const newReceiver = "m014@example.com"; // a known sandbox account (the guard pays no one else)
  async function rerouteBody(
    memberNo: string,
    o: {
      keyId?: string;
      key?: { privateKey: Parameters<typeof ed25519Sign>[0] };
      mutate?: (p: ApprovalPayload) => ApprovalPayload;
      receiver?: string;
    } = {},
  ) {
    const l = await line(memberNo);
    const sbid = senderBatchId("2026A", h.world.rateCardSha256, h.world.runSeq, 1);
    const sid = senderItemId(h.world.runSeq, memberNo, 1);
    const digest = batchDigest(
      { runId: h.world.runId, senderBatchId: sbid, rateCardSha256: h.world.rateCardSha256 },
      [{ senderItemId: sid, receiver: o.receiver ?? newReceiver, amountCents: l.netCents, currency: "USD" }],
    );
    let payload: ApprovalPayload = {
      v: 1,
      runId: h.world.runId,
      seasonId: h.world.seasonId,
      rateCardSha256: h.world.rateCardSha256,
      batchSha256: digest.batchSha256,
      itemCount: 1,
      totalCents: l.netCents,
      currency: "USD",
      role: "treasurer",
      approverId: "treasurer:analyn",
      nonce: randomUUID().replaceAll("-", ""),
      exp: new Date(h.t.clock.nowMs() + 20 * 60_000).toISOString(),
    };
    if (o.mutate) payload = o.mutate(payload);
    const signer = o.key ?? keys.analyn;
    return {
      lineId: l.id,
      body: {
        newReceiver: o.receiver ?? newReceiver,
        keyId: o.keyId ?? "fs-analyn-a1",
        signature: ed25519Sign(signer.privateKey, approvalBytes(payload)),
        payload,
      },
      payload,
      sbid,
    };
  }
  const resend = (
    lineId: string,
    body: Awaited<ReturnType<typeof rerouteBody>>["body"],
    token = h.tokens.treasurer,
  ) => h.t.client(token).resend({ params: { lineId }, body });

  it("INVALID_TRANSITION for a paid line or an unknown receiver; KEY_NOT_REGISTERED; APPROVER_MISMATCH; SIGNATURE_INVALID; KILL_SWITCH_ON", async () => {
    const paid = await rerouteBody("M-014");
    await expect(resend(paid.lineId, paid.body)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
    const stranger = await rerouteBody("M-031", { receiver: "stranger@example.com" });
    await expect(resend(stranger.lineId, stranger.body)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      details: { reason: "RECEIVER_NOT_KNOWN" },
    });
    const ghost = await rerouteBody("M-031", { keyId: "fs-ghost-a1" });
    await expect(resend(ghost.lineId, ghost.body)).rejects.toMatchObject({ code: "KEY_NOT_REGISTERED" });
    const chair = await rerouteBody("M-031", { mutate: (p) => ({ ...p, role: "chair" }) });
    await expect(resend(chair.lineId, chair.body)).rejects.toMatchObject({ code: "APPROVER_MISMATCH" });
    const db = h.t.pg?.app.db;
    if (!db) throw new Error("db");
    const maria = await registerKey(db, h.world.workspaceId, {
      keyId: "fs-maria-a1",
      persona: "treasurer:maria",
    });
    const notMine = await rerouteBody("M-031", { keyId: "fs-maria-a1", key: maria });
    await expect(resend(notMine.lineId, notMine.body)).rejects.toMatchObject({ code: "APPROVER_MISMATCH" });
    const forged = await rerouteBody("M-031", { key: keys.ernesto });
    await expect(resend(forged.lineId, forged.body)).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
      status: 422,
    });
    const otherAmount = await rerouteBody("M-031", {
      mutate: (p) => ({ ...p, totalCents: p.totalCents + 100 }),
    });
    await expect(resend(otherAmount.lineId, otherAmount.body)).rejects.toMatchObject({
      code: "SIGNATURE_INVALID",
      details: { reason: "DIGEST_MISMATCH" },
    });
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: true } });
    const killed = await rerouteBody("M-031");
    await expect(resend(killed.lineId, killed.body)).rejects.toMatchObject({
      code: "KILL_SWITCH_ON",
      status: 423,
    });
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_payouts", on: false } });
    expect(script.calls.filter((c) => c === "cancel_unclaimed")).toHaveLength(0);
  });

  it("Rhea's parked item is cancelled for a re-route and paid again as `-x1` to her new account", async () => {
    const r = await rerouteBody("M-031");
    const out = await resend(r.lineId, r.body);
    expect(out).toMatchObject({
      senderBatchId: r.sbid,
      line: { memberNo: "M-031", state: "PAYPAL_PENDING" },
    });
    const reroute = script.posted.at(-1);
    expect(reroute?.sender_batch_header.sender_batch_id).toBe(r.sbid);
    expect(reroute?.items).toEqual([
      expect.objectContaining({
        receiver: "m014@example.com",
        sender_item_id: senderItemId(h.world.runSeq, "M-031", 1),
      }),
    ]);
    const [approval] = await h.t.deps.db
      .select()
      .from(schema.approvals)
      .where(and(eq(schema.approvals.runId, h.world.runId), eq(schema.approvals.nonce, r.payload.nonce)));
    expect(approval).toMatchObject({ payloadJcs: approvalJcs(r.payload), voidReason: "reroute" });
    // the same signature again is a spent nonce
    await expect(resend(r.lineId, r.body)).rejects.toMatchObject({ code: "INVALID_TRANSITION" });
  });

  it("a second item of the same run cannot take the same -x1 re-route id: refused before anything is cancelled", async () => {
    const before = script.calls.filter((c) => c === "cancel_unclaimed").length;
    const r = await rerouteBody("M-007");
    await expect(resend(r.lineId, r.body)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      details: { reason: "REROUTE_ID_TAKEN" },
    });
    expect(script.calls.filter((c) => c === "cancel_unclaimed").length).toBe(before);
    expect((await line("M-007")).state).toBe("UNCLAIMED");
  });
});

describe("payCash on a parked item: KILL_SWITCH_ON, CIRCUIT_OPEN, PAYPAL_REJECTED, then cash", () => {
  it("refuses while payouts are paused, maps PayPal's pacing and refusals, and finally moves M-002 to cash", async () => {
    const m002 = await line("M-002");
    const api = h.t.client(h.tokens.treasurer);
    await api.setFlag({ body: { flag: "kill_payouts", on: true } });
    await expect(api.payCash({ params: { lineId: m002.id } })).rejects.toMatchObject({
      code: "KILL_SWITCH_ON",
    });
    await api.setFlag({ body: { flag: "kill_payouts", on: false } });

    h.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id/cancel`, () =>
        HttpResponse.json(
          { name: "RATE_LIMIT_REACHED", message: "slow down", debug_id: "dbg-429", details: [], links: [] },
          { status: 429, headers: { "paypal-debug-id": "dbg-429" } },
        ),
      ),
    );
    await expect(api.payCash({ params: { lineId: m002.id } })).rejects.toMatchObject({
      code: "CIRCUIT_OPEN",
      status: 503,
    });
    h.t.clock.advance(7 * 60_000); // the memory limiter's 6-minute circuit closes
    await h.t.pg?.owner.db
      .update(schema.taskOutbox)
      .set({ runAfter: new Date(Date.now() - 1_000) })
      .where(eq(schema.taskOutbox.name, "cancelUnclaimed"));

    h.paypal?.reset();
    h.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id/cancel`, () =>
        HttpResponse.json(
          { name: "NOT_AUTHORIZED", message: "no", debug_id: "dbg-403", details: [], links: [] },
          { status: 403, headers: { "paypal-debug-id": "dbg-403" } },
        ),
      ),
      ...script.handlers,
    );
    await expect(api.payCash({ params: { lineId: m002.id } })).rejects.toMatchObject({
      code: "PAYPAL_REJECTED",
      paypalDebugId: "dbg-403",
    });

    h.paypal?.reset();
    h.paypal?.use(...script.handlers);
    const r = await api.payCash({ params: { lineId: m002.id } });
    expect(r).toMatchObject({ cancelled: true, line: { memberNo: "M-002", state: "OFF_RAIL_DUE" } });
  });
});
