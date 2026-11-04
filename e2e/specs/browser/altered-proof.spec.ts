// E-16: the browser verifies a real, signed simulator run, with one signed line altered in transit.
// This labelled response fixture changes the record, never a verifier verdict, hash, signature or trust key.
// Public Proof must name the failing plate and withhold figures; the full brand tier must withhold exports too.
import { CreateJudgeSessionResponse, ProofBundle } from "@fairsplit/contracts";
import type { Page } from "@playwright/test";
import { expect, test } from "../../lib/fixtures.js";
import { settledRun } from "../../lib/judge-run.js";

async function verifyAlteredRecord(page: Page) {
  await page
    .getByTestId("W-PF-01.verify")
    .getByRole("button", { name: /Verify in your browser/ })
    .click();
  await expect(page.getByTestId("W-PF-01.verdict")).toHaveAttribute("data-state", "mismatch", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("W-PF-01.withheld")).toContainText("Plate 4, Lines computed");
  await expect(page.getByTestId("W-PF-01.verdict.failure")).toContainText("Plate 4, Lines computed");
  await expect(page.getByTestId("W-PF-01.check.computed")).toHaveAttribute("data-state", "differs");
  await expect(page.getByTestId("W-PF-01.checks.computed")).toHaveAttribute("data-state", "differs");
  await expect(page.getByTestId("W-PF-01.figures.withheld")).toBeVisible();
  await expect(page.getByTestId("W-PF-01.figures")).toHaveCount(0);
}

test("inv.i4.e16: a line altered after signing fails browser Verify and withholds figures and export", async ({
  page,
  origin,
}) => {
  test.setTimeout(300_000);
  const { api, s } = await settledRun(origin);
  let alteredReads = 0;
  try {
    // A real bundle from this run; both officers signed before the response fixture changes its first line.
    // Every read (including the public SSE's one refresh) receives the same labelled alteration.
    await page.route(`**/v1/proof/${s.runSlug}`, async (route) => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      const body = (await response.json()) as { bundle: unknown };
      const bundle = ProofBundle.parse(body.bundle);
      expect(bundle.approvals).toHaveLength(2);
      const line = bundle.lines.find((entry) => entry.memberNo === "M-014");
      if (!line) throw new Error("The settled judge run must contain M-014");
      line.netCents += 1;
      line.canonical.netCents += 1;
      alteredReads += 1;
      await route.fulfill({
        response,
        json: { ...body, bundle },
        headers: { ...response.headers(), "x-e2e-fixture": "E-16 altered after signing" },
      });
    });

    await page.goto(`/proof/${s.runSlug}`);
    await expect(page.getByTestId("W-PF-01.progress")).toHaveAttribute("data-state", "settled");
    await verifyAlteredRecord(page);
    await expect(page.getByTestId("W-PF-01")).toHaveAttribute("data-state", "failed");
    expect(alteredReads).toBeGreaterThan(0);

    // Resume the same signed run through its real judge cookie. A refresh intentionally forgets the console
    // token, so the product's first press restores it before an SPA navigation preserves that memory-only state.
    const cookie = s.asJudge.cookie?.replace(/^fs_js=/, "");
    if (!cookie) throw new Error("The settled run must have its judge cookie");
    await page.context().addCookies([{ name: "fs_js", value: cookie, url: origin }]);
    await page.goto("/judge");
    const resumed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/v1/judge/sessions" && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ }).click();
    const session = CreateJudgeSessionResponse.parse(await (await resumed).json());
    expect(session.runSlug).toBe(s.runSlug);
    await expect(page.getByTestId("W-JG-01.proofChip")).toBeVisible();
    const brand = await api.post(
      `/v1/judge/sessions/${s.sessionId}/frames`,
      { persona: "brand:dana" },
      s.asJudge,
    );
    expect(brand.status).toBe(201);
    const token = (brand.json as { token: string }).token;
    if (!token) throw new Error("The brand demo frame was not issued");
    // Keep this generated demo credential out of assertion messages and application storage.
    await page.evaluate((credential) => {
      history.pushState(null, "", `/b/${credential}`);
      dispatchEvent(new PopStateEvent("popstate"));
    }, token);
    await expect(page.getByTestId("W-BR-01.export.csv")).toBeEnabled();
    await expect(page.getByTestId("W-BR-01.export.json")).toBeEnabled();
    await verifyAlteredRecord(page);
    await expect(page.getByTestId("W-BR-01")).toHaveAttribute("data-state", "mismatch");
    await expect(page.getByTestId("W-BR-01.export.withheld")).toContainText("Exports wait");
    await expect(page.getByTestId("W-BR-01.export.csv")).toHaveCount(0);
    await expect(page.getByTestId("W-BR-01.export.json")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Download (CSV|JSON)/ })).toHaveCount(0);
  } finally {
    await page.goto("about:blank");
    const reset = await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
    expect(reset.status).toBe(200);
  }
});
