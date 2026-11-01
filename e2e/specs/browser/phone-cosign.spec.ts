// K1a/C5: the real /app export signs through fs-api in E1's keyless simulator stack. The adversarial phone checks and
// the Member statement use a test-owned IC-12 parent; the console Judge stage test proves the stage's own handoff.

import { tmpdir } from "node:os";
import { join } from "node:path";
import { StatementAudio } from "@fairsplit/contracts";
import type { FrameLocator, Page } from "@playwright/test";
import { Api, type JudgeSession, registerSigner, sign, waitForRun } from "../../lib/api.js";
import { startBrowserJudge, stopBrowserJudge } from "../../lib/browser-judge.js";
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
  await page.evaluate(() => {
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
      chair.dataset.ready = "true";
    };
    window.addEventListener("message", ready);
    chair.src = "/app/?demo=board&motion=reduced";
    document.body.append(chair);
  });
  const phone = page.frameLocator('iframe[name="chair"]');
  await expect(page.locator('iframe[name="chair"]')).toHaveAttribute("data-ready", "true");
  // Exercise I1's actual transition: the preview has mounted its r37 request before fs.token arrives.
  await expect(phone.getByTestId("M-BD-01")).toBeVisible();
  await expect(phone.getByTestId("demo-label").first()).toBeVisible();
  await page.evaluate((c) => {
    const chair = document.querySelector<HTMLIFrameElement>('iframe[name="chair"]');
    chair?.contentWindow?.postMessage(
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
    chair?.contentWindow?.postMessage(
      { v: 1, t: "fs.prefs", tier: "low", sound: false, reducedMotion: true, gloss: true },
      window.location.origin,
    );
  }, credential);
  await expect(phone.getByTestId("demo-label")).toHaveCount(0);
  return phone;
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

/** Member IC-12 transition over the same unmodified /app export as the Chair. */
async function openMember(page: Page, api: Api, s: JudgeSession) {
  const minted = await api.post(
    `/v1/judge/sessions/${s.sessionId}/frames`,
    { persona: "member:M-014" },
    s.asJudge,
  );
  expect(minted.status).toBe(201);
  const credential = minted.json as FrameToken;
  expect(credential.role).toBe("member");
  expect(credential.persona).toBe("M-014");
  await page.goto("/");
  await page.evaluate(() => {
    document.body.replaceChildren();
    const member = document.createElement("iframe");
    member.name = "member";
    member.title = "Member phone (test IC-12 parent)";
    member.width = "430";
    member.height = "900";
    window.addEventListener("message", (event: MessageEvent) => {
      if (
        event.origin === window.location.origin &&
        event.source === member.contentWindow &&
        event.data?.v === 1 &&
        event.data?.t === "fs.ready" &&
        event.data?.frameId === "member"
      )
        member.dataset.ready = "true";
    });
    member.src = "/app/?demo=member&motion=reduced";
    document.body.append(member);
  });
  const phone = page.frameLocator('iframe[name="member"]');
  await expect(page.locator('iframe[name="member"]')).toHaveAttribute("data-ready", "true");
  await expect(phone.getByTestId("M-MB-01")).toBeVisible();
  await expect(phone.getByTestId("demo-label").first()).toBeVisible();
  const audioResponse = page.waitForResponse((r) => {
    const url = new URL(r.url());
    return url.pathname.startsWith("/v1/media/audio/") && url.searchParams.get("lang") === "ceb";
  });
  await page.evaluate((c) => {
    const member = document.querySelector<HTMLIFrameElement>('iframe[name="member"]');
    member?.contentWindow?.postMessage(
      {
        v: 1,
        t: "fs.token",
        token: c.token,
        exp: Date.parse(c.expiresAt),
        persona: `${c.role}:${c.persona}`,
        ws: c.workspaceId,
      },
      window.location.origin,
    );
    member?.contentWindow?.postMessage(
      { v: 1, t: "fs.prefs", tier: "low", sound: false, reducedMotion: true, gloss: true },
      window.location.origin,
    );
  }, credential);
  await expect(phone.getByTestId("demo-label")).toHaveCount(0);
  const answer = await audioResponse;
  expect(answer.status()).toBe(200);
  const audio = StatementAudio.parse(await answer.json());
  expect(audio.memberNo).toBe("M-014");
  return { phone, audio };
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

    await test.step("the live Member frame shows the judge line, simulated rail and its exact published voice", async () => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      const { phone, audio } = await openMember(page, api, s);
      await expect(phone.getByTestId("M-MB-01.rail")).toHaveText("Simulated PayPal sandbox");
      await expect(phone.getByTestId("M-MB-01.amount")).toContainText("US$64.45");
      for (const [row, figure] of [
        ["premium", "43.69"],
        ["bonus", "21.85"],
        ["ded-R1", "−1.09"],
      ] as const)
        await expect(phone.getByTestId(`M-MB-01.receipt.${row}.amount`)).toHaveText(figure);
      await page
        .locator('iframe[name="member"]')
        .screenshot({ path: join(tmpdir(), "fair-split-k1cd-member.png") });

      await phone.getByTestId("M-MB-01.paminawa").click();
      await expect(phone.getByTestId("M-MB-03")).toBeVisible();
      const published = audio.sentences.flatMap((sentence) =>
        sentence.clip ? [{ sentence, clip: sentence.clip }] : [],
      );
      if (published.length > 0) {
        for (const { sentence, clip } of published) {
          expect(clip.textSha256).toBe(sentence.textSha256);
          const row = phone.locator(
            `[data-testid^="M-MB-03.sentence."][data-audio-slot="${sentence.slot}"][data-audio-url$="${clip.url}"]`,
          );
          await expect(row).toHaveAttribute("data-audio-source", "clip");
        }
        await expect(phone.getByTestId("M-MB-03.voice")).toContainText("Gemini TTS");
      } else {
        await expect(
          phone.locator('[data-testid^="M-MB-03.sentence."][data-audio-source="device"]').first(),
        ).toBeVisible();
        await expect(phone.getByTestId("M-MB-03.voice")).toContainText(audio.deviceLabel);
      }
      expect(pageErrors).toEqual([]);
    });
  } finally {
    await page.goto("about:blank"); // close the phone's SSE and presence before releasing the judge lane
    await events.stop();
    const reset = await api.post(`/v1/judge/sessions/${s.sessionId}/reset`, {}, s.asJudge);
    expect(reset.status).toBe(200);
  }
});

