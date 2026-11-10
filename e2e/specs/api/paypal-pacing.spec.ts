// PayPal's sandbox pacing us (S3.6.2, register §8). fs-api's limiter allows 40 PayPal calls in any 60 s. When the
// window is full, Mark paid writes its step and answers 429 QUEUED with when to try again (retryAfterMs and
// Retry-After). Nothing is sent to PayPal and nothing fails. The harness honours the answer the way the stage's "You're
// next, about N s" does: it waits that long, then presses again unless the queued step already ran.
//
// The window is filled from the stack's own database. Labelled filler rows (the limiter's insertCompleted, purpose
// e2e:pacing-filler) leave the window 10 s later, so the spec needs no second judge run. It stops at FUNDED and
// resets the session, so it posts nothing and uses none of the judge quota's live runs. A born-showcase fixture
// preserves this service-level pacing check; a separate judge check proves the immediate labelled replay policy.
import { createHash, randomBytes } from "node:crypto";
import { uuidv7 } from "@fairsplit/db";
import postgres from "postgres";
import { Api, firstPress, type JudgeSession, queuedRetry, waitForRun } from "../../lib/api.js";
import { expect, test } from "../../lib/fixtures.js";
import { expectHonoured, markPaid } from "../../lib/judge-run.js";
import {
  describeWindow,
  fillWindow,
  PRESS_LIVE_CALLS,
  readWindow,
  roomFor,
} from "../../lib/paypal-window.js";

const BEFORE_FUNDED = ["DRAFT", "QUOTED", "INVOICED"];

function privateStackDb() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) throw new Error("pacing fixtures require the private stack database");
  return postgres(url, { max: 1, onnotice: () => {} });
}

/** Clone only the invoice basis. Workspace kind is immutable, so this fixture is born a showcase. */
async function showcasePacing(sql: ReturnType<typeof postgres>, source: JudgeSession) {
  const ids = { workspace: uuidv7(), coop: uuidv7(), season: uuidv7(), lot: uuidv7(), card: uuidv7() };
  const token = `fst_${randomBytes(32).toString("base64url")}`;
  const tokenId = uuidv7();
  const run = await sql.begin(async (tx) => {
    await tx`insert into workspaces (id, kind, name) values (${ids.workspace}, 'showcase', 'e2e:pacing fixture')`;
    await tx`select pg_advisory_xact_lock(hashtextextended(${`fs:ws-log:${ids.workspace}`}, 0))`;
    await tx`select fs_open_seed(${ids.workspace})`;
    await tx`insert into coops (id, workspace_id, name, region, commodity, provenance)
      select ${ids.coop}, ${ids.workspace}, name, region, commodity, provenance
        from coops where workspace_id = ${source.workspaceId}`;
    await tx`insert into seasons (id, workspace_id, coop_id, code, label, opens_on, closes_on, tz, currency,
        cosign_batch_cents, cosign_line_cents, mass_balance_tol_bp, kg_per_tree_max_g, auto_accept_bp, provenance)
      select ${ids.season}, ${ids.workspace}, ${ids.coop}, code, label, opens_on, closes_on, tz, currency,
        cosign_batch_cents, cosign_line_cents, mass_balance_tol_bp, kg_per_tree_max_g, auto_accept_bp, provenance
        from seasons where workspace_id = ${source.workspaceId}`;
    await tx`insert into lots (id, workspace_id, season_id, lot_code, sacks, shipped_g, grade1_shipped_g, shipped_on, provenance)
      select ${ids.lot}, ${ids.workspace}, ${ids.season}, lot_code, sacks, shipped_g, grade1_shipped_g, shipped_on, provenance
        from lots where workspace_id = ${source.workspaceId}`;
    await tx`insert into rate_cards (id, workspace_id, season_id, code, canonical_jcs, sha256, ratified_at, provenance)
      select ${ids.card}, ${ids.workspace}, ${ids.season}, code, canonical_jcs, sha256, ratified_at, provenance
        from rate_cards where workspace_id = ${source.workspaceId}`;
    await tx`insert into ratifications (workspace_id, rate_card_id, approver_id, role, key_id, payload_jcs, signature, signed_at, provenance)
      select ${ids.workspace}, ${ids.card}, approver_id, role, key_id, payload_jcs, signature, signed_at, provenance
        from ratifications where workspace_id = ${source.workspaceId}`;
    await tx`insert into memberships (workspace_id, role, persona)
      values (${ids.workspace}, 'treasurer', 'analyn')`;
    const [created] = await tx<{ id: string; run_slug: string }[]>`
      insert into pay_runs (workspace_id, season_id, lot_id, rate_card_id, season_code, currency,
          fx_num, fx_den, fx_source, rate_card_sha256, provenance)
      select ${ids.workspace}, ${ids.season}, ${ids.lot}, ${ids.card}, season_code, currency,
          fx_num, fx_den, fx_source, rate_card_sha256, 'seeded'
        from pay_runs where id = ${source.runId} and workspace_id = ${source.workspaceId}
      returning id, run_slug`;
    if (!created) throw new Error("showcase pacing run was not created");
    await tx`insert into frame_tokens (id, workspace_id, token_sha256, persona, role, expires_at)
      values (${tokenId}, ${ids.workspace}, ${createHash("sha256").update(token).digest("hex")},
        'analyn', 'treasurer', clock_timestamp() + interval '2 hours')`;
    return created;
  });
  return {
    tokenId,
    session: {
      ...source,
      workspaceId: ids.workspace,
      runId: run.id,
      runSlug: run.run_slug,
      asTreasurer: { authorization: `Bearer ${token}` },
    } satisfies JudgeSession,
  };
}

