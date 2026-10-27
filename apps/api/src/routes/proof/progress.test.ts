// The Proof page's metrics and its public stream, on the seed's showcase run: every figure equals the register's
// (IC-03, read from @fairsplit/seed), and the public stream carries aggregate counters only, forward-only.
import { type ApiError, PAYOUT_ITEM_RANK } from "@fairsplit/contracts";
import { appendEvent } from "@fairsplit/db";
import { format } from "@fairsplit/domain";
import { getFigures, getLines, getRun } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProofMetrics } from "../../proof/metrics.js";
import { PROOF_PROGRESS_EVENT, ProofProgress } from "../../proof/stream.js";
import { attestCash, loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
let w: ShowcaseWorld;

beforeAll(async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  w = await loadShowcase(t.deps.db);
});
afterAll(async () => t.close());

describe("GET /v1/proof/:runSlug/metrics", () => {
  it("states the register's figures, each with its display string, and no name or receiver", async () => {
    const r = await t.json<ProofMetrics>(`/v1/proof/${w.runSlug}/metrics`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const m = r.body;
    const f = getFigures();
    expect(m.lines).toEqual({
      total: f.members,
      explained: f.members,
      display: `${f.members} of ${f.members}`,
    });
    expect(m.premium).toMatchObject({
      pool: { cents: f.premiumPoolCents },
      allocated: { cents: f.premiumPoolCents },
      allocatedBp: 10_000,
      deductedFromPremiumCents: 0,
      display: `${format.money(f.premiumPoolCents)}, 100%, no deductions (R0)`,
    });
    expect(m.paid.paypalVerified).toEqual({
      members: f.endPaidMembers,
      cents: f.endPaidCents,
      display: `${f.endPaidMembers} members, ${format.money(f.endPaidCents)}`,
    });
    expect(m.paid.due).toMatchObject({ members: f.endCashMembers, cents: f.endCashCents });
    expect(m.paid.cashAttested).toMatchObject({ members: 0, ofMembers: f.endCashMembers });
    expect(m.holds).toMatchObject({ caught: 3, keptForMembers: { cents: f.redirectedCents } });
    expect(m.holds.byKind).toEqual({ DUPLICATE_SLIP: 1, IMPLAUSIBLE_YIELD: 1, NO_RULE: 1 });
    expect(m.rails).toMatchObject({ paypalMembers: f.endPaidMembers, cashMembers: f.endCashMembers });
    expect(m.rails.display).toBe(`${f.endPaidMembers} of ${f.members} members on PayPal, 8.1% of value`);
    expect(m.timing.display).toBe("12 min 42 s");
    expect(m.progress).toMatchObject({
      items: { total: 8, confirmed: 7, returned: 1 },
      display: "7 of 8 confirmed",
    });
    const text = JSON.stringify(m);
    for (const it of getRun().items) expect(text).not.toContain(it.receiver);
  });

  it("cash handed over at the bodega moves members from due to attested", async () => {
    const cash = getLines()
      .filter((l) => l.rail === "CASH")
      .slice(0, 3);
    await attestCash(
      t.deps.db,
      w,
      cash.map((l) => l.memberNo),
    );
    const r = await t.json<ProofMetrics>(`/v1/proof/${w.runSlug}/metrics`);
    const total = cash.reduce((s, l) => s + l.netCents, 0);
    expect(r.body.paid.cashAttested).toMatchObject({
      members: 3,
      cents: total,
      ofMembers: getFigures().endCashMembers,
    });
    expect(r.body.paid.due.members).toBe(getFigures().endCashMembers - 3);
    expect(r.body.paid.due.cents).toBe(getFigures().endCashCents - total);
  });

  it("NOT_FOUND for an unknown run", async () => {
    const r = await t.json<ApiError>("/v1/proof/2026A-r31337/metrics");
    expect(r.status).toBe(404);
  });
});

describe("GET /v1/proof/:runSlug/events (public, aggregates only)", () => {
  it("moves the counters forward on run and item events; never sends an item, a member or a receiver", async () => {
    const { response, reader } = await t.sse(`/v1/proof/${w.runSlug}/events`);
    expect(response.status).toBe(200);
    const next = reader.next(10_000);
    // a stale item event (lower rank than the item already has) moves nothing and is not sent
    const rhea = must(getRun().items.find((i) => i.status === "RETURNED"));
    await appendEvent(t.deps.db, {
      workspaceId: w.workspaceId,
      runId: w.runId,
      type: "item.updated",
      actor: { kind: "paypal", id: "paypal:webhook" },
      provenance: "seeded",
      payload: {
        itemId: "x",
        senderItemId: rhea.senderItemId,
        memberNo: rhea.memberNo,
        payoutItemId: rhea.payoutItemId,
        from: "SUBMITTED",
        to: "PENDING",
        rank: PAYOUT_ITEM_RANK.PENDING,
        source: "webhook",
        eventId: "WH-STALE",
      },
    });
    await appendEvent(t.deps.db, {
      workspaceId: w.workspaceId,
      runId: w.runId,
      type: "run.state",
      actor: { kind: "system", id: "settle" },
      provenance: "seeded",
      payload: {
        runId: w.runId,
        from: "SETTLED",
        to: "CLOSED",
        cause: { code: "all_lines_terminal", ref: null },
      },
    });
    const m = await next;
    expect(m.event).toBe(PROOF_PROGRESS_EVENT);
    const progress = ProofProgress.parse(JSON.parse(m.data));
    expect(progress).toEqual({
      runSlug: w.runSlug,
      runState: "CLOSED",
      items: { total: 8, sent: 0, confirmed: 7, held: 0, parked: 0, returned: 1, failed: 0, reversed: 0 },
      display: "7 of 8 confirmed",
    });
    expect(m.data).not.toMatch(/M-\d{3}|r37-|@/);
    // replay from before both events: the stale one is skipped again, the run state is not sent backwards
    const replay = await t.sse(`/v1/proof/${w.runSlug}/events`, { headers: { "last-event-id": "0" } });
    const again = ProofProgress.parse(JSON.parse((await replay.reader.next(10_000)).data));
    expect(again.runState).toBe("CLOSED");
    await replay.reader.close();
    await reader.close();
  });

  it("caps anonymous streams at 3 per hashed IP (429 for the fourth)", async () => {
    const headers = { "true-client-ip": "203.0.113.7" };
    const open = [];
    for (let i = 0; i < 3; i++) open.push(await t.sse(`/v1/proof/${w.runSlug}/events`, { headers }));
    for (const s of open) expect(s.response.status).toBe(200);
    const fourth = await t.request(`/v1/proof/${w.runSlug}/events`, {
      headers: { ...headers, accept: "text/event-stream" },
    });
    expect(fourth.status).toBe(429);
    expect(((await fourth.json()) as ApiError).code).toBe("RATE_LIMITED");
    for (const s of open) await s.reader.close();
  });

  it("NOT_FOUND for an unknown run", async () => {
    const r = await t.request("/v1/proof/2026A-r31337/events", { headers: { accept: "text/event-stream" } });
    expect(r.status).toBe(404);
  });
});