test("the console Judge stage itself hands the Chair frame its IC-12 token", async ({ page, origin }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  const { api, s } = await startBrowserJudge(page, origin);
  let reset = false;
  try {
    await workTheReview(api, s);
    const treasurer = await registerSigner(api, s, "treasurer", s.asTreasurer);
    expect((await sign(api, s, treasurer)).status).toBe(201);
    const chairFrame = page.getByTestId("W-JG-01.frame.chair");
    await expect(chairFrame).toHaveAttribute("src", /^\/app\//);
    expect(await chairFrame.getAttribute("src")).not.toMatch(/token|fsb_|fsj_/i);
    const phone = page.frameLocator('[data-testid="W-JG-01.frame.chair"]');
    await expect(phone.getByTestId("demo-label")).toHaveCount(0);
    await chairFrame.evaluate((frame: HTMLIFrameElement) => {
      frame.contentWindow?.location.reload();
    });
    await expect(phone.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request");
    await expect(phone.getByTestId("demo-label")).toHaveCount(0);
    const batch = await api.get(`/v1/runs/${s.runSlug}/batch`, s.asTreasurer);
    const hash = (batch.json as { batchSha256: string }).batchSha256;
    const scrim = page.getByTestId("W-JG-01.phoneScrim");
    if (await scrim.isVisible()) await scrim.click();
    await page.getByTestId("W-JG-01.tab.chair").click();
    await signInPhone(phone, page, s.runSlug, hash);
    await page.getByRole("banner").getByRole("button", { name: "Reset" }).click();
    await expect(page.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ })).toBeEnabled();
    reset = true;
    await expect(phone.getByTestId("demo-label").first()).toBeAttached();
  } finally {
    if (reset) await page.goto("about:blank");
    else await stopBrowserJudge(page, api, s);
  }
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
