// E-01 v1 (b), the Judge stage in Chromium against the stack: /judge's first view is built locally from the seed and
// calls nothing until the first press (S3.9), it is never indexed, the first press starts a session on the simulated
// rail and funds the run, and Reset brings the first view back for a second press. The live browser drives the
// review, proves workspace key isolation, and completes Verify and the peso trace after both human signatures.
import type { Page, Request, Response } from "@playwright/test";
import { waitForRun } from "../../lib/api.js";
import { startBrowserJudge, stopBrowserJudge } from "../../lib/browser-judge.js";
import { consoleHas, missingRoute } from "../../lib/console.js";
import { expect, test } from "../../lib/fixtures.js";
import { withFullHourlyQuota } from "../../lib/judge-quota.js";
import { bothKeys, collectRunEvents, officers, runState, workTheReview } from "../../lib/judge-run.js";
import { PRESS_LIVE_CALLS, roomFor } from "../../lib/paypal-window.js";

const isV1 = (r: Request) => new URL(r.url()).pathname.startsWith("/v1/");
const firstPress = (page: Page) => page.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ });
const sessionStarted = (r: Response) =>
  new URL(r.url()).pathname === "/v1/judge/sessions" && r.request().method() === "POST";

interface SessionView {
  runSlug: string;
  runState: string;
  workspaceId: string;
  rail: { mode: string; rail: string; label: string };
}

/**
 * The first view has loaded and had time to make any call it would make. Not "networkidle": with a ws/console build
 * it never came once in two runs (the /app frames send HEAD / pings, some aborted), and the spec timed out at 4 min.
 */
async function settled(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForTimeout(3_000);
}

/** The judge session the page's own cookie holds, read through the page's request context. */
async function sessionOf(page: Page): Promise<SessionView> {
  const r = await page.request.get("/v1/judge/session");
  expect(r.status()).toBe(200);
  return (await r.json()) as SessionView;
}

test("fs-api serves /judge as the console's page with X-Robots-Tag noindex", async ({ request }) => {
  const res = await request.get("/judge", { headers: { accept: "text/html" } });
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("text/html");
  expect(res.headers()["x-robots-tag"]).toContain("noindex");
  expect(res.headers()["cache-control"]).toBe("no-cache");
});

