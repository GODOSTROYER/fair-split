// E-01 v1 (b), the Judge stage in Chromium against the stack: /judge's first view is built locally from the seed and
// calls nothing until the first press (S3.9), it is never indexed, the first press starts a session on the simulated
// rail and funds the run, and Reset brings the first view back for a second press. The live browser drives the
// review, proves workspace key isolation, and completes Verify and the peso trace after both human signatures.
import type { Page, Request, Response } from "@playwright/test";
import { waitForRun } from "../../lib/api.js";
import { startBrowserJudge, stopBrowserJudge } from "../../lib/browser-judge.js";
import { consoleHas, missingRoute } from "../../lib/console.js";
import { expect, test } from "../../lib/fixtures.js";
import { withFullHourlyQuota, withLastHourlySlot } from "../../lib/judge-quota.js";
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
      // The labelled Proof chip must fit at the default 1280 px viewport without pushing Reset behind the phone.
      await expect
        .poll(() =>
          page.getByRole("banner").evaluate((banner) => {
            const controls = Array.from(banner.querySelectorAll("a, button"));
            const right = Math.max(...controls.map((control) => control.getBoundingClientRect().right));
            const reset = banner.querySelector('[data-testid="W-JG-01.reset"]');
            if (!reset) return { fits: false, resetReceivesPointer: false };
            const rect = reset.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
            return {
              fits: right <= window.innerWidth,
              resetReceivesPointer: hit !== null && reset.contains(hit),
            };
          }),
        )
        .toEqual({ fits: true, resetReceivesPointer: true });
      await page.screenshot({ path: test.info().outputPath("reset-key1-layout.png") });
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
    // The API UUID key differs from the seed mark key; the displayed engine credit must still survive.
    const liveHolds = (await api.get(`/v1/runs/${s.runSlug}/holds`, s.asTreasurer)).json as {
      holds: { label: string; key: string; engineParams: { creditCents?: number } }[];
    };
    expect(liveHolds.holds.find((entry) => entry.label === "H3")).toMatchObject({
      key: expect.stringMatching(/^NO_RULE:[0-9a-f-]+$/),
      engineParams: { creditCents: 320 },
    });
    await page.getByTestId("W-TR-05.row.M-018").click();
    await expect(hold).toContainText("US$3.20 correction credit");
    await expect(page.getByTestId("W-TR-06.returnCredit.face")).toHaveAccessibleName(/US\$3\.20/);
    await page.getByTestId("W-TR-06.drawer.close").click();
    await workTheReview(api, s);
    const keys = await officers(api, s);
    await withFullHourlyQuota(async () => {
      const lane = await api.get("/v1/judge/lane");
      expect(lane.json).toMatchObject({ rail: { mode: "replay", reason: "hourly_cap" } });
      await expect(page.getByTestId("W-JG-01.notice.state")).toContainText(
        /This run[’']s PayPal payouts will replay, labelled/,
        { timeout: 30_000 },
      );
      await expect(page.getByTestId("W-JG-01.proofChip")).not.toContainText(/statuses replayed/i);
      await page.getByTestId("W-JG-01.tab.member").click();
      const member = page.frameLocator('[data-testid="W-JG-01.frame.member"]');
      // Keep the phone subscribed before POST: the event must override this run's original simulator DTO.
      await expect(member.getByTestId("M-MB-01.rail")).toHaveAttribute("data-rail", "simulated");
      expect((await bothKeys(api, s, keys)).map((answer) => answer.status)).toEqual([201, 201]);
      expect(
        (await waitForRun(api, s, (run) => run.run.state === "NEEDS_FOLLOW_UP", 120_000))?.run.state,
      ).toBe("NEEDS_FOLLOW_UP");
      await expect(member.getByTestId("M-MB-01.rail")).toHaveAttribute("data-rail", "replay");
      await expect(member.getByTestId("M-MB-01.rail")).toContainText(/replay/i);
      await expect(member.getByTestId("M-MB-01.railCopy")).toContainText(/replay/i);
      await expect(member.getByTestId("M-MB-01.capsule")).toContainText(/replay/i);
      await expect(member.getByTestId("M-MB-01.capsule")).toHaveAttribute("data-tone", "neutral");
      await expect(member.getByTestId("M-MB-01.machine")).toContainText(
        "Machine-translated, pending native review",
      );
      await expect(member.getByTestId("M-MB-01.railCopy")).not.toContainText(
        /This payment uses|Kini nga bayad pinaagi|Ang bayad na ito ay sa/,
      );
      // Cold read uses payout evidence without SSE history restoring the replay label after navigation.
      await page.route("**/v1/lines/*/events*", (route) => route.abort());
      const coldRead = page.waitForResponse(
        (response) =>
          /\/v1\/statements\/[^/]+$/.test(new URL(response.url()).pathname) && response.status() === 200,
      );
      const navigated = page.waitForEvent("framenavigated", (frame) => frame.name() === "member");
      await page.getByTestId("W-JG-01.frame.member").evaluate((element: HTMLIFrameElement) => {
        element.contentWindow?.location.reload();
      });
      await navigated;
      expect(await (await coldRead).json()).toMatchObject({
        provenance: "replay",
        mobile: { provenance: "replay", item: { status: "SUCCESS", provenance: "replay" } },
      });
      await expect(member.getByTestId("M-MB-01.rail")).toHaveAttribute("data-rail", "replay");
      await expect(member.getByTestId("M-MB-01.railCopy")).toContainText(/replay/i);
      await expect(member.getByTestId("M-MB-01.capsule")).toContainText(/replay/i);
      await expect(member.getByTestId("M-MB-01.capsule")).toHaveAttribute("data-tone", "neutral");
      await page.getByTestId("W-JG-01.rail.run").click();
      await expect(page.getByTestId("W-JG-01.notice.state")).toContainText(
        "Replayed (labelled): earlier simulated PayPal sandbox run",
      );
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
      const payoutRows = page
        .getByTestId("W-TR-08.table")
        .getByRole("row")
        .filter({ hasText: /M-\d{3}/ });
      await expect(payoutRows).toHaveCount(8);
      for (const row of await payoutRows.all())
        await expect(row.getByRole("cell").last()).toHaveText("Replayed (labelled)");
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
      const lines = (await api.get(`/v1/runs/${s.runSlug}/lines`, s.asTreasurer)).json as {
        lines: { id: string; state: string }[];
      };
      const rhea = lines.lines.find((line) => line.state === "UNCLAIMED");
      expect(rhea).toBeDefined();
      if (rhea) expect((await api.post(`/v1/lines/${rhea.id}/pay-cash`, {}, s.asTreasurer)).status).toBe(200);
      expect((await waitForRun(api, s, (run) => run.run.state === "SETTLED", 60_000))?.run.state).toBe(
        "SETTLED",
      );
      const rheaRow = page.getByTestId("W-TR-08.table").getByRole("row", { name: /Rhea Jumawan/ });
      await expect(rheaRow).toContainText("Cash due");
      await expect(rheaRow).not.toContainText("Replayed");
      await expect(statusCells).toHaveCount(7);
      for (const row of await payoutRows.all()) {
        const status = row.getByRole("cell").last();
        await expect(status).toHaveText(
          (await row.textContent())?.includes("Rhea Jumawan") ? "Cash due" : "Replayed (labelled)",
        );
      }
      // The film's tab layout must fit its phone figure without a horizontal scrollbar.
      await page.setViewportSize({ width: 1470, height: 956 });
      await page.getByTestId("W-JG-01.phoneTab").click();
      await page.getByTestId("W-JG-01.tab.member").click();
      await expect(page.locator("#fsc-phone-panel")).toBeVisible();
      const dimensions = await page.locator("#fsc-phone-panel").evaluate((panel) => {
        const figure = panel.querySelector("figure");
        return {
          scrollWidth: panel.scrollWidth,
          clientWidth: panel.clientWidth,
          figureWidth: figure?.getBoundingClientRect().width ?? 0,
        };
      });
      expect(dimensions.figureWidth).toBeGreaterThan(0);
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      expect(dimensions.figureWidth).toBeLessThanOrEqual(dimensions.clientWidth);
      await page.setViewportSize({ width: 1920, height: 1080 });
      await chip.click();
      await expect(page.getByTestId("W-PF-01.progress")).toContainText(
        /payout statuses replayed \(labelled\)/i,
      );
      await expect(page.getByTestId("W-PF-01.metric.timing")).toContainText("Replayed, no timing");
      await expect(page.getByTestId("W-PF-01.metric.timing")).not.toContainText("Still running");
    });
  } finally {
    await stopBrowserJudge(page, api, s);
  }
});

