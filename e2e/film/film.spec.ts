import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startBrowserJudge, stopBrowserJudge } from "../lib/browser-judge.js";
import { expect, test } from "../lib/fixtures.js";
import { PRESS_LIVE_CALLS, roomFor } from "../lib/paypal-window.js";
import { filmClick, installFilmCapture, paceFilmBeat } from "./capture.js";
import { beatReceipts } from "./timeline.js";

test("E-01 film take: real phases, two scripted human keys and an ink cursor", async ({ page, origin }) => {
  // Window pacing precedes the take; a film wait never changes the product's simulator clocks or labels.
  await roomFor(PRESS_LIVE_CALLS);
  const startedAt = Date.now();
  const capture = await installFilmCapture(page, startedAt);
  const click = (id: string) => filmClick(page, page.getByTestId(id));
  const beat = (id: string) => paceFilmBeat(page, id, startedAt);
  const phase = (moment: string, value: string) =>
    expect
      .poll(() => capture.phases.some((event) => event.moment === moment && event.phase === value), {
        timeout: 60_000,
      })
      .toBe(true);
  const output = fileURLToPath(new URL("../film-out/", import.meta.url));
  await mkdir(output, { recursive: true });
  await page.goto("/judge");
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scale: devicePixelRatio,
  }));
  expect({ width: viewport.width, height: viewport.height }).toEqual({ width: 1920, height: 1080 });
  // Chromium on Windows can report 1 + 3e-8 even with deviceScaleFactor exactly 1.
  expect(viewport.scale).toBeCloseTo(1, 6);
  await expect(page.getByRole("banner")).toContainText("Simulated PayPal sandbox");
  await beat("funding");
  // The initial phone is explicitly seeded demo data. Its already-paid view cannot prove this run's MM-1.
  capture.phases.length = 0;
  // Enter while extraction is running so the camera witnesses real row landings, not historical rows.
  const { api, s } = await startBrowserJudge(page, origin, "press", false, "stream");
  try {
    await phase("MM-S", "funded");
    await beat("reading");
    await click("W-JG-01.rail.reading");
    await expect(page.getByTestId("W-TR-03")).toBeVisible();
    await phase("MM-2", "landed");
    await paceFilmBeat(page, "reading", startedAt + 10_000);
    await click("W-JG-01.runPill.next");
    await click("W-TR-04.useLogbook");
    await click("W-TR-04.commit.face");
    await expect(page.getByTestId("W-TR-04.committed")).toBeVisible();
    await phase("MM-2", "done");

    await beat("duplicate");
    await click("W-JG-01.rail.split");
    await click("W-TR-05.row.M-007");
    await expect(page.locator('[data-moment="MM-3"]')).toHaveAttribute("data-moment-phase", "ready");
    await click("W-TR-06.countOnce.face");
    await phase("MM-3", "resolved");

    await beat("rules");
    await click("W-TR-06.next");
    await click("W-TR-06.registerPlot.face");
    await expect(page.getByTestId("W-TR-06.result")).toBeVisible();
    await click("W-TR-06.next");
    await click("W-TR-06.returnCredit.face");
    await expect(page.getByTestId("W-TR-06.result")).toBeVisible();
    await click("W-TR-06.drawer.close");
    await paceFilmBeat(page, "rules", startedAt + 8_000);
    await click("W-JG-01.rail.rate-card");
    await click("W-TR-02.addOpen");
    await click("W-TR-02.addCommit.face");
    await phase("MM-4", "done");

    await beat("signing");
    await click("W-JG-01.rail.approve");
    await expect(page.getByTestId("W-TR-07.approve.face")).toBeEnabled();
    await expect(
      page.frameLocator('[data-testid="W-JG-01.frame.member"]').getByTestId("M-MB-01.capsule"),
    ).toBeAttached();
    await capture.refresh();
    // These are the same explicit human dialog steps as the E-01 browser spec. Product autoplay signs neither key.
    await test.step("Scripted human: Analyn confirms key 1", async () => {
      await click("W-TR-07.approve.alt");
      await click("W-TR-07.approve.dialog.confirm.face");
    });
    await click("W-TR-07.cosign.frame");
    const phone = page.frameLocator('[data-testid="W-JG-01.frame.chair"]');
    await expect(phone.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request");
    await filmClick(page, phone.getByTestId("M-BD-01.sign"));
    await filmClick(page, phone.getByTestId("M-BD-02.slab.another-way"));
    await beat("payouts");
    await capture.refresh();
    const key2StartedAt = Date.now() - startedAt;
    await test.step("Scripted human: Ernesto confirms key 2", async () => {
      await filmClick(page, phone.getByTestId("M-BD-02.slab.confirm.ok"));
    });
    const key2EndedAt = Date.now() - startedAt;
    await expect
      .poll(
        () =>
          capture.cursor.some(
            (point) => point.pressed && point.atMs >= key2StartedAt && point.atMs <= key2EndedAt,
          ),
        { message: "The injected cursor records the Chair's actual confirmation pointerdown" },
      )
      .toBe(true);
    await phase("MM-5", "inked");
    await click("W-JG-01.rail.run");
    await phase("MM-1", "press");
    await expect
      .poll(() => beatReceipts(capture.phases).find((entry) => entry.id === "arrival")?.landedAtMs ?? null)
      .not.toBeNull();
    await expect(page.getByTestId("W-TR-08.payCash.face")).toBeEnabled({ timeout: 60_000 });
    await click("W-TR-08.payCash.face");
    await phase("MM-6", "settled");

    await beat("proof");
    await expect(page.getByTestId("W-JG-01.runPill.next")).toHaveAttribute("href", `/proof/${s.runSlug}`);
    await click("W-JG-01.runPill.next");
    await expect(page).toHaveURL(`${origin}/proof/${s.runSlug}`);
    await click("W-PF-01.verify.face");
    await expect(page.getByTestId("W-PF-01.verdict")).toHaveAttribute("data-state", "sample", {
      timeout: 60_000,
    });
    await expect(page.getByTestId("W-PF-01.verdict")).toContainText(/Six of six match/i);
    // This browser retains its own judge credential, which receives the full tier (including plate 6).
    await expect(page.locator('[data-testid^="W-PF-01.checks."][data-state="matches"]')).toHaveCount(6);
    await expect(page.getByTestId("W-PF-01.checks.payoutItems")).toHaveAttribute("data-state", "matches");
    await beat("listening");
    await click("W-PF-01.plate.computed.toggle");
    await click("W-PF-01.peso.M-014");
    await click("W-PF-01.trace.slip.0403");
    await phase("MM-7", "tiled");
    expect(capture.cursor.length).toBeGreaterThan(0);
    const receipts = beatReceipts(capture.phases);
    for (const receipt of receipts.filter((entry) => entry.moment !== null)) {
      expect(receipt.landedAtMs, `${receipt.id}: ${receipt.moment} must land on a real event`).not.toBeNull();
    }
  } finally {
    // Write useful partial evidence on a failed take too; null receipts identify any phase never observed.
    await writeFile(join(output, "cursor.json"), `${JSON.stringify(capture.cursor, null, 2)}\n`);
    await writeFile(join(output, "beats.json"), `${JSON.stringify(beatReceipts(capture.phases), null, 2)}\n`);
    await stopBrowserJudge(page, api, s);
  }
});