test("/judge loads in Chromium, noindex, without one /v1 call", async ({ page }) => {
  // whatever console is served: until the first press nothing on /judge may reach the API
  const v1: string[] = [];
  page.on("request", (r) => {
    if (isV1(r)) v1.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  const res = await page.goto("/judge");
  expect(res?.status()).toBe(200);
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator("#root > *").first()).toBeAttached();
  await settled(page);
  expect(v1).toEqual([]);
});

test("/judge's first view carries noindex and calls no /v1 before the first press", async ({ page }) => {
  test.fixme(!consoleHas("judge"), missingRoute("judge"));
  const v1: string[] = [];
  page.on("request", (r) => {
    if (isV1(r)) v1.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  const res = await page.goto("/judge");
  expect(res?.status()).toBe(200);
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(firstPress(page)).toBeVisible();
  await expect(page.getByRole("banner")).toContainText("Simulated PayPal sandbox");
  // the first view settles (fonts, the seed's figures, the /app frames, lazy route chunks) without one API call
  await settled(page);
  expect(v1).toEqual([]);
});

test("the first press starts a judge session on the simulated rail and funds the run", async ({ page }) => {
  test.fixme(!consoleHas("judge"), missingRoute("judge"));
  await roomFor(PRESS_LIVE_CALLS);
  await page.goto("/judge");
  const started = page.waitForResponse(sessionStarted);
  await firstPress(page).click();
  expect((await started).status()).toBe(201);
  await expect(page.getByRole("heading", { name: /Season 2026-A is funded/ })).toBeVisible({
    timeout: 60_000,
  });
  const session = await sessionOf(page);
  expect(session.rail).toMatchObject({ mode: "live", rail: "simulated" });
  expect(session.rail.label).toContain("Simulated PayPal sandbox");
  expect(["INVOICED", "DRAFT", "QUOTED"]).not.toContain(session.runState);
});

test("Reset brings the first view back within 10 s and a second press works", async ({ page }) => {
  test.fixme(!consoleHas("judge"), missingRoute("judge"));
  // room in PayPal's window for both presses to FUNDED, so nothing waits between Reset and the second press
  await roomFor(2 * PRESS_LIVE_CALLS);
  await page.goto("/judge");
  await firstPress(page).click();
  await expect(page.getByRole("heading", { name: /Season 2026-A is funded/ })).toBeVisible({
    timeout: 60_000,
  });
  const first = await sessionOf(page);

  const pressedAt = Date.now();
  await page.getByRole("banner").getByRole("button", { name: "Reset" }).click();
  await expect(firstPress(page)).toBeEnabled({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /Season 2026-A is ready to pay/ })).toBeVisible();
  const resetMs = Date.now() - pressedAt;
  test.info().annotations.push({ type: "reset", description: `first view back ${resetMs} ms after Reset` });
  expect(resetMs).toBeLessThanOrEqual(10_000);

  const again = page.waitForResponse(sessionStarted);
  await firstPress(page).click();
  expect((await again).status()).toBe(201);
  await expect(page.getByRole("heading", { name: /Season 2026-A is funded/ })).toBeVisible({
    timeout: 60_000,
  });
  const second = await sessionOf(page);
  expect(second.workspaceId).not.toBe(first.workspaceId);
  expect(second.runSlug).not.toBe(first.runSlug);
});

test("slip 0462 is entered by hand in the browser once the reading is done", async ({ page, origin }) => {
  const { api, s } = await startBrowserJudge(page, origin);
  try {
    await page.getByTestId("W-JG-01.runPill.next").click();
    await expect(page.getByTestId("W-TR-04.input")).toBeEnabled();
    await page.getByTestId("W-TR-04.useLogbook").click();
    const entered = page.waitForResponse(
      (r) =>
        /^\/v1\/fields\/[^/]+\/enter$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
    );
    await page.getByTestId("W-TR-04.commit.face").click();
    expect((await entered).status()).toBe(200);
    await expect(page.getByTestId("W-TR-04.committed")).toContainText("64.80");
  } finally {
    await stopBrowserJudge(page, api, s);
  }
});

test("the console signs with a fresh registered key after Reset changes the workspace", async ({
  page,
  origin,
}) => {
  const ids: string[] = [];
  for (let run = 0; run < 2; run++) {
    const { api, s } = await startBrowserJudge(page, origin, "press", run === 0);
    let reset = false;
    try {
      await workTheReview(api, s);
      await expect(page.getByTestId("W-JG-01.runPill.next")).toHaveAttribute(
        "href",
        `/runs/${s.runSlug}/approve`,
      );
      await page.getByTestId("W-JG-01.runPill.next").click();
      await expect(page.getByTestId("W-TR-07.approve.face")).toBeEnabled();
      await page.getByTestId("W-TR-07.approve.alt").click();
      const answer = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/v1/runs/${s.runSlug}/approvals` && r.request().method() === "POST",
      );
      await page.getByTestId("W-TR-07.approve.dialog.confirm.face").click();
      const signed = await answer;
      expect(signed.status()).toBe(201);
      ids.push((signed.request().postDataJSON() as { keyId: string }).keyId);
      await page.getByRole("banner").getByRole("button", { name: "Reset" }).click();
      await expect(firstPress(page)).toBeEnabled();
      reset = true;
    } finally {
      if (!reset) await stopBrowserJudge(page, api, s);
    }
  }
  expect(ids).toHaveLength(2);
  expect(ids[0]).not.toBe(ids[1]);
  await page.goto("about:blank");
});

test("Play it for me drives the review, waits for both human keys, then verifies and taps a peso", async ({
  page,
  origin,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { api, s } = await startBrowserJudge(page, origin, "autoplay");
  const events = collectRunEvents(api, s);
  try {
    const approve = page.getByTestId("W-TR-07.approve.face");
    await expect(approve).toBeEnabled({ timeout: 90_000 });
    await expect(page.getByTestId("W-JG-01.autoplay")).toHaveAttribute("data-state", "paused");
    await page.getByTestId("W-TR-07.approve.alt").click();
    const key1 = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/v1/runs/${s.runSlug}/approvals` && r.request().method() === "POST",
    );
    await page.getByTestId("W-TR-07.approve.dialog.confirm.face").click();
    expect((await key1).status()).toBe(201);
    await page.getByTestId("W-TR-07.cosign.frame").click();
    const phone = page.frameLocator('[data-testid="W-JG-01.frame.chair"]');
    await expect(phone.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request");
    await phone.getByTestId("M-BD-01.sign").click();
    await phone.getByTestId("M-BD-02.slab.another-way").click();
    const key2 = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/v1/runs/${s.runSlug}/approvals` && r.request().method() === "POST",
    );
    await phone.getByTestId("M-BD-02.slab.confirm.ok").click();
    expect((await key2).status()).toBe(201);
    const posted = await events.waitFor(runState("POSTED"), 60_000);
    const elapsedMs = (posted?.arrivedAt ?? Number.POSITIVE_INFINITY) - s.pressedAt;
    const timing = { type: "browser timing", description: `first press to POST answered: ${elapsedMs} ms` };
    test.info().annotations.push(timing);
    process.stdout.write(`[browser-timing] ${timing.description}\n`);
    expect(posted?.provenance).toBe("simulated_rail");
    expect(elapsedMs).toBeLessThanOrEqual(60_000);
    await page.getByTestId("W-JG-01.autoplay").click();
    await expect(page.getByTestId("W-PF-01.verdict")).toHaveAttribute("data-state", "sample", {
      timeout: 120_000,
    });
    await expect(page.getByTestId("W-PF-01.trace.state")).toHaveAttribute("data-trace", "line");
    await expect(page.getByTestId("W-PF-01.peso.M-014")).toHaveAttribute("aria-expanded", "true");
  } finally {
    await events.stop();
    await stopBrowserJudge(page, api, s);
  }
});

test("Try to break it: all four controls refuse attacks and the changed payout voids both approvals", async ({
  page,
  origin,
}) => {
  const { api, s } = await startBrowserJudge(page, origin);
  try {
    await workTheReview(api, s);
    await page.getByTestId("W-JG-01.whatsRealOpen").click();
    for (const kind of ["amount", "offsetting", "recipient"]) {
      const answer = page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === `/v1/judge/sessions/${s.sessionId}/tamper` &&
          r.request().method() === "POST",
      );
      await page.getByTestId(`W-JG-01.tamper.${kind}`).click();
      expect((await answer).status()).toBe(200);
      await expect(page.getByTestId("W-JG-01.tamper.result")).toContainText("DENY");
    }
    await page.getByTestId("W-JG-01.tamper.change_payout").click();
    const result = page.getByTestId("W-JG-01.tamper.result");
    await expect(result).toContainText("Armed before key 2");
    await expect(result).not.toContainText("Both approvals voided");
    const keys = await officers(api, s);
    expect((await bothKeys(api, s, keys)).map((a) => a.status)).toEqual([201, 201]);
    const refused = await waitForRun(api, s, (run) => run.run.state === "IN_REVIEW", 30_000);
    expect(refused?.run.state).toBe("IN_REVIEW");
    const approvals = await api.get(`/v1/runs/${s.runSlug}/approvals`, s.asTreasurer);
    expect(approvals.status).toBe(200);
    expect(
      (approvals.json as { approvals: { voidedAt: string | null }[] }).approvals.map(
        (a) => a.voidedAt !== null,
      ),
    ).toEqual([true, true]);
    await expect(result).toContainText("Both approvals voided");
  } finally {
    await stopBrowserJudge(page, api, s);
  }
});

test("a quota-replayed run labels the stage, payout summary, chips and log before opening Proof", async ({
  page,
  origin,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { api, s } = await startBrowserJudge(page, origin);
  try {
    // Inspect a real seeded hold before the API helper resolves it. Merlyn's open plot hold is pinned.
    await page.getByTestId("W-JG-01.rail.split").click();
    await page.getByTestId("W-TR-05.row.M-053").click();
    const hold = page.getByTestId("W-TR-06.card");
    await expect(hold).toContainText("Seed stand-in, not a Claude recording");
    await expect(hold.locator("dt").filter({ hasText: /^Claude$/ })).toHaveCount(0);
    await expect(hold.locator('[data-provenance="seeded"]')).toContainText(
      "Her deliveries suggest a second plot",
    );
    await page.getByTestId("W-TR-06.drawer.close").click();
    await workTheReview(api, s);
    const keys = await officers(api, s);
    await withFullHourlyQuota(async () => {
      const lane = await api.get("/v1/judge/lane");
      expect(lane.json).toMatchObject({ rail: { mode: "replay", reason: "hourly_cap" } });
      const label = (lane.json as { rail: { label: string } }).rail.label;
      expect((await bothKeys(api, s, keys)).map((answer) => answer.status)).toEqual([201, 201]);
      expect(
        (await waitForRun(api, s, (run) => run.run.state === "NEEDS_FOLLOW_UP", 120_000))?.run.state,
      ).toBe("NEEDS_FOLLOW_UP");
      await page.getByTestId("W-JG-01.rail.run").click();
      await expect(page.getByTestId("W-JG-01.notice.state")).toContainText(label);
      const chip = page.getByTestId("W-JG-01.proofChip");
      await expect(chip).toContainText(/replayed/i);
      await expect(chip).not.toContainText(/confirmed|verified/i);
      await expect(page.getByTestId("W-TR-08.status")).toContainText(/replayed \(labelled\)/i);
      const summary = page.getByTestId("W-TR-08.share");
      await expect(summary).toContainText(/payout statuses replayed \(labelled\)/i);
      await expect(summary).toContainText(/earlier simulated PayPal sandbox run/i);
      await expect(summary).not.toContainText(/confirmed|verified|sent by PayPal/i);
      const statusCells = page.getByTestId("W-TR-08.table").getByRole("cell", { name: /Replayed/i });
      await expect(statusCells).toHaveCount(8);
      for (const status of await statusCells.all()) await expect(status).toContainText(/Replayed/i);
      const parkedChip = page.getByTestId(/^W-TR-08\.chip\./);
      await expect(parkedChip).toHaveCount(1);
      await expect(parkedChip).toHaveText("Replayed");
      const payoutLog = page.getByTestId("W-TR-08.lane.PAYPAL");
      await expect(payoutLog).toContainText(/replay of an earlier simulated/i);
      await expect(payoutLog).not.toContainText(/Confirmed by a status check|replay of the seed stand-in/i);
      const replayRows = payoutLog.locator('[data-provenance="replay"]');
      // Every replay event is labelled in its own row, including an unsuccessful recorded item.
      await expect(replayRows.first()).toBeAttached();
      for (const row of await replayRows.all()) {
        await expect(row).toContainText(/replay/i);
        await expect(row).not.toContainText(/confirmed|verified/i);
      }
    });
  } finally {
    await stopBrowserJudge(page, api, s);
  }
});
