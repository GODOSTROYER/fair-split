// resend (P1 re-route) pressed again after a refusal (verifier probe P12), on embedded Postgres with PayPal
// answered by msw (zero live calls). Every signed re-route has its own task row, keyed by its approval, so an
// earlier press's finished row can never answer a later one; the re-route runs only once its cancel has landed
// (it waits while the cancel is paced); an earlier press still queued when a newer one exists sends nothing; and a
// returned line whose re-route wrote no rows can still be paid in cash. A showcase workspace, so Judge Mode's live
// lane plays no part here.
import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign } from "@fairsplit/domain";
import { and, eq, like } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type RunsHarness,
  reroutePayload,
  resolveAll,
  runQueued,
  signBoth,
  startRuns,
} from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { PAYPAL_SANDBOX } from "../test/index.js";
import { settleBatch } from "./settle.js";

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
const api = () => h.t.client(h.tokens.treasurer);
const posts = () => script.calls.filter((c) => c === "create_payout_batch").length;

async function rerouteBody(memberNo: string, receiver: string, n = 1) {
  const l = await line(memberNo);
  const built = await reroutePayload(h, {
    memberNo,
    receiver,
    n,
    amountCents: l.netCents,
    nonce: randomUUID().replaceAll("-", ""),
    exp: new Date(h.t.clock.nowMs() + 20 * 60_000).toISOString(),
  });
  return {
    lineId: l.id,
    sbid: built.senderBatchId,
    body: {
      newReceiver: receiver,
      keyId: "fs-analyn-a1",
      signature: ed25519Sign(keys.analyn.privateKey, approvalBytes(built.payload)),
      payload: built.payload,
    },
  };
}
const resend = (r: Awaited<ReturnType<typeof rerouteBody>>) =>
  api().resend({ params: { lineId: r.lineId }, body: r.body });

async function rerouteRows(lineId: string) {
  return h.t.deps.db
    .select({ key: schema.taskOutbox.dedupeKey, state: schema.taskOutbox.state })
    .from(schema.taskOutbox)
    .where(
      and(
        eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
        like(schema.taskOutbox.dedupeKey, `reroute:${lineId}:%`),
      ),
    );
}

/** A kill switch flipped behind the press's back (as the treasurer's other phone would), between two PayPal calls. */
async function switchPayouts(on: boolean) {
  const owner = h.t.pg?.owner.db;
  if (!owner) throw new Error("db");
  await owner
    .insert(schema.systemFlags)
    .values({ workspaceId: h.world.workspaceId, flag: "kill_payouts", on, setBy: "test", setAt: new Date() })
    .onConflictDoUpdate({
      target: [schema.systemFlags.workspaceId, schema.systemFlags.flag],
      set: { on, setBy: "test" },
    });
}

/** Lets a waiting outbox row run now (the outbox's own schedule is the database's clock). */
async function dueNow(name: string) {
  await h.t.pg?.owner.db
    .update(schema.taskOutbox)
    .set({ runAfter: new Date(Date.now() - 1_000) })
    .where(and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.name, name)));
}

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: { kind: "showcase" } });
  await resolveAll(h);
  ({ keys } = await signBoth(h));
  await runQueued(h, "postPayoutBatch");
  const [batch] = await h.t.deps.db
    .select()
    .from(schema.payoutBatches)
    .where(eq(schema.payoutBatches.runId, h.world.runId));
  await settleBatch(h.t.deps, { batchId: batch?.id as string, n: 1 }, { workspaceId: h.world.workspaceId });
});
afterAll(async () => h?.close());

