// E-01 v1 (a): one judge run end to end through fs-api, with the treasurer and the Chair scripted the way the
// console and the Chair's frame call it (plan E1; the console's http mode lands with C5b, so the browser half is in
// specs/browser). Keyless and on the in-process simulator: the reading is the seed's labelled stand-in, every
// PayPal step is "Simulated PayPal sandbox", and nothing may claim a live Claude reading.
//
// Asserted, in order: the first press and its rail; INVOICED, Mark paid and the reading to IN_REVIEW with 4 open /
// 3 blocking holds and slip 0462's by-hand field; the review; the I4 refusal (change_payout armed before key 2:
// both keys in, the POST re-hashes the batch, refuses, sends nothing and voids both approvals); both keys again,
// the POST, 7 PayPal and 57 cash lines (Rhea UNCLAIMED → cash); the phases in order; the simulated label on every
// PayPal-derived value; Proof (64 of 64 explained, US$21.14 kept, chain, checkpoint and all six plates); Reset
// within 10 s and a second press that works.
import { getSnapshot } from "@fairsplit/seed";
import { Api, type JudgeSession, type RunProbe, waitForRun } from "../../lib/api.js";
import { expect, test } from "../../lib/fixtures.js";
import {
  bothKeys,
  type Collector,
  type Officers,
  officers,
  POSTED_OR_LATER,
  pressToReview,
  runState,
  workTheReview,
} from "../../lib/judge-run.js";

test.describe.configure({ mode: "serial" });

const SIMULATED_LABEL = "Simulated PayPal sandbox (contract-tested against PayPal's OpenAPI specs)";
/** The run's phases, from the first press to settled, with the I4 send-back and the second signing. */
const PHASES = [
  "DRAFT→QUOTED",
  "QUOTED→INVOICED",
  "INVOICED→FUNDED",
  "FUNDED→EXTRACTING",
  "EXTRACTING→COMPUTED",
  "COMPUTED→IN_REVIEW",
  "IN_REVIEW→TREASURER_APPROVED",
  "TREASURER_APPROVED→AWAITING_BOARD",
  "AWAITING_BOARD→APPROVED",
  "APPROVED→IN_REVIEW",
  "IN_REVIEW→TREASURER_APPROVED",
  "TREASURER_APPROVED→AWAITING_BOARD",
  "AWAITING_BOARD→APPROVED",
  "APPROVED→POSTING",
  "POSTING→POSTED",
  "POSTED→SETTLING",
  "SETTLING→NEEDS_FOLLOW_UP",
  "NEEDS_FOLLOW_UP→SETTLED",
];
/** States PayPal's (simulated) answers move the run into: their run.state events carry the simulated provenance. */
const PAYPAL_STATES = [
  "QUOTED",
  "INVOICED",
  "FUNDED",
  "POSTING",
  "POSTED",
  "SETTLING",
  "NEEDS_FOLLOW_UP",
  "SETTLED",
];

let api: Api;
let s: JudgeSession;
let events: Collector;
let reviewed: RunProbe | null;
let keys: Officers;

test.afterAll(async () => {
  await events?.stop();
});

test("the first press starts a judge run on the simulated rail", async ({ origin }) => {
  api = new Api(origin);
  const start = await pressToReview(api);
  s = start.s;
  events = start.events;
  reviewed = start.reviewed;
  expect(s.answer.status).toBe(201);
  expect(s.answer.headers.get("x-fs-rail")).toBe("simulated");
  const session = await api.get("/v1/judge/session", s.asTreasurer);
  expect(session.status).toBe(200);
  expect(session.json).toMatchObject({
    runSlug: s.runSlug,
    rail: { mode: "live", reason: null, rail: "simulated", label: SIMULATED_LABEL },
  });
  expect(start.invoiced?.run.state).toBe("INVOICED");
  expect(start.invoiced?.invoice).toMatchObject({ provenance: "simulated_rail" });
  expect(start.markPaid.status).toBe(200);
  expect(start.markPaid.json).toMatchObject({ provenance: "simulated_rail" });
});

