// E-01 v1 (b), the Judge stage in Chromium against the stack: /judge's first view is built locally from the seed and
// calls nothing until the first press (S3.9), it is never indexed, the first press starts a session on the simulated
// rail and funds the run, and Reset brings the first view back for a second press. What needs the console's http
// mode, which C5b is finishing, is test.fixme with the missing behaviour named.
import type { Page, Request, Response } from "@playwright/test";
import { consoleHas, missingRoute } from "../../lib/console.js";
import { expect, test } from "../../lib/fixtures.js";

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
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2_000);
  expect(v1).toEqual([]);
});

test("the first press starts a judge session on the simulated rail and funds the run", async ({ page }) => {
  test.fixme(!consoleHas("judge"), missingRoute("judge"));
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

test.fixme("slip 0462 is entered by hand in the browser once the reading is done", async () => {
  // C5b: in http mode /season/2026-A/by-hand/0462 keeps "Slip 0462 hasn't been read in this run yet" with the
  // field and its buttons disabled after the run reached IN_REVIEW; the page never GETs
  // /v1/seasons/2026A/slips/0462 nor POSTs /v1/fields/:id/enter.
});

test.fixme("Play it for me drives the review, H1–H3 and both keys to the POST", async () => {
  // C5b: in http mode autoplay presses, reaches /season/2026-A/by-hand/0462 about 20 s later and stops there (the
  // field is disabled, above); it never resolves H1–H3, never signs, and nothing reaches POST. Key 2 also needs C5c's
  // Chair panel (flag) or the live /app Chair frame (K1a). The browser half of the 60 s cold-judge budget waits on it.
});

test.fixme("Try to break it: change_payout armed before key 2 shows the I4 refusal and the voided approvals", async () => {
  // C5b: the stage has no Try-to-break-it controls wired to POST /v1/judge/sessions/:sid/tamper in http mode
  // (overcharge, offsetting, recipient, change_payout); specs/api/e01-judge-run.spec.ts asserts the refusal itself.
});
