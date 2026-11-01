// E-01 v1 (b), Proof in Chromium: a run settled on the stack (scripted through fs-api; specs/api asserts each step)
// opens at /proof/<runSlug>, renders its six plates from the served bundle, and "Verify in your browser" matches
// every plate. Judge Mode signs with browser demo keys, so the page reads Sample, never Verified.
import { ChainVerification } from "@fairsplit/contracts";
import { consoleHas, missingRoute } from "../../lib/console.js";
import { expect, stackOrigin, test } from "../../lib/fixtures.js";
import { withReplayedPayout } from "../../lib/judge-quota.js";
import { settledRun } from "../../lib/judge-run.js";

test.describe.configure({ mode: "serial" });

const PLATES = ["paid", "ratified", "read", "computed", "twoKeys", "payoutItems"] as const;
let runSlug = "";

test.beforeAll(async () => {
  test.setTimeout(300_000);
  if (!consoleHas("proof")) return;
  runSlug = (await settledRun(stackOrigin())).s.runSlug;
});

test("/proof/<runSlug> for the settled run renders its six plates, labelled simulated", async ({ page }) => {
  test.fixme(!consoleHas("proof"), missingRoute("proof"));
  const res = await page.goto(`/proof/${runSlug}`);
  expect(res?.status()).toBe(200);
  expect(res?.headers()["x-robots-tag"]).toContain("noindex");
  await expect(page.getByTestId("W-PF-01")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("simulated PayPal sandbox");
  await expect(page.getByTestId("W-PF-01.rail")).toContainText("Simulated PayPal sandbox");
  for (const plate of PLATES) await expect(page.getByTestId(`W-PF-01.plate.${plate}`)).toBeVisible();
  await expect(page.getByTestId("W-PF-01.progress")).toHaveAttribute("data-state", "settled");
  const figures = page.getByRole("region", { name: "Where the money went" });
  await expect(figures).toContainText("64 of 64");
  await expect(figures).toContainText("7 of 64 members");
});

test("Verify in your browser: six of six match, read as Sample", async ({ page }) => {
  test.fixme(!consoleHas("proof"), missingRoute("proof"));
  await page.goto(`/proof/${runSlug}`);
  await page
    .getByTestId("W-PF-01.verify")
    .getByRole("button", { name: /Verify in your browser/ })
    .click();
  const verdict = page.getByTestId("W-PF-01.verdict");
  await expect(verdict).toHaveAttribute("data-state", "sample", { timeout: 30_000 });
  await expect(verdict).toContainText("Six of six match");
  await expect(verdict).toContainText("never Verified");
  for (const plate of PLATES) {
    // the public Proof withholds receivers, so the server checks the payout items plate (it says so)
    const want = plate === "payoutItems" ? "server" : "matches";
    await expect(page.getByTestId(`W-PF-01.check.${plate}`), plate).toHaveAttribute("data-state", want);
  }
});

test("Proof shows the holds caught and US$21.14 kept for members", async ({ page }) => {
  const metrics = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/v1/proof/${runSlug}/metrics`,
    { timeout: 15_000 },
  );
  await page.goto(`/proof/${runSlug}`);
  expect((await metrics).status()).toBe(200);
  const holds = page.getByTestId("W-PF-01.metric.holds");
  await expect(holds).toContainText("3");
  await expect(holds).toContainText("US$21.14");
});

test("over-quota payout: five plates match and payout statuses read Replayed (labelled)", async ({
  page,
  origin,
}) => {
  await withReplayedPayout(origin, async (_api, s) => {
    const response = await page.request.get(`/v1/proof/${s.runSlug}/verification`);
    expect(response.status()).toBe(200);
    const verification = ChainVerification.parse((await response.json()).verification);
    expect(verification.plates.payoutItems.state).toBe("replay");
    expect(verification.plates.payoutItems.reason).toBeTruthy();
    await page.goto(`/proof/${s.runSlug}`);
    await page
      .getByTestId("W-PF-01.verify")
      .getByRole("button", { name: /Verify in your browser/ })
      .click();
    await expect(page.getByTestId("W-PF-01.check.payoutItems")).toHaveAttribute("data-state", "replay");
    await expect(page.getByTestId("W-PF-01.check.payoutItems")).toHaveText(
      verification.plates.payoutItems.reason ?? "",
    );
    const verdict = page.getByTestId("W-PF-01.verdict");
    await expect(verdict).toHaveAttribute("data-state", "replay");
    await expect(verdict).toContainText(/five of six match; one replayed, labelled/i);
    await expect(verdict).not.toContainText(/mismatch|verified/i);
  });
});