test("the reading reaches IN_REVIEW with 4 open / 3 blocking holds and slip 0462 by hand", async () => {
  expect(reviewed?.run.state).toBe("IN_REVIEW");
  expect(reviewed?.holds).toMatchObject({ open: 4, blocking: 3 });
  expect(reviewed?.lines).toEqual({ HELD: 4, READY: 60 });
  // keyless replay: every reading event is the seed's stand-in, never a live Claude read
  const reading = events.events.filter((e) => e.type.startsWith("extract."));
  expect(reading.length).toBeGreaterThan(0);
  expect(new Set(reading.map((e) => e.provenance))).toEqual(new Set(["seeded"]));

  if (!reviewed) throw new Error("no review");
  const review = await workTheReview(api, s);
  expect(review.field, "slip 0462 has a gross_kg field to enter by hand").toBeDefined();
  expect(review.byHand.status).toBe(200);
  expect(review.byHand.json).toMatchObject({
    field: { field: "gross_kg", finalValue: "64.80", decidedBy: "person", provenance: "seeded" },
  });
  expect(review.resolved).toEqual({ H1: 200, H2: 200, H3: 200 });
  const after = await waitForRun(api, s, (r) => r.holds.open === 0, 15_000);
  expect(after?.holds).toMatchObject({ open: 0, blocking: 0 });
  expect(after?.lines).toEqual({ READY: 64 });
});

test("I4: change_payout armed before key 2 is refused after both keys and voids the approvals", async () => {
  const arm = await api.post(
    `/v1/judge/sessions/${s.sessionId}/tamper`,
    { kind: "change_payout" },
    s.asJudge,
  );
  expect(arm.status).toBe(200);
  expect(arm.json).toMatchObject({
    kind: "change_payout",
    armed: true,
    simulated: true,
    paypalCalls: 0,
    label: "Simulated tamper: one payout changes by 1 cent after both keys",
  });
  keys = await officers(api, s);
  const [key1, key2] = await bothKeys(api, s, keys);
  expect(key1.status).toBe(201);
  expect(key1.json).toMatchObject({ runState: "AWAITING_BOARD", needsChair: true });
  expect(key2.status).toBe(201);
  expect(key2.json).toMatchObject({ runState: "APPROVED" });

  // the POST re-hashes the batch from the database, refuses before any PayPal call and sends the run back
  const sentBack = await events.waitFor(
    (e) => runState("IN_REVIEW")(e) && e.payload.from === "APPROVED",
    60_000,
  );
  expect(sentBack, "APPROVED → IN_REVIEW after the refused POST").not.toBeNull();
  expect(sentBack?.payload.cause).toEqual({ code: "SEND_BACK", ref: "DIGEST_MISMATCH" });
  const posting = events.events.find(runState("POSTING"));
  expect(posting, "nothing was posted to PayPal").toBeUndefined();
  const approvals = (await api.get(`/v1/runs/${s.runSlug}/approvals`, s.asTreasurer)).json as {
    approvals: { role: string; voidedAt: string | null }[];
  };
  expect(approvals.approvals.map((a) => [a.role, a.voidedAt !== null]).sort()).toEqual([
    ["chair", true],
    ["treasurer", true],
  ]);
  const run = await waitForRun(api, s, (r) => r.run.state === "IN_REVIEW", 10_000);
  expect(run?.lines).toEqual({ READY: 64 });
  const session = (await api.get("/v1/judge/session", s.asTreasurer)).json;
  expect(session).toMatchObject({ tamper: { changePayoutArmed: false } });
});

