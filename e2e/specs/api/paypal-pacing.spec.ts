// PayPal's sandbox pacing us (S3.6.2, register §8). fs-api's limiter allows 40 PayPal calls in any 60 s. When the
// window is full, Mark paid writes its step and answers 429 QUEUED with when to try again (retryAfterMs and
// Retry-After). Nothing is sent to PayPal and nothing fails. The harness honours the answer the way the stage's "You're
// next, about N s" does: it waits that long, then presses again unless the queued step already ran.
//
// The window is filled from the stack's own database. Labelled filler rows (the limiter's insertCompleted, purpose
// e2e:pacing-filler) leave the window 10 s later, so the spec needs no second judge run. It stops at FUNDED and
// resets the session, so it posts nothing and uses none of the judge quota's live runs.
import { Api, firstPress, queuedRetry, waitForRun } from "../../lib/api.js";
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

test("Mark paid in a full PayPal window answers QUEUED with its wait; honouring it funds the run", async ({
  origin,
}) => {
  test.skip(
    !process.env.E2E_DATABASE_URL,
    "fills PayPal's window from the stack's own database (none with E2E_BASE_URL)",
  );
  const api = new Api(origin);
  await roomFor(PRESS_LIVE_CALLS);
  const s = await firstPress(api);
  try {
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
    await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
  }
});
