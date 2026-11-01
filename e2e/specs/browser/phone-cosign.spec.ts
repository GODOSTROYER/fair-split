// K1a: the real /app export signs through fs-api in E1's keyless simulator stack. The console in this
// tree has no Judge stage yet: a test-owned parent performs IC-12, without mocking the phone or API.
import type { FrameLocator, Page } from "@playwright/test";
import { Api, type JudgeSession, registerSigner, sign, waitForRun } from "../../lib/api.js";
import { expect, test } from "../../lib/fixtures.js";
import {
  expectHonoured,
  POSTED_OR_LATER,
  pressToReview,
  runState,
  workTheReview,
} from "../../lib/judge-run.js";

interface FrameToken {
  token: string;
  role: string;
  persona: string;
  workspaceId: string;
  expiresAt: string;
}

/** Use the served console origin, then attach a test-owned parent with the stage's IC-12 handshake. */
async function openChair(page: Page, api: Api, s: JudgeSession): Promise<FrameLocator> {
  const minted = await api.post(
    `/v1/judge/sessions/${s.sessionId}/frames`,
    { persona: "board:ernesto" },
    s.asJudge,
  );
  expect(minted.status).toBe(201);
  const credential = minted.json as FrameToken;
  expect(credential.role).toBe("board");
  expect(credential.persona).toBe("ernesto");
  await page.goto("/");
  await page.evaluate((c) => {
    // Replace only this test's document; the served console and /app assets stay untouched.
    document.body.replaceChildren();
    const chair = document.createElement("iframe");
    chair.name = "chair";
    chair.title = "Chair phone (test IC-12 parent)";
    chair.width = "430";
    chair.height = "900";
    const ready = (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== chair.contentWindow ||
        event.data?.v !== 1 ||
        event.data?.t !== "fs.ready" ||
        event.data?.frameId !== "chair"
      )
        return;
      chair.contentWindow?.postMessage(
        {
          v: 1,
          t: "fs.token",
          token: c.token,
          exp: Date.parse(c.expiresAt),
          // /frames returns role and persona separately; IC-12 carries the qualified reference.
          persona: `${c.role}:${c.persona}`,
          ws: c.workspaceId,
        },
        window.location.origin,
      );
      chair.contentWindow?.postMessage(
        { v: 1, t: "fs.prefs", tier: "low", sound: false, reducedMotion: true, gloss: true },
        window.location.origin,
      );
    };
    window.addEventListener("message", ready);
    chair.src = "/app/?demo=board&motion=reduced";
    document.body.append(chair);
  }, credential);
  return page.frameLocator('iframe[name="chair"]');
}

async function signInPhone(phone: FrameLocator, page: Page, slug: string, batchHash: string) {
  await phone.getByTestId("M-BD-01.sign").click();
  await expect(phone.getByTestId("M-BD-02.hash")).toHaveAttribute("data-hash", batchHash);
  // The accessible alternative still asks the human to confirm the same amount, recipients and hash.
  await phone.getByTestId("M-BD-02.slab.another-way").click();
  const accepted = page.waitForResponse(
    (r) => new URL(r.url()).pathname === `/v1/runs/${slug}/approvals` && r.request().method() === "POST",
  );
  await phone.getByTestId("M-BD-02.slab.confirm.ok").click();
  const answer = await accepted;
  expect(answer.status()).toBe(201);
  const submission = answer.request().postDataJSON();
  expect(submission.role).toBe("chair");
  expect(submission.payload.batchSha256).toBe(batchHash);
  expect(submission.keyId).toMatch(/^fs-ernesto-demo-[a-z0-9]{6}$/);
  expect(await answer.json()).toMatchObject({ runState: "APPROVED" });
}