test("both keys again: the batch posts; 7 PayPal lines and 57 cash, Rhea UNCLAIMED → cash", async () => {
  const [key1, key2] = await bothKeys(api, s, keys);
  expect([key1.status, key2.status]).toEqual([201, 201]);
  const posted = await waitForRun(api, s, (r) => POSTED_OR_LATER.includes(r.run.state), 60_000);
  expect(POSTED_OR_LATER).toContain(posted?.run.state);
  const followUp = await waitForRun(api, s, (r) => r.run.state === "NEEDS_FOLLOW_UP", 180_000);
  expect(followUp?.run.state).toBe("NEEDS_FOLLOW_UP");
  expect(followUp?.lines).toEqual({ PAID: 7, UNCLAIMED: 1, OFF_RAIL_DUE: 56 });

  const lines = (await api.get(`/v1/runs/${s.runSlug}/lines`, s.asTreasurer)).json as {
    lines: { id: string; memberNo: string; state: string; rail: string }[];
  };
  const rhea = lines.lines.find((l) => l.state === "UNCLAIMED");
  expect(rhea?.memberNo).toBe("M-031");
  const cash = await api.post(`/v1/lines/${rhea?.id}/pay-cash`, {}, s.asTreasurer);
  expect(cash.status).toBe(200);
  expect(cash.json).toMatchObject({ cancelled: true, line: { memberNo: "M-031", state: "OFF_RAIL_DUE" } });
  // the simulator answers the cancel RETURNED and signs a CANCELED delivery fs-api verifies
  const returned = await events.waitFor(
    (e) => e.type === "item.updated" && e.payload.memberNo === "M-031" && e.payload.to === "RETURNED",
    30_000,
  );
  expect(returned?.provenance).toBe("simulated_rail");
  const settled = await waitForRun(api, s, (r) => r.run.state === "SETTLED", 60_000);
  expect(settled?.run.state).toBe("SETTLED");
  expect(settled?.lines).toEqual({ PAID: 7, OFF_RAIL_DUE: 57 });
  const final = (await api.get(`/v1/runs/${s.runSlug}/lines`, s.asTreasurer)).json as typeof lines;
  const paypal = final.lines.filter((l) => l.state === "PAID");
  const cashLines = final.lines.filter((l) => l.state !== "PAID");
  expect(paypal).toHaveLength(7);
  expect(paypal.every((l) => l.rail === "PAYPAL")).toBe(true);
  expect(cashLines).toHaveLength(57);
  await events.waitFor(runState("SETTLED"), 10_000);
});

test("the run's phases arrive in order", async () => {
  const phases = events.events
    .filter((e) => e.type === "run.state")
    .map((e) => `${String(e.payload.from)}→${String(e.payload.to)}`);
  expect(phases).toEqual(PHASES);
});

test("every PayPal-derived value is labelled simulated (X-FS-Rail and the DTO labels)", async () => {
  // every /v1 answer this run had
  const v1 = api.exchanges.filter((x) => x.path.startsWith("/v1/"));
  expect(v1.length).toBeGreaterThan(20);
  expect(v1.filter((x) => x.rail !== "simulated")).toEqual([]);
  const view = (await api.get(`/v1/runs/${s.runSlug}`, s.asTreasurer)).json as RunProbe & {
    run: { provenance: string };
  };
  expect(view.rail).toBe("simulated");
  expect(view.run.provenance).toBe("simulated_rail");
  expect(view.invoice?.provenance).toBe("simulated_rail");
  // PayPal's answers on the stream: invoice and payout steps, item updates and the simulator's signed webhooks
  const paypalEvents = events.events.filter(
    (e) =>
      e.type === "item.updated" ||
      e.type === "webhook.received" ||
      (e.type === "run.state" && PAYPAL_STATES.includes(String(e.payload.to))),
  );
  expect(paypalEvents.length).toBeGreaterThan(10);
  expect(paypalEvents.filter((e) => e.provenance !== "simulated_rail")).toEqual([]);
  const webhooks = events.events.filter((e) => e.type === "webhook.received");
  expect(webhooks.length).toBeGreaterThan(0);
  expect(webhooks.every((e) => e.payload.verified === "self")).toBe(true);
  // the only replay is the paused audit agent's placeholder turn (agent.* and its policy verdicts), labelled so;
  // and no event that names Claude says it live: on this keyless run every Claude mention is a labelled replay
  const replayed = new Set(events.events.filter((e) => e.provenance === "replay").map((e) => e.type));
  expect([...replayed].filter((t) => !t.startsWith("agent.") && t !== "policy.verdict")).toEqual([]);
  const claude = events.events.filter((e) => JSON.stringify(e.payload).includes("Claude"));
  expect(claude.filter((e) => e.provenance !== "replay").map((e) => e.type)).toEqual([]);
});