test("Mark paid in a full PayPal window answers QUEUED with its wait; honouring it funds the run", async ({
  origin,
}) => {
  test.skip(
    !process.env.E2E_DATABASE_URL,
    "fills PayPal's window from the stack's own database (none with E2E_BASE_URL)",
  );
  const api = new Api(origin);
  await roomFor(PRESS_LIVE_CALLS);
  const source = await firstPress(api);
  const sql = privateStackDb();
  let tokenId: string | undefined;
  try {
    await waitForRun(api, source, (r) => r.run.state === "INVOICED", 60_000);
    const fixture = await showcasePacing(sql, source);
    tokenId = fixture.tokenId;
    const s = fixture.session;
    await roomFor(PRESS_LIVE_CALLS);
    const started = await api.post(`/v1/runs/${s.runSlug}/invoice`, {}, s.asTreasurer);
    expect(started.status).toBe(200);
    if ((started.json as { outcome?: string }).outcome === "PENDING_APPROVAL") {
      expect((await api.post(`/v1/runs/${s.runSlug}/invoice/approve-send`, {}, s.asTreasurer)).status).toBe(
        200,
      );
    }
    const invoiced = await waitForRun(api, s, (r) => r.run.state === "INVOICED", 60_000);
    expect(invoiced?.run.state).toBe("INVOICED");

    const filled = await fillWindow({ freesInMs: 10_000 });
    const full = await readWindow();
    expect(full?.inWindow, full ? describeWindow(full) : "no reading").toBeGreaterThanOrEqual(filled.rows);

    const paid = await markPaid(api, s);
    const first = paid.attempts[0]?.answer;
    expect(first?.status, "Mark paid in a full window is paced, not failed").toBe(429);
    expect(first?.json).toMatchObject({ code: "QUEUED" });
    expect(first && queuedRetry(first)).toBeGreaterThan(0);
    const story = `${paid.attempts.map((a) => a.answer.status).join(" → ")}${paid.ranFromQueue ? " (the queued step ran on its own)" : ""}; first wait ${first ? queuedRetry(first) : "?"} ms`;
    test.info().annotations.push({ type: "mark-paid", description: story });
    process.stdout.write(`[pacing] Mark paid in a full window: ${story}\n`);
    expectHonoured(paid);
    // the paced press went through: the press answered 200 on the simulated rail, or the queued step ran on its own
    if (!paid.ranFromQueue) {
      expect(paid.final.status).toBe(200);
      expect(paid.final.json).toMatchObject({ provenance: "simulated_rail" });
    }
    const funded = await waitForRun(api, s, (r) => !BEFORE_FUNDED.includes(r.run.state), 30_000);
    expect(BEFORE_FUNDED).not.toContain(funded?.run.state);
    expect(funded?.invoice).toMatchObject({ provenance: "simulated_rail" });
  } finally {
    try {
      if (tokenId) await sql`update frame_tokens set revoked_at = clock_timestamp() where id = ${tokenId}`;
      await api.post(`/v1/judge/sessions/${source.sessionId}/reset`, {}, source.asJudge);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
});

test("a fresh judge Mark paid in a full PayPal window immediately replays without PayPal calls", async ({
  origin,
}) => {
  test.skip(!process.env.E2E_DATABASE_URL, "requires the private stack's PayPal window fixture");
  const api = new Api(origin);
  await roomFor(PRESS_LIVE_CALLS);
  const s = await firstPress(api);
  const sql = privateStackDb();
  try {
    expect((await waitForRun(api, s, (r) => r.run.state === "INVOICED", 60_000))?.invoice).toMatchObject({
      provenance: "simulated_rail",
    });
    await fillWindow({ freesInMs: 10_000 });
    const [before] = await sql<
      { n: number }[]
    >`select count(*)::int as n from paypal_calls where workspace_id = ${s.workspaceId}`;
    const began = performance.now();
    const paid = await api.post(`/v1/runs/${s.runSlug}/mark-paid`, {}, s.asTreasurer);
    expect(paid.status).toBe(200);
    expect(paid.json).toMatchObject({ provenance: "replay" });
    expect(performance.now() - began).toBeLessThan(5_000);
    const funded = await waitForRun(api, s, (r) => !BEFORE_FUNDED.includes(r.run.state), 30_000);
    expect(funded?.invoice).toMatchObject({ provenance: "replay" });
    const [after] = await sql<
      { n: number }[]
    >`select count(*)::int as n from paypal_calls where workspace_id = ${s.workspaceId}`;
    expect(after?.n).toBe(before?.n);
    const labels = await sql<{ reason: string }[]>`select payload->>'reason' as reason from ledger_entries
      where workspace_id = ${s.workspaceId} and run_id = ${s.runId} and kind = 'judge.step.replayed'
        and payload->>'step' = 'fund'`;
    expect(labels).toEqual([{ reason: "lane_full" }]);
  } finally {
    try {
      await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
    } finally {
      await sql.end({ timeout: 5 });
    }
  }
});
