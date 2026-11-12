// The film's capture take (F3): one real judge run in Chromium, recorded segment by segment for the film's capture
// slots (video/captures.json). Each segment is a continuous screencast around one real UI action at 1920 × 1080
// (Chromium caps screencast frames at the viewport's CSS size); `video/tools/cut-captures.mjs` cuts every slot's clip out of
// these segments (its crop and its film time come from the recorded element boxes and action marks, not from here).
// Run it with `FILM_TAKE=slots corepack pnpm e2e:film`, or the whole re-capture with `node video/tools/recapture.mjs`.
//
// Honesty: the take drives the product the way a judge does and changes no time, state, response or label. Both
// officers sign by holding their own slabs (scripted human steps); the ink arrow is the film take's injected cursor
// (capture.ts); nothing is accelerated. Every PayPal value is the private stack's in-process simulator.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { Api, type JudgeSession, waitForRun } from "../lib/api.js";
import { stopBrowserJudge } from "../lib/browser-judge.js";
import { expect, test } from "../lib/fixtures.js";
import { PRESS_LIVE_CALLS, roomFor } from "../lib/paypal-window.js";
import { installFilmCapture } from "./capture.js";

/** Device scale: 1. Screencast frames never exceed the CSS viewport, so a higher scale only costs CPU. */
const SCALE = Number(process.env.FILM_SCALE ?? 1);
const VIEW = { width: 1920, height: 1080 };
const OUT = process.env.FILM_SLOTS_OUT ?? fileURLToPath(new URL("../film-out/slots/", import.meta.url));

test.use({
  // tracing would start its own small screencast first and fix the frame size for every client
  trace: "off",
  screenshot: "off",
  deviceScaleFactor: SCALE,
  viewport: VIEW,
  headless: process.env.FILM_HEADED !== "1",
});

type Rect = [number, number, number, number];
interface Frame {
  file: string;
  /** Screencast frame timestamp as Playwright reports it. */
  ts: number;
  /** Node's clock (ms since the epoch) when the frame arrived. */
  at: number;
}
interface Segment {
  name: string;
  startedAt: number;
  endedAt: number;
  frames: Frame[];
  marks: { name: string; at: number }[];
  boxes: { label: string; at: number; scroll: number; items: Record<string, Rect> }[];
}

/** Every visible [data-testid] box in the page and its same-origin phone frames, in top-page CSS pixels. */
function visibleBoxes(): Record<string, [number, number, number, number]> {
  const out: Record<string, [number, number, number, number]> = {};
  const walk = (doc: Document, dx: number, dy: number, prefix: string) => {
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-testid]"))) {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const id = `${prefix}${el.dataset.testid}`;
      if (id in out) continue;
      out[id] = [r.x + dx, r.y + dy, r.width, r.height].map((v) => Math.round(v * 10) / 10) as [
        number,
        number,
        number,
        number,
      ];
    }
    for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe"))) {
      const r = frame.getBoundingClientRect();
      const test = frame.dataset.testid;
      if (!test || r.width < 1) continue;
      try {
        if (frame.contentDocument) walk(frame.contentDocument, dx + r.x, dy + r.y, `${test}>`);
      } catch {
        // a cross-origin frame has nothing to measure
      }
    }
  };
  walk(document, 0, 0, "");
  return out;
}

class Recorder {
  readonly segments: Segment[] = [];
  private current: Segment | null = null;
  constructor(private readonly page: Page) {}

  async start(name: string) {
    if (this.current) throw new Error(`segment ${this.current.name} is still recording`);
    mkdirSync(join(OUT, "frames", name), { recursive: true });
    const segment: Segment = { name, startedAt: Date.now(), endedAt: 0, frames: [], marks: [], boxes: [] };
    this.current = segment;
    await this.page.screencast.start({
      size: { width: VIEW.width * SCALE, height: VIEW.height * SCALE },
      quality: 92,
      fps: 30,
      onFrame: async ({ data, timestamp }) => {
        const file = `${name}/${String(segment.frames.length).padStart(5, "0")}.jpg`;
        segment.frames.push({ file, ts: timestamp, at: Date.now() });
        await writeFile(join(OUT, "frames", file), data);
      },
    });
    await this.box("start");
  }