test("Proof: 64 of 64 explained, US$21.14 kept, the chain and all six plates match", async () => {
  // "PayPal-verified" counts a SUCCESS item once its simulator-signed webhook is verified and stored; those land
  // after the status checks that settle the run, so the count may trail SETTLED by a moment
  const verified = async () => {
    const m = (await api.get(`/v1/proof/${s.runSlug}/metrics`)).json as {
      paid?: { paypalVerified?: { members?: number } };
    } | null;
    return m?.paid?.paypalVerified?.members ?? -1;
  };
  await expect.poll(verified, { timeout: 60_000, intervals: [500, 1_000, 2_000] }).toBe(7);
  const metrics = await api.get(`/v1/proof/${s.runSlug}/metrics`);
  expect(metrics.status).toBe(200);
  expect(metrics.headers.get("x-fs-rail")).toBe("simulated");
  const kept = getSnapshot().figures.redirectedCents;
  expect(kept).toBe(2114);
  expect(metrics.json).toMatchObject({
    runState: "SETTLED",
    provenance: "simulated_rail",
    lines: { total: 64, explained: 64, display: "64 of 64" },
    holds: { caught: 3, keptForMembers: { cents: kept, display: "US$21.14" } },
    rails: { paypalMembers: 7, cashMembers: 57 },
    paid: { paypalVerified: { members: 7 } },
  });
  const proof = await api.get(`/v1/proof/${s.runSlug}/verification`);
  expect(proof.status).toBe(200);
  const v = proof.json as {
    provenance: string;
    demoMode: boolean;
    verification: {
      status: string;
      chain: { ok: boolean };
      checkpoint: { ok: boolean };
      plates: Record<string, { ok: boolean; reason: string | null }>;
      sampleKeys: string[];
    };
  };
  expect(v.provenance).toBe("simulated_rail");
  // browser demo keys sign in Judge Mode: Proof reads "Sample", never a verified production signature
  expect(v.demoMode).toBe(true);
  expect(v.verification.status).toBe("sample");
  expect(v.verification.sampleKeys.sort()).toEqual([keys.treasurer.keyId, keys.chair.keyId].sort());
  expect(v.verification.chain.ok).toBe(true);
  expect(v.verification.checkpoint.ok).toBe(true);
  expect(Object.keys(v.verification.plates).sort()).toEqual(
    ["computed", "paid", "payoutItems", "ratified", "read", "twoKeys"].sort(),
  );
  expect(Object.entries(v.verification.plates).filter(([, p]) => !p.ok)).toEqual([]);
});

test.fixme("approvals signed with a browser demo key read 'Demo key (this browser)'", async () => {
  // WS-API (apps/api/src/runs/dto.ts keyLabel): the label matches keyIds ending -w<digits>, but POST
  // /v1/judge/keys mints fs-<persona>-demo-<6 base36> (judge/keys.ts), so both demo keys read "Device key" in
  // GET /v1/runs/:slug/approvals and the approval answers. Un-fixme when the two agree.
  const approvals = (await api.get(`/v1/runs/${s.runSlug}/approvals`, s.asTreasurer)).json as {
    approvals: { keyLabel: string }[];
  };
  expect(approvals.approvals.every((a) => a.keyLabel === "Demo key (this browser)")).toBe(true);
});

test("Reset ends the session within 10 s and a second press works", async () => {
  await events.stop();
  const pressed = Date.now();
  const reset = await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
  const resetMs = Date.now() - pressed;
  expect(reset.status).toBe(200);
  expect(reset.json).toMatchObject({ reset: true, sessionId: s.sessionId, workspaceId: s.workspaceId });
  // the old workspace's tokens are revoked
  const stale = await api.get(`/v1/runs/${s.runSlug}`, s.asTreasurer);
  expect([401, 403, 404, 410]).toContain(stale.status);
  expect(resetMs).toBeLessThanOrEqual(10_000);
  test.info().annotations.push({ type: "reset", description: `Reset answered in ${resetMs} ms` });

  const again = await api.post("/v1/judge/sessions", {}, s.asJudge);
  expect(again.status).toBe(201);
  const second = again.json as {
    sessionId: string;
    workspaceId: string;
    runSlug: string;
    consoleToken: string;
  };
  expect(second.sessionId).toBe(s.sessionId);
  expect(second.workspaceId).not.toBe(s.workspaceId);
  expect(second.runSlug).not.toBe(s.runSlug);
  const next = await waitForRun(
    api,
    { ...s, runSlug: second.runSlug, asTreasurer: { authorization: `Bearer ${second.consoleToken}` } },
    (r) => r.run.state === "INVOICED",
    30_000,
  );
  expect(next?.run.state).toBe("INVOICED");
  expect(Date.now() - pressed).toBeLessThanOrEqual(40_000);
  await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
});
