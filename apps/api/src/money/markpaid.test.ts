// markPaid's listed errors on the sandbox rail (msw): KILL_SWITCH_ON before anything is sent, PayPal's refusal
// (PAYPAL_REJECTED with its debug_id), its pacing (CIRCUIT_OPEN), a press while the outbox retries (QUEUED),
// and the retried attempt finally funding the run. Every attempt is an outbox row (I7); a refusal never
// blocks the next press.
import { schema } from "@fairsplit/db";
import { and, eq, like } from "drizzle-orm";
import { HttpResponse, http } from "msw";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, startRuns } from "../runs/test/app.js";
import { paypalScript, TEST_INVOICE_ID, TOOLKIT_HOST } from "../runs/test/paypal.js";

const script = paypalScript({ invoiceStatus: "UNPAID" });
let h: RunsHarness;
const payments = `${TOOLKIT_HOST}/v2/invoicing/invoices/${TEST_INVOICE_ID}/payments`;
const failWith = (status: number, name: string) =>
  http.post(payments, () =>
    HttpResponse.json(
      { name, message: name, debug_id: `dbg-${status}`, details: [], links: [] },
      { status, headers: { "paypal-debug-id": `dbg-${status}` } },
    ),
  );

beforeAll(async () => {
  h = await startRuns({ paypal: script.handlers, world: { runState: "INVOICED" } });
});
afterAll(async () => h?.close());

describe("markPaid: refusals and retries (MM-S)", () => {
  const press = () => h.t.client(h.tokens.treasurer).markPaid({ params: { runSlug: h.world.runSlug } });

  it("KILL_SWITCH_ON: kill_paypal_live refuses before any task or call; FORBIDDEN for a clerk", async () => {
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_paypal_live", on: true } });
    await expect(press()).rejects.toMatchObject({ code: "KILL_SWITCH_ON", status: 423 });
    await h.t.client(h.tokens.treasurer).setFlag({ body: { flag: "kill_paypal_live", on: false } });
    await expect(
      h.t.client(h.tokens.clerk).markPaid({ params: { runSlug: h.world.runSlug } }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(script.calls).toEqual([]);
    const tasks = await h.t.deps.db
      .select()
      .from(schema.taskOutbox)
      .where(eq(schema.taskOutbox.workspaceId, h.world.workspaceId));
    expect(tasks).toHaveLength(0);
  });

  it("PAYPAL_REJECTED: PayPal's 422 comes back with its debug_id; the run stays INVOICED", async () => {
    h.paypal?.use(failWith(422, "UNPROCESSABLE_ENTITY"));
    await expect(press()).rejects.toMatchObject({
      code: "PAYPAL_REJECTED",
      status: 502,
      paypalDebugId: "dbg-422",
    });
    const run = await h.t.json<{ run: { state: string } }>(`/v1/runs/${h.world.runSlug}`, {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    });
    expect(run.body.run.state).toBe("INVOICED");
  });

  it("CIRCUIT_OPEN: a 429 is PayPal pacing us (Retry-After); the attempt is retried by the outbox", async () => {
    h.paypal?.reset();
    h.paypal?.use(failWith(429, "RATE_LIMIT_REACHED"));
    const r = await h.t.json<{ code: string; retryAfterMs: number }>(
      `/v1/runs/${h.world.runSlug}/mark-paid`,
      {
        method: "POST",
        body: {},
        as: h.t.credentials.bearer(h.tokens.treasurer),
      },
    );
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("CIRCUIT_OPEN");
    expect(r.body.retryAfterMs).toBeGreaterThan(0);
    expect(r.headers.get("retry-after")).not.toBeNull();
    const attempts = await h.t.deps.db
      .select({ key: schema.taskOutbox.dedupeKey, state: schema.taskOutbox.state })
      .from(schema.taskOutbox)
      .where(
        and(
          eq(schema.taskOutbox.workspaceId, h.world.workspaceId),
          like(schema.taskOutbox.dedupeKey, `pay:${TEST_INVOICE_ID}%`),
        ),
      );
    expect(attempts.map((a) => [a.key, a.state]).sort()).toEqual([
      [`pay:${TEST_INVOICE_ID}`, "done"],
      [`pay:${TEST_INVOICE_ID}:r1`, "queued"],
    ]);
  });

  it("QUEUED: a press while the attempt waits for its retry says so, with when", async () => {
    await expect(press()).rejects.toMatchObject({ code: "QUEUED", status: 429 });
  });

  it("the retried attempt funds the run once PayPal answers (and the 6-minute circuit has closed)", async () => {
    h.paypal?.reset();
    const owner = h.t.pg?.owner.db;
    if (!owner) throw new Error("db");
    await owner.delete(schema.paypalCalls).where(eq(schema.paypalCalls.status, 429));
    await owner
      .update(schema.taskOutbox)
      .set({ runAfter: new Date(Date.now() - 1_000) })
      .where(eq(schema.taskOutbox.dedupeKey, `pay:${TEST_INVOICE_ID}:r1`));
    const r = await press();
    expect(r).toMatchObject({
      invoiceStatus: "MARKED_AS_PAID",
      runState: "EXTRACTING",
      provenance: "simulated_rail",
    });
    expect(script.calls.filter((c) => c === "record_payment")).toHaveLength(1);
  });
});
