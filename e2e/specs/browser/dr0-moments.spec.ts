import { startBrowserJudge } from "../../lib/browser-judge.js";
import { chairKey, treasurerKey } from "../../lib/browser-keys.js";
import { expect, test } from "../../lib/fixtures.js";
import { collectRunEvents, runState } from "../../lib/judge-run.js";
import { observeMoments } from "../../lib/moments.js";
import { PRESS_LIVE_CALLS, roomFor } from "../../lib/paypal-window.js";

test("DR-0 / E-01 / E-15: logged-out judge, real moment phases, Proof, Reset and second press", async ({
  page,
  context,
  origin,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const moments = await observeMoments(context);
  // Reserve both presses before the clock starts. Hosted runs do no database probing or waiting.
  await roomFor(2 * PRESS_LIVE_CALLS);
  expect(await context.cookies()).toEqual([]);
  const v1: string[] = [];
  const beforePress = (r: import("@playwright/test").Request) => {
    if (new URL(r.url()).pathname.startsWith("/v1/")) v1.push(new URL(r.url()).pathname);
  };
  page.on("request", beforePress);
  await page.goto("/judge");
  await expect(page.getByRole("heading", { name: /Season 2026-A is ready to pay/ })).toBeVisible();
  await page.waitForTimeout(3_000);
  expect(v1).toEqual([]);
  page.off("request", beforePress);
  moments.clear();
  const { api, s } = await startBrowserJudge(page, origin, "autoplay", false);
  const events = collectRunEvents(api, s);
  try {
    await moments.refresh(page);
    await treasurerKey(page);
    // Observe key 1's real completion before a newer signature replaces its pending animation.
    await expect(page.getByTestId("W-TR-07.column")).toHaveAttribute("data-moment-phase", "waiting-2");
    await chairKey(page);
    const posted = await events.waitFor(runState("POSTED"), 60_000);
    expect(posted?.provenance).toBe("simulated_rail");
    const elapsed = (posted?.arrivedAt ?? Number.POSITIVE_INFINITY) - s.pressedAt;
    test
      .info()
      .annotations.push({ type: "DR-0", description: `first press to payouts POST answered ${elapsed} ms` });
    expect(elapsed).toBeLessThanOrEqual(60_000);
    process.stdout.write(`[DR-0 ${test.info().project.name}] first press to POST answered ${elapsed} ms\n`);
    await page.getByTestId("W-JG-01.autoplay").click();
    await expect(page.getByTestId("W-PF-01.verdict")).toHaveAttribute("data-state", "sample", {
      timeout: 120_000,
    });
    // The public tier checks plate 6 on the server because receivers are withheld.
    await expect(page.getByTestId("W-PF-01.verdict")).toContainText(/Six of six match/i);
    await expect(
      page.locator(
        '[data-testid^="W-PF-01.check."][data-state="matches"], [data-testid="W-PF-01.check.payoutItems"][data-state="server"]',
      ),
    ).toHaveCount(6);
    await expect(page.getByTestId("W-PF-01.figures")).toContainText("64 of 64");
    await expect(page.getByTestId("W-PF-01.metric.kept")).toContainText("US$21.14");
    await page.getByTestId("W-PF-01.trace.slip.0403").click();
    await moments.reached("MM-7", "tiled");
    for (const [id, phase] of [
      ["MM-S", "funded"],
      ["MM-1", "done"],
      ["MM-2", "done"],
      ["MM-3", "resolved"],
      ["MM-5", "inked"],
      ["MM-6", "settled"],
    ] as const)
      await moments.reached(id, phase);
    moments.ordered("MM-S", ["arc", "funded"]);
    moments.ordered("MM-1", ["pending", "press", "flood", "fill", "label", "invite", "done"], "member");
    moments.ordered("MM-2", ["by-hand", "entered", "done"]);
    moments.ordered("MM-2", ["band", "lift", "flight", "resolve", "print", "ring", "landed"]);
    moments.ordered("MM-3", [
      "glide-in",
      "converge",
      "pairs",
      "ready",
      "pressed",
      "needle",
      "wave",
      "resolved",
    ]);
    moments.ordered(
      "MM-5",
      ["ready", "confirm-1", "signed-1", "waiting-2", "signed-2", "sealed", "inked"],
      "",
    );
    moments.ordered("MM-5", ["ready", "confirm-2", "signed-2", "sealed", "inked"], "chair");
    moments.ordered("MM-6", ["sent", "landing", "parked", "rerouted", "settled"]);
    moments.ordered("MM-7", ["framed", "expanded", "zooming", "zoomed", "tiled"], "");
    const chronology = [...moments.landings].sort((a, b) => a.at - b.at);
    let after = -1;
    for (const [moment, phase, frame] of [
      ["MM-S", "funded", ""],
      ["MM-2", "landed", ""],
      ["MM-2", "done", ""],
      ["MM-3", "resolved", ""],
      ["MM-5", "inked", ""],
      ["MM-1", "done", "member"],
      ["MM-6", "settled", ""],
      ["MM-7", "tiled", ""],
    ]) {
      const next = chronology.findIndex(
        (entry, index) =>
          index > after && entry.moment === moment && entry.phase === phase && entry.frame === frame,
      );
      expect(next, `${moment} finishes in the real judge run's event order`).toBeGreaterThan(after);
      after = next;
    }
    if (test.info().project.use.reducedMotion === "reduce") expect(moments.flights).toBe(0);
    // Browser Back returns to the stage without discarding the product's memory-only session token.
    await page.goBack();
    await page.getByTestId("W-JG-01.rail.rate-card").click();
    await page.getByTestId("W-TR-02.addOpen").click();
    await page.getByTestId("W-TR-02.addCommit.face").click();
    await moments.reached("MM-4", "done");
    moments.ordered("MM-4", ["refuse", "plate", "done"]);
    const resetAt = Date.now();
    await page.getByRole("banner").getByRole("button", { name: "Reset" }).click();
    const first = page.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ });
    await expect(first).toBeEnabled({ timeout: 10_000 });
    const resetMs = Date.now() - resetAt;
    expect(resetMs).toBeLessThanOrEqual(10_000);
    process.stdout.write(`[DR-0 ${test.info().project.name}] Reset ${resetMs} ms\n`);
    const started = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/judge/sessions" && r.request().method() === "POST",
    );
    await first.click();
    const response = await started;
    expect(response.status()).toBe(201);
    expect((await response.json()).workspaceId).not.toBe(s.workspaceId);
    await expect(page.getByRole("heading", { name: /Season 2026-A is funded/ })).toBeVisible({
      timeout: 60_000,
    });
    await page.getByRole("banner").getByRole("button", { name: "Reset" }).click();
    await expect(first).toBeEnabled({ timeout: 10_000 });
  } finally {
    await test.info().attach("moment-phases.json", {
      body: JSON.stringify(moments.landings, null, 2),
      contentType: "application/json",
    });
    await events.stop();
    await page.goto("about:blank");
    await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
  }
});