  mark(name: string, at = Date.now()) {
    if (!this.current) throw new Error(`mark ${name} outside a segment`);
    this.current.marks.push({ name, at });
    process.stdout.write(`[film-slots] ${this.current.name}: ${name}\n`);
  }

  /** The boxes of every visible test id now (crops and accents are placed from these, not from fixed pixels). */
  async box(label: string) {
    if (!this.current) throw new Error(`box ${label} outside a segment`);
    const at = Date.now();
    const items = await this.page.evaluate(visibleBoxes);
    const scroll = await this.page.evaluate(() => window.scrollY);
    this.current.boxes.push({ label, at, scroll, items });
  }

  async stop() {
    if (!this.current) return;
    await this.box("end").catch(() => undefined);
    await this.page.screencast.stop();
    this.current.endedAt = Date.now();
    this.segments.push(this.current);
    this.current = null;
  }

  /** One segment: `body` runs between the screencast's start and stop, after `pre` ms of pre-roll. */
  async take(name: string, pre: number, body: () => Promise<void>, post: number, keep = true) {
    if (keep) await this.page.evaluate(() => Object.assign(window, { __fsFilmKeep: true }));
    await this.start(name);
    try {
      await this.page.waitForTimeout(pre);
      await body();
      await this.page.waitForTimeout(post);
    } finally {
      await this.stop();
      if (keep)
        await this.page.evaluate(() => Object.assign(window, { __fsFilmKeep: false })).catch(() => undefined);
    }
  }
}

/** A slab held with the mouse for `ms` and released inside it (the officer's own route), with the ink arrow. */
async function hold(page: Page, face: Locator, ms: number, rec: Recorder, name: string) {
  await face.scrollIntoViewIfNeeded();
  const box = await face.boundingBox();
  if (!box) throw new Error(`${name}: the slab has no box`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 22 });
  rec.mark(`${name}.down`);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
  rec.mark(`${name}.up`);
}

/**
 * Film mode shows no desktop pointer (review v6 F14): the take's ink arrow is hidden in the console, and a press on a
 * phone frame draws a touch dot where the finger is, held while it holds and lifting as it lets go. Test injection
 * only; nothing ships in the console or the app.
 */
export function installFilmTouch() {
  const style = document.createElement("style");
  style.textContent =
    "[data-fs-film-cursor]{display:none!important}[data-fs-film-touch]{position:fixed;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;background:rgb(11 18 32/.16);box-shadow:0 0 0 2px rgb(11 18 32/.22);pointer-events:none;z-index:2147483647;transition:opacity .28s ease-out,transform .28s ease-out}";
  const mount = () => document.documentElement?.append(style);
  if (document.documentElement) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
  if (window === window.top) {
    // The screencast only sends a frame when the top page is damaged; a phone frame's own change (MM-7 opening,
    // Paminawa playing, Proof's checks) could leave it stalled. A 1 px keeper in the corner, outside every
    // crop, damages the top page every other animation frame so the take records each change at up to 30 fps (not
    // while PayPal's events are in flight (the funding, the keys and the fan-out, the move to cash): a keeper then loads
    // the shared stack enough that an item can settle by a status check instead of its verified event, and Proof then
    // honestly reads a mismatch).
    const keeper = document.createElement("div");
    keeper.dataset.fsFilmKeeper = "";
    keeper.style.cssText =
      "position:fixed;right:0;bottom:0;width:1px;height:1px;background:rgb(11 18 32/.02);pointer-events:none;z-index:2147483647";
    let n = 0;
    const tick = () => {
      n++;
      const host = window as typeof window & { __fsFilmKeep?: boolean };
      if (host.__fsFilmKeep && n % 2 === 0) keeper.style.transform = `translateX(${(n / 2) % 2}px)`;
      requestAnimationFrame(tick);
    };
    const start = () => {
      document.documentElement.append(keeper);
      requestAnimationFrame(tick);
    };
    if (document.documentElement) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
    return;
  }
  let dot: HTMLElement | null = null;
  document.addEventListener(
    "pointerdown",
    (event) => {
      dot?.remove();
      dot = document.createElement("div");
      dot.dataset.fsFilmTouch = "";
      dot.style.left = `${event.clientX}px`;
      dot.style.top = `${event.clientY}px`;
      dot.style.transform = "scale(.6)";
      document.documentElement.append(dot);
      requestAnimationFrame(() => {
        if (dot) dot.style.transform = "scale(1)";
      });
    },
    { capture: true },
  );
  document.addEventListener(
    "pointerup",
    () => {
      const gone = dot;
      dot = null;
      if (!gone) return;
      gone.style.opacity = "0";
      gone.style.transform = "scale(1.35)";
      setTimeout(() => gone.remove(), 320);
    },
    { capture: true },
  );
}