describe("resend again after a refusal", () => {
  it("P12: a press refused by kill_paypal_live leaves its queued re-route harmless; a fresh, signed press cancels and re-routes under its own row", async () => {
    expect((await line("M-031")).state).toBe("UNCLAIMED");
    await api().setFlag({ body: { flag: "kill_paypal_live", on: true } });
    const first = await rerouteBody("M-031", "m014@example.com");
    await expect(resend(first)).rejects.toMatchObject({ code: "KILL_SWITCH_ON" });
    // the dispatcher runs the first press's re-route later: its cancel never landed, so it changes nothing
    await runQueued(h, "reroute");
    expect((await line("M-031")).state).toBe("UNCLAIMED");
    await api().setFlag({ body: { flag: "kill_paypal_live", on: false } });

    const before = posts();
    const second = await rerouteBody("M-031", "m022@example.com");
    const out = await resend(second);
    expect(out).toMatchObject({
      senderBatchId: second.sbid,
      line: { memberNo: "M-031", state: "PAYPAL_PENDING" },
    });
    expect(posts()).toBe(before + 1);
    expect(script.posted.at(-1)?.sender_batch_header.sender_batch_id).toBe(second.sbid);
    expect(script.posted.at(-1)?.items.map((i) => i.receiver)).toEqual(["m022@example.com"]);
    // one task row per signed re-route: the first press's finished row never answered the second
    const rows = await rerouteRows(first.lineId);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.key)).size).toBe(2);
    expect(rows.every((r) => r.state === "done")).toBe(true);
  });

  it("a returned line whose re-route wrote nothing (refused after the cancel landed) is paid in cash", async () => {
    const m002 = await line("M-002");
    expect(m002.state).toBe("UNCLAIMED");
    // the cancel lands at PayPal, then payouts are paused before the re-route's POST
    h.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id/cancel`, async ({ params }) => {
        script.calls.push("cancel_unclaimed");
        await switchPayouts(true);
        return HttpResponse.json({
          payout_item_id: params.id,
          payout_batch_id: script.batchIdOf(0),
          transaction_status: "RETURNED",
          payout_item: { receiver: "m002@example.com", amount: { currency: "USD", value: "1.00" } },
        });
      }),
    );
    const before = posts();
    const r = await rerouteBody("M-002", "m014@example.com");
    await expect(resend(r)).rejects.toMatchObject({ code: "KILL_SWITCH_ON" });
    h.paypal?.reset();
    await switchPayouts(false);
    expect(posts()).toBe(before);
    expect((await line("M-002")).state).toBe("RETURNED");
    // no re-route rows were written and none is waiting: the treasurer can pay at the bodega instead
    const cash = await api().payCash({ params: { lineId: m002.id } });
    expect(cash).toMatchObject({ line: { memberNo: "M-002", state: "OFF_RAIL_DUE" } });
  });

  it("an earlier signed re-route still queued when a newer one exists is superseded and sends nothing", async () => {
    const m007 = await line("M-007");
    expect(m007.state).toBe("UNCLAIMED");
    // press A: its cancel is refused (PayPal calls paused), so A's re-route stays queued, unrun
    await api().setFlag({ body: { flag: "kill_paypal_live", on: true } });
    const a = await rerouteBody("M-007", "m014@example.com");
    await expect(resend(a)).rejects.toMatchObject({ code: "KILL_SWITCH_ON" });
    await api().setFlag({ body: { flag: "kill_paypal_live", on: false } });
    expect((await rerouteRows(a.lineId)).map((x) => x.state)).toEqual(["queued"]);
    // press B: its cancel lands, then its own re-route is refused (payouts paused again behind its back)
    h.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id/cancel`, async ({ params }) => {
        script.calls.push("cancel_unclaimed");
        await switchPayouts(true);
        return HttpResponse.json({
          payout_item_id: params.id,
          payout_batch_id: script.batchIdOf(0),
          transaction_status: "RETURNED",
          payout_item: { receiver: "m007@example.com", amount: { currency: "USD", value: "1.00" } },
        });
      }),
    );
    const b = await rerouteBody("M-007", "m022@example.com");
    await expect(resend(b)).rejects.toMatchObject({ code: "KILL_SWITCH_ON" });
    h.paypal?.reset();
    await switchPayouts(false);
    expect((await line("M-007")).state).toBe("RETURNED");
    // A runs now, after the cancel landed: B is the treasurer's latest word, so A pays no one
    const before = posts();
    await dueNow("reroute");
    await runQueued(h, "reroute");
    expect(posts()).toBe(before);
    expect((await line("M-007")).state).toBe("RETURNED");
  });

  it("a re-route waits for its cancel: PayPal paced the cancel, and the re-route posts once the cancel lands", async () => {
    // M-031 was re-routed above (x1): its new item, paid to m022, parks again so it can be re-routed as x2
    const rhea = await line("M-031");
    const db = h.t.pg?.owner.db;
    if (!db) throw new Error("db");
    const [item] = await db
      .select()
      .from(schema.payoutItems)
      .where(and(eq(schema.payoutItems.lineId, rhea.id), like(schema.payoutItems.senderItemId, "%x1-M-031")));
    if (!item) throw new Error("no x1 re-route item");
    const [batch] = await db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.id, item.batchId));
    const x1ItemId = "PITX1M031";
    h.paypal?.use(
      http.get(`${PAYPAL_SANDBOX}/v1/payments/payouts/:batchId`, ({ params }) =>
        HttpResponse.json({
          total_items: 1,
          total_pages: 1,
          batch_header: {
            payout_batch_id: params.batchId,
            batch_status: "SUCCESS",
            sender_batch_header: { sender_batch_id: batch?.senderBatchId },
          },
          items: [
            {
              payout_item_id: x1ItemId,
              payout_batch_id: params.batchId,
              transaction_status: "UNCLAIMED",
              payout_item: {
                receiver: item.receiver,
                amount: { currency: "USD", value: "1.00" },
                sender_item_id: item.senderItemId,
              },
            },
          ],
        }),
      ),
    );
    await settleBatch(h.t.deps, { batchId: item.batchId, n: 1 }, { workspaceId: h.world.workspaceId });
    h.paypal?.reset();
    expect((await line("M-031")).state).toBe("UNCLAIMED");

    // the cancel is paced (429): the press answers that it waits; the re-route has not run
    h.paypal?.use(
      http.post(`${PAYPAL_SANDBOX}/v1/payments/payouts-item/:id/cancel`, () =>
        HttpResponse.json(
          { name: "RATE_LIMIT_REACHED", message: "slow down", debug_id: "dbg-429", details: [], links: [] },
          { status: 429, headers: { "paypal-debug-id": "dbg-429" } },
        ),
      ),
    );
    const r = await rerouteBody("M-031", "m039@example.com", 2);
    expect(r.sbid).toMatch(/-x2-M-031$/);
    await expect(resend(r)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    // the dispatcher reaches the re-route first: the cancel is still waiting, so the re-route waits too
    const before = posts();
    await dueNow("reroute");
    await runQueued(h, "reroute");
    expect(posts()).toBe(before);
    expect((await line("M-031")).state).toBe("UNCLAIMED");
    expect((await rerouteRows(rhea.id)).filter((x) => x.state === "dead")).toEqual([]);

    // the circuit closes, the cancel lands, and the waiting re-route posts
    h.paypal?.reset();
    await h.t.pg?.owner.db.delete(schema.paypalCalls).where(eq(schema.paypalCalls.status, 429));
    h.t.clock.advance(7 * 60_000);
    await dueNow("cancelUnclaimed");
    await runQueued(h, "cancelUnclaimed");
    expect((await line("M-031")).state).toBe("RETURNED");
    await dueNow("reroute");
    await runQueued(h, "reroute");
    expect(posts()).toBe(before + 1);
    expect(script.posted.at(-1)?.sender_batch_header.sender_batch_id).toBe(r.sbid);
    expect((await line("M-031")).state).toBe("PAYPAL_PENDING");
  });
});
