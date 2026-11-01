// The cold judge (G4, DR-0): a judge with no cookie presses, the treasurer and the Chair are scripted the way
// "Play it for me" and the keys move them, and the payouts POST must be answered within 60 s of the first press.
// Measured on the client's clock from the press to the run.state events on a stream opened at once; the numbers
// are attached to the test as annotations. The browser twin waits for the console's http mode (specs/browser).
import { Api, waitForRun } from "../../lib/api.js";
import { expect, test } from "../../lib/fixtures.js";
import { bothKeys, officers, pressToReview, runState, workTheReview } from "../../lib/judge-run.js";

const BUDGET_MS = 60_000;

test("first press to the payouts POST within 60 s", async ({ origin }) => {
  const api = new Api(origin);
  const { s, events, reviewed } = await pressToReview(api);
  try {
    expect(reviewed?.run.state).toBe("IN_REVIEW");
    if (!reviewed) return;
    await workTheReview(api, s);
    const [key1, key2] = await bothKeys(api, s, await officers(api, s));
    expect([key1.status, key2.status]).toEqual([201, 201]);
    const posting = await events.waitFor(runState("POSTING"), BUDGET_MS);
    const posted = await events.waitFor(runState("POSTED"), BUDGET_MS);
    const at = (name: string, e: { arrivedAt: number } | null | undefined) =>
      e ? `${name} ${((e.arrivedAt - s.pressedAt) / 1000).toFixed(1)} s` : `${name} not seen`;
    const read = events.events.find(runState("IN_REVIEW"));
    const timeline = [at("in review", read), at("POST sent", posting), at("POST answered", posted)].join(
      ", ",
    );
    test.info().annotations.push({ type: "timing", description: `first press → ${timeline}` });
    process.stdout.write(`[timing] first press → ${timeline}\n`);
    expect(posting, "the run reaches POSTING").not.toBeNull();
    expect(posted, "PayPal (simulated) answers the POST").not.toBeNull();
    expect(posted?.provenance).toBe("simulated_rail");
    expect((posted?.arrivedAt ?? Number.POSITIVE_INFINITY) - s.pressedAt).toBeLessThanOrEqual(BUDGET_MS);
    // let the run park Rhea's UNCLAIMED item before Reset cancels it, so no settle GET is cut off mid-flight
    await waitForRun(api, s, (r) => r.run.state === "NEEDS_FOLLOW_UP" || r.run.state === "SETTLED", 120_000);
  } finally {
    await events.stop();
    await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
  }
});

// The browser twin now runs in specs/browser/judge.spec.ts: autoplay drives the review, two explicit human
// actions sign the keys, and the actual POSTED event must arrive within the same 60-second budget.
