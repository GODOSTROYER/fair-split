import { axeScreen } from "../../lib/axe.js";
import { startBrowserJudge, stopBrowserJudge } from "../../lib/browser-judge.js";
import { treasurerKey } from "../../lib/browser-keys.js";
import { expect, test } from "../../lib/fixtures.js";
import { settledRun, workTheReview } from "../../lib/judge-run.js";
import { observeMoments } from "../../lib/moments.js";

test("axe W-JG-01: logged-out first view", async ({ page }) => {
  await page.goto("/judge");
  await expect(page.getByTestId("W-JG-01.autoplay")).toBeVisible();
  await axeScreen(page, "W-JG-01");
});

test("axe W-TR-05, W-TR-06 H1 open, W-TR-07 ready and after key 1", async ({ page, origin }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const moments = await observeMoments(page.context());
  const { api, s } = await startBrowserJudge(page, origin);
  try {
    await page.getByTestId("W-JG-01.rail.split").click();
    await expect(page.getByTestId("W-TR-05.row.M-007")).toBeVisible();
    await axeScreen(page, "W-TR-05");
    await page.getByTestId("W-TR-05.row.M-007").click();
    await expect(page.getByTestId("W-TR-06.card")).toBeVisible();
    await axeScreen(page, "W-TR-06-H1");
    await page.getByTestId("W-TR-06.drawer.close").click();
    // MM-4 is a real refused mutation, not a timer or a mocked 409.
    await page.getByTestId("W-JG-01.rail.rate-card").click();
    await page.getByTestId("W-TR-02.addOpen").click();
    await page.getByTestId("W-TR-02.addCommit.face").click();
    await moments.reached("MM-4", "done");
    moments.ordered("MM-4", ["refuse", "plate", "done"]);
    await workTheReview(api, s);
    await expect(page.getByTestId("W-JG-01.runPill.next")).toHaveAttribute(
      "href",
      `/runs/${s.runSlug}/approve`,
    );
    await page.getByTestId("W-JG-01.runPill.next").click();
    await expect(page.getByTestId("W-TR-07.approve.face")).toBeEnabled();
    await axeScreen(page, "W-TR-07-ready");
    // Autoplay is used only to point to the human turn; it cannot sign this key.
    await page.getByTestId("W-JG-01.autoplay").click();
    await treasurerKey(page);
    await expect(page.getByTestId("W-TR-07.cosign.frame")).toBeVisible();
    await axeScreen(page, "W-TR-07-key1");
  } finally {
    await stopBrowserJudge(page, api, s);
  }
});

test("axe W-PF-01: settled Proof after Verify", async ({ page, origin }) => {
  const { api, s } = await settledRun(origin);
  try {
    await page.goto(`/proof/${s.runSlug}`);
    await page
      .getByTestId("W-PF-01.verify")
      .getByRole("button", { name: /Verify in your browser/ })
      .click();
    await expect(page.getByTestId("W-PF-01.verdict")).toHaveAttribute("data-state", "sample");
    await axeScreen(page, "W-PF-01");
  } finally {
    await page.goto("about:blank");
    await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
  }
});