/** Moves the ink arrow out of the crop after a press, the way a hand leaves the control. */
async function park(page: Page, x = 1919, y = 1079) {
  await page.mouse.move(x, y, { steps: 10 });
}

/** The ink arrow travels from where it rests to the control (no jump), then presses it with a real pointer press. */
async function glidePress(page: Page, target: Locator, onPress?: () => void) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Film target has no pointer box");
  const x = box.x + Math.min(box.width / 2, 48);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 22 });
  onPress?.();
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

test("film slots take: every capture slot, recorded from one real judge run", async ({ page, origin }) => {
  test.setTimeout(20 * 60_000);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const rec = new Recorder(page);
  const startedAt = Date.now();
  const capture = await installFilmCapture(page, startedAt);
  await page.addInitScript(installFilmTouch);
  const click = (target: Locator) => glidePress(page, target);
  const tap = (target: Locator, mark?: string) =>
    glidePress(page, target, mark ? () => rec.mark(mark) : undefined);
  const phase = (moment: string, value: string, timeout = 60_000) =>
    expect
      .poll(() => capture.phases.some((event) => event.moment === moment && event.phase === value), {
        timeout,
      })
      .toBe(true);
  const landed = (moment: string, value: string) =>
    capture.phases.find((event) => event.moment === moment && event.phase === value);
  const pill = page.getByTestId("W-JG-01.runPill.next");
  const followPill = async (want: RegExp, ms = 30_000) => {
    await expect(pill).toHaveAttribute("href", want, { timeout: ms });
    await click(pill);
  };
  const notes: string[] = [];
  let api: Api | null = null;
  let s: JudgeSession | null = null;

  try {
    // ------------------------------------------------------------------- funding (MM-S): the first press
    await roomFor(PRESS_LIVE_CALLS);
    await page.goto("/judge");
    const press = page.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ });
    await expect(press).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await park(page, 1500, 900);
    await page.waitForTimeout(2500);
    capture.phases.length = 0;
    await rec.take(
      "funding",
      2000,
      async () => {
        const started = page.waitForResponse(
          (r) => new URL(r.url()).pathname === "/v1/judge/sessions" && r.request().method() === "POST",
        );
        let pressedAt = 0;
        await glidePress(page, press, () => {
          rec.mark("press");
          pressedAt = Date.now();
        });
        const response = await started;
        expect(response.status()).toBe(201);
        const dto = CreateJudgeSessionResponse.parse(await response.json());
        const cookie = (await page.context().cookies()).find((c) => c.name === "fs_js");
        if (!cookie) throw new Error("The first press did not set the judge cookie");
        api = new Api(origin);
        s = {
          sessionId: dto.sessionId,
          workspaceId: dto.workspaceId,
          runSlug: dto.runSlug,
          runId: dto.runId,
          asTreasurer: { authorization: `Bearer ${dto.consoleToken}` },
          asJudge: { cookie: `fs_js=${cookie.value}` },
          pressedAt,
          answer: { status: response.status(), headers: new Headers(), json: dto, text: "" },
        };
        await park(page);
        // the sound offer is answered off camera (no pointer travel), as the slot asks
        const offer = page.getByTestId("W-JG-01.soundOffer.no");
        await offer
          .waitFor({ state: "visible", timeout: 4000 })
          .then(() => offer.dispatchEvent("click"))
          .catch(() => notes.push("funding: no sound offer within 4 s"));
        await phase("MM-S", "funded");
        rec.mark("funded", startedAt + (landed("MM-S", "funded")?.atMs ?? Date.now() - startedAt));
        await page.waitForTimeout(1500);
        await rec.box("funded");
      },
      8000,
      false,
    );
    if (!api || !s) throw new Error("no judge session");
    const run = s as JudgeSession;
    const http = api as Api;

    // ------------------------------------------------------------------- the reading room: photos, then the exhibit
    await followPill(/\/reading/);
    await park(page);
    await waitForRun(http, run, (r) => r.run.state === "IN_REVIEW", 120_000);
    // the room moves on to the slip that needs a person once the reading is done: come back to it by the rail
    await click(page.getByTestId("W-JG-01.rail.reading"));
    await expect(page.getByTestId("W-TR-03")).toBeVisible({ timeout: 20_000 });
    await park(page);
    await page.waitForTimeout(2500);
    await rec.take("reading", 500, async () => rec.box("done"), 6500);
    // the recorded exhibit: slip 0403's tile (never 0449's), with both captions and its stand-in row
    const tile = page.locator('[data-testid^="W-TR-03.hero."]').filter({ hasText: "0403" }).first();
    await tile
      .evaluate((node) => node.scrollIntoView({ block: "center" }))
      .catch(() => notes.push("reading: no 0403 tile"));
    await page.waitForTimeout(1200);
    await rec.take("heroes", 500, async () => rec.box("heroes"), 6500);

    // ------------------------------------------------------------------- slip 0462 by hand (MM-2)
    await followPill(/\/by-hand\/0462/, 20_000);
    await expect(page.getByTestId("W-TR-04.input")).toBeEnabled({ timeout: 20_000 });
    await park(page);
    await page.waitForTimeout(1500);
    // Analyn types the stained digit from the keyboard ("Analyn types one stained digit by hand"), then Enter
    const field = page.getByTestId("W-TR-04.input");
    await field.focus();
    await rec.take(
      "byhand",
      4000,
      async () => {
        await rec.box("empty");
        rec.mark("typed");
        await page.keyboard.press("4");
        await expect(field).toHaveValue("64.80");
        await page.waitForTimeout(1200);
        await rec.box("filled");
        await page.waitForTimeout(1600);
        rec.mark("commit");
        await page.keyboard.press("Enter");
        await expect(page.getByTestId("W-TR-04.committed")).toBeVisible();
        rec.mark("committed");
        await page.waitForTimeout(1500);
        await rec.box("committed");
      },
      3500,
    );

    // ------------------------------------------------------------------- H1, the duplicate: Count it once (MM-3)
    await click(page.getByTestId("W-JG-01.rail.split"));
    await expect(page.getByTestId("W-TR-05.grid")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1500);
    await followPill(/hold=H1/, 15_000);
    await expect(page.locator('[data-moment="MM-3"]')).toHaveAttribute("data-moment-phase", "ready", {
      timeout: 20_000,
    });
    await park(page);
    await page.waitForTimeout(1500);
    await rec.take(
      "h1",
      8000,
      async () => {
        await rec.box("ready");
        await tap(page.getByTestId("W-TR-06.countOnce.face"), "countOnce");
        await park(page);
        await phase("MM-3", "resolved", 20_000);
        await page.waitForTimeout(2500);
        await rec.box("resolved");
      },
      6500,
    );

    // ------------------------------------------------------------------- H2, then H3 returned as a credit
    await followPill(/hold=H2/, 15_000);
    await click(page.getByTestId("W-TR-06.registerPlot.face"));
    await expect(page.getByTestId("W-TR-06.result")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
    await followPill(/hold=H3/, 15_000);
    await expect(page.getByTestId("W-TR-06.returnCredit.face")).toBeVisible({ timeout: 20_000 });
    await park(page);
    await page.waitForTimeout(1200);
    await rec.take(
      "h3",
      2500,
      async () => {
        await rec.box("open");
        await tap(page.getByTestId("W-TR-06.returnCredit.face"), "returnCredit");
        await expect(page.getByTestId("W-TR-06.result")).toBeVisible({ timeout: 20_000 });
        await park(page);
        await page.waitForTimeout(1500);
        await rec.box("returned");
      },
      3500,
    );
    await page
      .getByTestId("W-TR-06.drawer.close")
      .click()
      .catch(() => notes.push("holds: no drawer close"));

    // ------------------------------------------------------------------- the rate card refuses (MM-4)
    await click(page.getByTestId("W-JG-01.rail.rate-card"));
    await expect(page.getByTestId("W-TR-02")).toBeVisible({ timeout: 20_000 });
    await park(page);
    await page.waitForTimeout(1500);
    await rec.take(
      "rate",
      2000,
      async () => {
        await rec.box("card");
        await tap(page.getByTestId("W-TR-02.addOpen"), "addOpen");
        await page.waitForTimeout(500);
        const label = page.getByTestId("W-TR-02.addLabel");
        if ((await label.isVisible().catch(() => false)) && (await label.inputValue().catch(() => "")) === "")
          await label.fill("Iba pa (Other)");
        const amount = page.getByTestId("W-TR-02.addAmount");
        if (
          (await amount.isVisible().catch(() => false)) &&
          (await amount.inputValue().catch(() => "")) === ""
        )
          await amount.fill("150");
        await page.waitForTimeout(900);
        await rec.box("adding");
        await tap(page.getByTestId("W-TR-02.addCommit.face"), "commit");
        await expect(page.getByTestId("W-TR-02.refusal")).toBeVisible({ timeout: 15_000 });
        rec.mark("refused");
        await park(page);
        await phase("MM-4", "done", 15_000).catch(() => notes.push("rate: MM-4 done not observed"));
        await page.waitForTimeout(1500);
        await rec.box("refused");
        await page.getByTestId("W-TR-02.refusal").scrollIntoViewIfNeeded();
        rec.mark("scrolled");
        await page.waitForTimeout(600);
        await rec.box("plate");
      },
      4000,
    );

    // ------------------------------------------------------------------- key 1: Analyn holds to sign (MM-5)
    await followPill(/\/approve$/, 20_000);
    await expect(page.getByTestId("W-TR-07.approve.face")).toBeEnabled({ timeout: 30_000 });
    await expect(
      page.frameLocator('[data-testid="W-JG-01.frame.member"]').getByTestId("M-MB-01.capsule"),
    ).toBeAttached({ timeout: 30_000 });
    await capture.refresh();
    await park(page);
    await page.waitForTimeout(1500);
    await rec.take(
      "key1",
      2000,
      async () => {
        await rec.box("ready");
        const posted = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === `/v1/runs/${run.runSlug}/approvals` &&
            r.request().method() === "POST",
          { timeout: 20_000 },
        );
        await test.step("Scripted human: Analyn holds her slab for key 1", async () => {
          await hold(page, page.getByTestId("W-TR-07.approve.face"), 1600, rec, "key1");
        });
        expect((await posted).status()).toBe(201);
        rec.mark("signed");
        await park(page);
        await page.waitForTimeout(2500);
        await rec.box("signed");
      },
      2500,
    );

    // ------------------------------------------------------------------- key 2 on the Chair's phone, then the fan-out
    const chair: FrameLocator = page.frameLocator('[data-testid="W-JG-01.frame.chair"]');
    await click(page.getByTestId("W-TR-07.cosign.frame"));
    await expect(chair.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request", { timeout: 30_000 });
    await page.waitForTimeout(1200);
    await click(chair.getByTestId("M-BD-01.sign"));
    await expect(chair.getByTestId("M-BD-02.slab")).toBeVisible({ timeout: 20_000 });
    await capture.refresh();
    await park(page);
    await page.waitForTimeout(1500);
    await rec.take(
      "keys",
      2000,
      async () => {
        await rec.box("chair");
        const posted = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === `/v1/runs/${run.runSlug}/approvals` &&
            r.request().method() === "POST",
          { timeout: 20_000 },
        );
        await test.step("Scripted human: Ernesto holds Sign on his phone for key 2", async () => {
          await hold(page, chair.getByTestId("M-BD-02.slab"), 1600, rec, "key2");
        });
        expect((await posted).status()).toBe(201);
        rec.mark("signed");
        await park(page);
        await page.waitForTimeout(1600);
        await rec.box("approved");
        // the batch is posted ("Batch accepted", Watch the payouts) before the fan-out is opened on it
        await expect(page.getByTestId("W-TR-07.fanout"))
          .toBeVisible({ timeout: 45_000 })
          .catch(() => notes.push("keys: no Watch the payouts within 45 s"));
        await page.waitForTimeout(2200);
        await expect(pill).toHaveAttribute("href", /\/fanout$/, { timeout: 20_000 });
        await tap(pill, "fanout");
        await park(page);
        // each change of the fan-out's confirmed count, as a mark (the cut times the clip by its first confirmation)
        const counts = (async () => {
          let last = "";
          const until = Date.now() + 40_000;
          while (Date.now() < until && !last.startsWith("7/")) {
            const text =
              (await page
                .getByTestId("W-TR-08.count")
                .textContent({ timeout: 500 })
                .catch(() => "")) ?? "";
            const now = text.replace(/\s+/g, "");
            if (now && now !== last) {
              rec.mark(`count:${now}`);
              last = now;
            }
            await page.waitForTimeout(80);
          }
        })();
        await page.waitForTimeout(1500);
        await rec.box("fanout");
        await waitForRun(
          http,
          run,
          (r) => r.run.state === "NEEDS_FOLLOW_UP" || r.run.state === "SETTLED",
          180_000,
        );
        rec.mark("followUp");
        await counts;
        await page.waitForTimeout(1500);
        await rec.box("parked");
      },
      2000,
      false,
    );

    // ------------------------------------------------------------------- Rhea moves to cash at the bodega
    const cash = page.getByTestId("W-TR-08.payCash.face");
    await cash.scrollIntoViewIfNeeded();
    await expect(cash).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(800);
    await rec.take(
      "cash",
      2500,
      async () => {
        await rec.box("parked");
        await tap(cash, "payCash");
        await park(page);
        await waitForRun(http, run, (r) => r.run.state === "SETTLED", 60_000);
        rec.mark("settled");
        await page.waitForTimeout(1500);
        await rec.box("settled");
      },
      3000,
      false,
    );

    // ------------------------------------------------------------------- Paminawa: her premium sentence plays
    const member = page.frameLocator('[data-testid="W-JG-01.frame.member"]');
    await page.getByTestId("W-JG-01.tab.member").click();
    await expect(member.getByTestId("M-MB-01.capsule")).toContainText(/Bayad/, { timeout: 30_000 });
    await capture.refresh();
    await park(page);
    await page.waitForTimeout(1500);
    await tap(member.getByTestId("M-MB-01.paminawa"));
    await expect(member.getByTestId("M-MB-03")).toBeVisible({ timeout: 20_000 });
    await park(page);
    await page.waitForTimeout(2000);
    const premium = member
      .locator('[data-testid^="M-MB-03.sentence."]')
      .filter({ hasText: /Premium/i })
      .first();
    await premium.scrollIntoViewIfNeeded().catch(() => notes.push("listening: premium row not scrolled"));
    await page.waitForTimeout(800);
    await rec.take(
      "listening",
      1500,
      async () => {
        await rec.box("transcript");
        await tap(premium, "play");
        await park(page);
        await expect(premium)
          .toHaveAttribute("data-state", "current", { timeout: 5000 })
          .catch(() => notes.push("listening: the premium row never read current"));
        await page.waitForTimeout(1500);
        await rec.box("playing");
      },
      7500,
      true,
    );
    await member
      .getByTestId("M-MB-03.close")
      .click()
      .catch(() => notes.push("listening: no close"));
    await expect(member.getByTestId("M-MB-01.capsule")).toBeVisible({ timeout: 20_000 });

    // ------------------------------------------------------------------- her statement: a peso traced (MM-7)
    const net = member.getByTestId("M-MB-01.receipt.net.amount");
    await net.scrollIntoViewIfNeeded().catch(() => notes.push("member: net amount not scrolled"));
    await park(page);
    await page.waitForTimeout(1500);
    await rec.take(
      "member",
      2200,
      async () => {
        await rec.box("statement");
        await tap(net, "tap");
        await park(page);
        await page.waitForTimeout(2500);
        await rec.box("traced");
      },
      3500,
      true,
    );
    // ------------------------------------------------------------------- Proof: Verify in your browser
    const chip = page.getByTestId("W-JG-01.proofChip");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.click();
    await expect(page.getByTestId("W-PF-01")).toBeVisible({ timeout: 30_000 });
    await park(page);
    await page.waitForTimeout(2500);
    const verify = page.getByTestId("W-PF-01.verify").getByRole("button", { name: /Verify in your browser/ });
    await verify.scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    // Proof re-checks every payout item against its verified event; on a busy laptop the last webhook can still be
    // settling, and Verify then (honestly) reads a mismatch. That take is dropped and Proof is checked again a few
    // seconds later, at most three times; the film only uses a take whose verdict reads Sample.
    for (let attempt = 1; ; attempt++) {
      let verdictState = "";
      await rec.take(
        "proof",
        1500,
        async () => {
          await rec.box("before");
          await tap(verify, "verify");
          await park(page);
          const verdict = page.getByTestId("W-PF-01.verdict");
          await expect(verdict).toHaveAttribute("data-state", /sample|mismatch|replay|matches/, {
            timeout: 60_000,
          });
          verdictState = (await verdict.getAttribute("data-state")) ?? "";
          if (verdictState !== "sample") return;
          rec.mark("verdict");
          await page.waitForTimeout(1500);
          await rec.box("verified");
        },
        7000,
      );
      if (verdictState === "sample") break;
      rec.segments.pop();
      notes.push(`proof: attempt ${attempt} read ${verdictState}; checked again`);
      if (attempt >= 3) throw new Error(`Proof read ${verdictState} three times`);
      await page.waitForTimeout(6000);
      await page.reload();
      await expect(page.getByTestId("W-PF-01")).toBeVisible({ timeout: 30_000 });
      await page.waitForTimeout(2500);
      await verify.scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
    }

    // ------------------------------------------------------------------- Try to break it: the overcharge, refused
    const stage = page.getByRole("link", { name: /Fair Split console|Back to the stage/ });
    if (await stage.count()) await stage.first().click();
    else await page.goBack();
    await page.waitForTimeout(2500);
    if (
      !(await page
        .getByTestId("W-JG-01.whatsRealOpen")
        .isVisible()
        .catch(() => false))
    )
      await page.goto(`/runs/${run.runSlug}/fanout`);
    await page.waitForTimeout(1500);
    await page.getByTestId("W-JG-01.whatsRealOpen").click();
    await expect(page.getByTestId("W-JG-01.whatsReal")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("W-JG-01.tryToBreak").scrollIntoViewIfNeeded();
    await park(page);
    await page.waitForTimeout(1500);
    await rec.take(
      "break",
      1500,
      async () => {
        await rec.box("sheet");
        const answer = page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === `/v1/judge/sessions/${run.sessionId}/tamper` &&
            r.request().method() === "POST",
        );
        await tap(page.getByTestId("W-JG-01.tamper.amount"), "tamper");
        expect((await answer).status()).toBe(200);
        rec.mark("answered");
        await park(page);
        await page
          .getByTestId("W-JG-01.tamper.result")
          .scrollIntoViewIfNeeded()
          .catch(() => undefined);
        await page.waitForTimeout(1200);
        await rec.box("denied");
      },
      3500,
    );
  } finally {
    writeFileSync(
      join(OUT, "take.json"),
      `${JSON.stringify(
        {
          recordedAt: new Date(startedAt).toISOString(),
          viewport: VIEW,
          scale: SCALE,
          startedAt,
          phases: capture.phases.map((p) => ({ ...p, at: startedAt + p.atMs })),
          notes,
          segments: rec.segments,
        },
        null,
        1,
      )}\n`,
    );
    if (api && s) await stopBrowserJudge(page, api as Api, s as JudgeSession).catch(() => undefined);
  }
});