test("inv.i8.the last hourly slot stays live on the stage, Run and Proof after its own post fills quota", async ({
  page,
  origin,
}) => {
  test.skip(!process.env.E2E_DATABASE_URL, "quota filler is restricted to the private test stack database");
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { api, s } = await startBrowserJudge(page, origin);
  const events = collectRunEvents(api, s);
  try {
    await workTheReview(api, s);
    const keys = await officers(api, s);
    await withLastHourlySlot(api, async () => {
      await page.getByTestId("W-JG-01.tab.member").click();
      const member = page.frameLocator('[data-testid="W-JG-01.frame.member"]');
      await expect(member.getByTestId("M-MB-01.rail")).toHaveAttribute("data-rail", "simulated");
      expect((await bothKeys(api, s, keys)).map((answer) => answer.status)).toEqual([201, 201]);
      expect(
        (await waitForRun(api, s, (run) => run.run.state === "NEEDS_FOLLOW_UP", 120_000))?.run.state,
      ).toBe("NEEDS_FOLLOW_UP");
      const item = await events.waitFor((event) => event.type === "item.updated", 10_000);
      expect(item?.provenance).toBe("simulated_rail");
      await expect(member.getByTestId("M-MB-01.rail")).toHaveAttribute("data-rail", "simulated");
      await expect(member.getByTestId("M-MB-01.railCopy")).toContainText(/simulated PayPal sandbox/);
      await expect(member.getByTestId("M-MB-01.railCopy")).not.toContainText(/replay/i);
      await expect(member.getByTestId("M-MB-01.capsule")).toContainText(/Bayad na|Paid|Bayad/);
      const browserQuota = page.waitForResponse(
        async (response) => {
          if (new URL(response.url()).pathname !== "/v1/judge/session" || response.status() !== 200)
            return false;
          const peek = (await response.json()) as { rail: { reason: string | null } };
          return peek.rail.reason === "hourly_cap";
        },
        { timeout: 30_000 },
      );
      const session = await api.get("/v1/judge/session", s.asJudge);
      expect(session.json).toMatchObject({ rail: { mode: "replay", reason: "hourly_cap" } });
      await browserQuota;
      await page.route("**/v1/lines/*/events*", (route) => route.abort());
      const coldRead = page.waitForResponse(
        (response) =>
          /\/v1\/statements\/[^/]+$/.test(new URL(response.url()).pathname) && response.status() === 200,
      );
      const navigated = page.waitForEvent("framenavigated", (frame) => frame.name() === "member");
      await page.getByTestId("W-JG-01.frame.member").evaluate((element: HTMLIFrameElement) => {
        element.contentWindow?.location.reload();
      });
      await navigated;
      expect(await (await coldRead).json()).toMatchObject({
        provenance: "simulated_rail",
        mobile: { provenance: "simulated_rail", item: { status: "SUCCESS", provenance: "simulated_rail" } },
      });
      await expect(member.getByTestId("M-MB-01.rail")).toHaveAttribute("data-rail", "simulated");
      await expect(member.getByTestId("M-MB-01.railCopy")).not.toContainText(/replay/i);
      await expect(member.getByTestId("M-MB-01.capsule")).toContainText(/Bayad na|Paid|Bayad/);
      await page.getByTestId("W-JG-01.rail.run").click();
      const chip = page.getByTestId("W-JG-01.proofChip");
      await expect(chip).toContainText(/confirmed/i);
      await expect(chip).toContainText("in the simulated sandbox");
      await expect(chip).not.toContainText(/replayed/i);
      await expect(page.getByTestId("W-TR-08.status")).not.toContainText(/replayed/i);
      await expect(page.getByTestId("W-TR-08.share")).toContainText(/confirmed/i);
      await expect(page.getByTestId("W-TR-08.share")).toContainText(/simulated PayPal sandbox/i);
      await expect(page.getByTestId("W-TR-08.table")).not.toContainText(/replayed/i);
      await expect(page.getByTestId("W-JG-01.notice.state")).toHaveCount(0);
      const lines = (await api.get(`/v1/runs/${s.runSlug}/lines`, s.asTreasurer)).json as {
        lines: { id: string; state: string }[];
      };
      const rhea = lines.lines.find((line) => line.state === "UNCLAIMED");
      expect(rhea).toBeDefined();
      if (rhea) expect((await api.post(`/v1/lines/${rhea.id}/pay-cash`, {}, s.asTreasurer)).status).toBe(200);
      expect((await waitForRun(api, s, (run) => run.run.state === "SETTLED", 60_000))?.run.state).toBe(
        "SETTLED",
      );
      await expect(chip).toContainText(/confirmed/i);
      await chip.click();
      const hero = page.getByTestId("W-PF-01.progress");
      await expect(hero).toContainText("confirmed in the simulated sandbox");
      await expect(hero).not.toContainText(/replayed/i);
      await expect(page.getByTestId("W-PF-01.plate.payoutItems.fact")).toContainText(/confirmed/i);
      await expect(page.getByTestId("W-PF-01.plate.payoutItems.fact")).not.toContainText(/replayed/i);
      await expect(page.getByTestId("W-PF-01.footer")).not.toContainText(/Replayed \(labelled\)/i);
      await page
        .getByTestId("W-PF-01.verify")
        .getByRole("button", { name: /Verify in your browser/ })
        .click();
      await expect(page.getByTestId("W-PF-01.verdict")).toContainText("Six of six match", {
        timeout: 30_000,
      });
      await expect(page.getByTestId("W-PF-01.check.payoutItems")).toHaveAttribute("data-state", "matches");
      expect(
        events.events
          .filter((event) => event.type === "item.updated")
          .every((event) => event.provenance === "simulated_rail"),
      ).toBe(true);
    });
  } finally {
    await events.stop();
    await stopBrowserJudge(page, api, s);
  }
});