test("inv.i4.phone: checks every line, refuses inconsistent roots, signs key 2 and survives the armed POST refusal", async ({
  page,
  origin,
}) => {
  const api = new Api(origin);
  const start = await pressToReview(api); // includes roomFor and honourQueued, as the existing specs do
  const { s, events } = start;
  const mutations: string[] = [];
  const reads = new Set<string>();
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/v1/")) {
      reads.add(path);
      if (r.method() === "POST" && (path.endsWith("/approvals") || path === "/v1/judge/keys"))
        mutations.push(path);
    }
  });
  try {
    expectHonoured(start.paid);
    expect(start.reviewed?.run.state).toBe("IN_REVIEW");
    expect(
      new Set(events.events.filter((e) => e.type.startsWith("extract.")).map((e) => e.provenance)),
    ).toEqual(new Set(["seeded"]));
    const review = await workTheReview(api, s);
    expect(review.byHand.status).toBe(200);
    expect(review.resolved).toEqual({ H1: 200, H2: 200, H3: 200 });
    const treasurer = await registerSigner(api, s, "treasurer", s.asTreasurer);
    const key1 = await sign(api, s, treasurer);
    expect(key1.status).toBe(201);
    expect(key1.json).toMatchObject({ runState: "AWAITING_BOARD" });

    const batch = await api.get(`/v1/runs/${s.runSlug}/batch`, s.asTreasurer);
    expect(batch.status).toBe(200);
    const batchView = batch.json as { batchSha256: string; itemCount: number; memberLines: unknown[] };
    const batchHash = batchView.batchSha256;
    expect(batchHash).toMatch(/^[a-f0-9]{64}$/);

    await test.step("an inconsistent cash-line root makes the phone sign and submit nothing", async () => {
      // Explicit adversarial transport fixture, not a judge-route tamper: the latter applies AFTER key 2.
      const path = `**/v1/runs/${s.runSlug}/lines`;
      let changed = 0;
      await page.route(path, async (route) => {
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        const dto = await response.json();
        const cash = dto.lines.find((line: { rail: string }) => line.rail === "CASH");
        expect(cash).toBeDefined();
        cash.lineSha256 = "0".repeat(64);
        changed++;
        await route.fulfill({ response, json: dto });
      });
      const phone = await openChair(page, api, s);
      await expect(phone.getByTestId("M-BD-01")).toHaveAttribute("data-state", "changed");
      await expect(phone.getByTestId("M-BD-01.changed")).toBeVisible();
      await expect(phone.getByTestId("M-BD-01.sign")).toHaveCount(0);
      expect(changed).toBeGreaterThan(0);
      expect(mutations).toEqual([]); // no key proof signature and no approval submission
      expect((await waitForRun(api, s, (r) => r.run.state === "AWAITING_BOARD", 5_000))?.run.state).toBe(
        "AWAITING_BOARD",
      );
      await page.unroute(path);
    });

    await test.step("the armed judge tamper is refused by fs-api after the browser signs key 2", async () => {
      const arm = await api.post(
        `/v1/judge/sessions/${s.sessionId}/tamper`,
        { kind: "change_payout" },
        s.asJudge,
      );
      expect(arm.status).toBe(200);
      expect(arm.json).toMatchObject({ armed: true, simulated: true, paypalCalls: 0, modelCalls: 0 });
      const phone = await openChair(page, api, s);
      await expect(phone.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request");
      await expect(phone.getByTestId("M-BD-01.rail")).toHaveText("Simulated PayPal sandbox");
      await expect(phone.getByTestId("M-BD-01.hash")).toHaveAttribute("data-hash", batchHash);
      await expect(phone.getByTestId("M-BD-01.lines")).toContainText(
        new RegExp(`\\b${batchView.memberLines.length}\\b`),
      );
      await expect(phone.getByTestId("M-BD-01.computed")).toContainText(
        new RegExp(`\\b${batchView.itemCount}\\b`),
      );
      await signInPhone(phone, page, s.runSlug, batchHash);
      expect(mutations.slice(0, 2)).toEqual(["/v1/judge/keys", `/v1/runs/${s.runSlug}/approvals`]);
      const refused = await events.waitFor(
        (e) => runState("IN_REVIEW")(e) && e.payload.from === "APPROVED",
        60_000,
      );
      expect(refused?.payload.cause).toEqual({ code: "SEND_BACK", ref: "DIGEST_MISMATCH" });
      expect(events.events.find(runState("POSTING"))).toBeUndefined();
      const approvals = await api.get(`/v1/runs/${s.runSlug}/approvals`, s.asTreasurer);
      expect(approvals.status).toBe(200);
      expect(
        (approvals.json as { approvals: { role: string; voidedAt: string | null }[] }).approvals
          .map((a) => [a.role, a.voidedAt !== null])
          .sort(),
      ).toEqual([
        ["chair", true],
        ["treasurer", true],
      ]);
    });

    await test.step("a fresh check and browser signature reach APPROVED then POSTING", async () => {
      expect((await sign(api, s, treasurer)).status).toBe(201);
      const phone = await openChair(page, api, s);
      await expect(phone.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request");
      await expect(phone.getByTestId("M-BD-01.hash")).toHaveAttribute("data-hash", batchHash);
      await signInPhone(phone, page, s.runSlug, batchHash);
      const posting = await events.waitFor(runState("POSTING"), 60_000);
      expect(posting?.payload.from).toBe("APPROVED");
      expect(posting?.provenance).toBe("simulated_rail");
      expect(POSTED_OR_LATER).toContain(
        (await waitForRun(api, s, (r) => POSTED_OR_LATER.includes(r.run.state), 60_000))?.run.state,
      );
      for (const path of [
        "/v1/judge/session",
        `/v1/runs/${s.runSlug}/batch`,
        `/v1/runs/${s.runSlug}/lines`,
        `/v1/runs/${s.runSlug}/approval-payload`,
        "/v1/judge/keys",
        `/v1/runs/${s.runSlug}/approvals`,
      ])
        expect(reads.has(path), path).toBe(true);
    });
  } finally {
    await page.goto("about:blank"); // close the phone's SSE and presence before releasing the judge lane
    await events.stop();
    const reset = await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
    expect(reset.status).toBe(200);
  }
});

test("the console Judge stage itself hands the Chair frame its IC-12 token", async () => {
  test.fixme(
    true,
    "WS-CONSOLE/M3: this console has no /judge stage or IC-12 token handoff; the runnable test uses an explicit test-owned parent.",
  );
  // WS-CONSOLE/M3: this tree's console has only prototype routes, no /judge stage or frame-token handoff.
  // The runnable test above proves /app against real routes with an explicit test-owned IC-12 parent.
});

test("the existing judge tamper exposes a changed line BEFORE key 2 so the phone signs nothing", async () => {
  test.fixme(
    true,
    "WS-API: change_payout applies only after both signatures inside postPayoutBatch, then undoes the change. No existing route exposes pre-sign drift.",
  );
  // WS-API: change_payout intentionally applies after BOTH signatures inside postPayoutBatch and is undone
  // on refusal. No existing judge route exposes pre-sign line drift. Above we separately prove the client
  // guard with an explicit response fixture and the real armed route's server-side I4 refusal.
});
