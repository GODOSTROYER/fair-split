// Real console first press, with credentials retained only in this test's memory.
import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
import type { Page } from "@playwright/test";
import { Api, type JudgeSession, waitForRun } from "./api.js";
import { expect } from "./fixtures.js";
import { PRESS_LIVE_CALLS, roomFor } from "./paypal-window.js";

export async function startBrowserJudge(
  page: Page,
  origin: string,
  drive: "press" | "autoplay" = "press",
  visit = true,
  review: "wait" | "stream" = "wait",
) {
  await roomFor(PRESS_LIVE_CALLS);
  if (visit) await page.goto("/judge");
  const started = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/v1/judge/sessions" && r.request().method() === "POST",
  );
  const pressedAt = Date.now();
  if (drive === "autoplay") await page.getByTestId("W-JG-01.autoplay").click();
  else await page.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ }).click();
  const response = await started;
  expect(response.status()).toBe(201);
  const dto = CreateJudgeSessionResponse.parse(await response.json());
  const cookie = (await page.context().cookies()).find((c) => c.name === "fs_js");
  if (!cookie) throw new Error("The first press did not set the judge cookie");
  const api = new Api(origin);
  const s: JudgeSession = {
    sessionId: dto.sessionId,
    workspaceId: dto.workspaceId,
    runSlug: dto.runSlug,
    runId: dto.runId,
    asTreasurer: { authorization: `Bearer ${dto.consoleToken}` },
    asJudge: { cookie: `fs_js=${cookie.value}` },
    pressedAt,
    answer: { status: response.status(), headers: new Headers(), json: dto, text: "" },
  };
  try {
    if (review === "wait") {
      const read = await waitForRun(api, s, (r) => r.run.state === "IN_REVIEW", 60_000);
      expect(read?.run.state).toBe("IN_REVIEW");
    }
  } catch (error) {
    await stopBrowserJudge(page, api, s);
    throw error;
  }
  return { api, s };
}

export async function stopBrowserJudge(page: Page, api: Api, s: JudgeSession) {
  await page.goto("about:blank");
  const reset = await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
  expect(reset.status).toBe(200);
}
