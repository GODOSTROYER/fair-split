// The film's stills take (film v7): one real judge run in Chromium, shot as still images of every product state
// the film shows (research film-1111/product-states.md §2), at 1920 × 1080 CSS and device scale 2 (3840 × 2160),
// with tight crops of the named elements at scale 2 and again at scale 4 (stills-kit.ts). The stills land in
// video/film2/stills/ with stills.json (every file, its CSS size and scale, the CSS-pixel boxes of the elements a
// builder outlines or crops to), and a labelled contact sheet is written beside the film's research notes.
//
//   corepack pnpm exec playwright test -c e2e/film/stills.config.ts        (from the repository root)
//
// Honesty: the take drives the product the way a judge does and changes no time, state, response or figure. Both
// officers sign by holding their own slabs (scripted human steps); Analyn types slip 0462's stained digit from the
// keyboard. Every PayPal value is the private stack's in-process simulator; the film says so once, at its end, so
// the product's "Simulated" marks, the scrims and the toast are hidden in the stills only (stills-kit.ts
// FILM_STYLE). Nothing is shot while PayPal's events are in flight (between key 2 and the follow-up, between "Pay in
// cash" and settled): load then can make an item settle by a status check, and Proof honestly reads 5 of 6. The one
// exception is a single light raster of the Chair's signed phone a second after key 2 (20c), never on a retry. A
// session whose Proof does not read 6 of 6 fails the take; Playwright then runs a fresh session (retries).
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
import type { FrameLocator, Locator, Page } from "@playwright/test";
import { Api, type JudgeSession, waitForRun } from "../lib/api.js";
import { stopBrowserJudge } from "../lib/browser-judge.js";
import { expect, test } from "../lib/fixtures.js";
import { PRESS_LIVE_CALLS, roomFor } from "../lib/paypal-window.js";
import { installFilmCapture } from "./capture.js";
import {
  FILM_STYLE,
  HI_SCALE,
  installFilmStyle,
  type Rect,
  SCALE,
  type StillEntry,
  Stills,
  VIEW,
} from "./stills-kit.js";

const HERE = fileURLToPath(new URL(".", import.meta.url));
/** The take is shot here first; only a whole, good take replaces the film's stills. */
const TAKE = join(HERE, "..", "film-out", "stills-take");
const OUT = process.env.FILM_STILLS_OUT ?? join(HERE, "..", "..", "video", "film2", "stills");
const SHEET =
  process.env.FILM_STILLS_SHEET ??
  join(HERE, "..", "..", "..", "..", "research", "film-1111", "stills-sheet.png");

test.describe.configure({ mode: "serial" });

/** Slip 0403's recorded exhibit without the lines the film says once at its end (the stand-in column and notes). */
const HERO_CSS = `
.fsc-heroes > p, .fsc-heroes__tile > p.fs-t-caption ~ p.fs-t-caption,
.fsc-heroes__comparison > div + div, .fsc-heroes__tile summary, .fsc-heroes__tile caption,
.fsc-heroes__tile table tr > :last-child { display: none !important; }
`;
const hide = (...ids: string[]) =>
  `${ids.map((id) => `[data-testid="${id}"]`).join(", ")} { visibility: hidden !important; }`;
const drop = (...ids: string[]) =>
  `${ids.map((id) => `[data-testid="${id}"]`).join(", ")} { display: none !important; }`;

/** How busy the machine's processors are over `ms`, 0 to 1. */
async function load(ms: number): Promise<number> {
  const read = () =>
    cpus().map((c) => ({ idle: c.times.idle, all: Object.values(c.times).reduce((a, b) => a + b, 0) }));
  const a = read();
  await new Promise((done) => setTimeout(done, ms));
  const b = read();
  let idle = 0;
  let all = 0;
  for (let i = 0; i < a.length; i++) {
    idle += (b[i]?.idle ?? 0) - (a[i]?.idle ?? 0);
    all += (b[i]?.all ?? 0) - (a[i]?.all ?? 0);
  }
  return all > 0 ? 1 - idle / all : 0;
}

/**
 * The slip's paper inside a photo that also shows the mat it lies on: the picture's drawn box (object-fit: contain)
 * times the paper's share of the source image.
 */
function paperIn(img: Locator, share: { x0: number; y0: number; x1: number; y1: number }) {
  return async (): Promise<Rect | null> => {
    const box = await img.boundingBox().catch(() => null);
    const natural = await img
      .evaluate((node: HTMLImageElement) => ({ w: node.naturalWidth, h: node.naturalHeight }))
      .catch(() => null);
    if (!box || !natural?.w || !natural.h) return null;
    const scale = Math.min(box.width / natural.w, box.height / natural.h);
    const w = natural.w * scale;
    const h = natural.h * scale;
    const x = box.x + (box.width - w) / 2;
    const y = box.y + (box.height - h) / 2;
    return [x + w * share.x0, y + h * share.y0, w * (share.x1 - share.x0), h * (share.y1 - share.y0)];
  };
}
/** Slip 0403's paper in its hero photo (1199 × 1312): inside the paper's edges, above its printed specimen line. */
const PAPER_0403 = { x0: 0.076, y0: 0.045, x1: 0.884, y1: 0.898 };

/** A real pointer press on the control, the way a hand presses it; the pointer then leaves (no hover in a still). */
async function press(page: Page, target: Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error("Film target has no pointer box");
  await page.mouse.move(box.x + Math.min(box.width / 2, 48), box.y + box.height / 2, { steps: 8 });
  await page.mouse.down();
  await page.waitForTimeout(90);
  await page.mouse.up();
}

/** A slab held with the pointer for `ms` and released inside it (the officer's own route). */
async function hold(page: Page, face: Locator, ms: number) {
  await face.scrollIntoViewIfNeeded();
  const box = await face.boundingBox();
  if (!box) throw new Error("The slab has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 12 });
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test("film stills take: every product state of the film, from one real judge run", async ({
  page,
  origin,
}, testInfo) => {
  test.setTimeout(25 * 60_000);
  rmSync(TAKE, { recursive: true, force: true });
  mkdirSync(TAKE, { recursive: true });
  const stills = new Stills(page, TAKE);
  const notes = stills.notes;
  const startedAt = Date.now();
  const capture = await installFilmCapture(page, startedAt);
  await page.addInitScript(installFilmStyle, FILM_STYLE);
  const click = (target: Locator) => press(page, target);
  const phase = (moment: string, value: string, timeout = 60_000) =>
    expect
      .poll(() => capture.phases.some((event) => event.moment === moment && event.phase === value), {
        timeout,
      })
      .toBe(true);
  /** A load first shows a boot shell ("Loading season 2026-A"): the app has mounted once that is gone. */
  const booted = async () => {
    await expect(page.getByTestId("boot")).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByTestId("W-JG-01.whatsRealOpen").or(page.getByTestId("W-PF-01"))).toBeVisible({
      timeout: 60_000,
    });
  };
  const pill = page.getByTestId("W-JG-01.runPill.next");
  const followPill = async (want: RegExp, ms = 30_000) => {
    await expect(pill).toHaveAttribute("href", want, { timeout: ms });
    await click(pill);
  };
  /** A figure the film quotes must be the seed's: a still whose element reads otherwise is named in the notes. */
  const figure = async (where: Locator, want: string | RegExp, what: string) => {
    const text = ((await where.textContent({ timeout: 5000 }).catch(() => "")) ?? "").replace(/\s+/g, " ");
    if (typeof want === "string" ? !text.includes(want) : !want.test(text))
      notes.push(`FIGURE ${what}: wanted ${String(want)}, read "${text.slice(0, 160)}"`);
  };
  const member: FrameLocator = page.frameLocator('[data-testid="W-JG-01.frame.member"]');
  const chair: FrameLocator = page.frameLocator('[data-testid="W-JG-01.frame.chair"]');
  const device = page.getByTestId("W-JG-01.frame").first();
  const M = "W-JG-01.frame.member";
  const C = "W-JG-01.frame.chair";
  let api: Api | null = null;
  let s: JudgeSession | null = null;
  let good = false;
  let phone: { deviceRadius: string; screenRadius: string } | null = null;

  try {
    // ------------------------------------------------------------------- #1 the season, before funding
    await roomFor(PRESS_LIVE_CALLS);
    await page.goto("/judge");
    await booted();
    const mark = page.getByRole("button", { name: /Mark Lantern Bay.s invoice paid/ });
    await expect(mark).toBeVisible({ timeout: 60_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(3000);
    await figure(page.getByTestId("W-JG-01.invoice.amount"), "4,333.50", "invoice");
    await stills.take("01-season", {
      state: "1",
      title: "Season, before funding",
      boxes: [/^W-JG-01\.(invoice|pool|rules|photos|markPaid|title)/],
      crops: {
        invoice: "W-JG-01.invoice",
        "invoice-amount": { of: "W-JG-01.invoice.amount", pad: 8 },
        pool: "W-JG-01.pool",
        "pool-amount": { of: "W-JG-01.pool.amount", pad: 8 },
        "invoice-pool-row": { of: ["W-JG-01.invoice", "W-JG-01.pool"], pad: 12, hi: true },
        rules: "W-JG-01.rules",
        photos: { of: "W-JG-01.photos", hi: true },
        "mark-paid": { of: "W-JG-01.markPaid", pad: 8 },
      },
    });

    // ------------------------------------------------------------------- #3 funded (the first press, MM-S)
    capture.phases.length = 0;
    const started = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/v1/judge/sessions" && r.request().method() === "POST",
    );
    const pressedAt = Date.now();
    await click(mark);
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
    const run = s;
    const http = api;
    // the sound offer is answered without pointer travel
    const offer = page.getByTestId("W-JG-01.soundOffer.no");
    await offer
      .waitFor({ state: "visible", timeout: 4000 })
      .then(() => offer.dispatchEvent("click"))
      .catch(() => notes.push("funding: no sound offer within 4 s"));
    await phase("MM-S", "funded");
    await page.waitForTimeout(3500);
    await stills.take("03-funded", {
      state: "3",
      title: "Funded: Lantern Bay's payment recorded",
      boxes: [/^W-JG-01\.(invoice|pool|funded|title|arc)/],
      note: "The record line 'Marked paid by Analyn' is W-JG-01.markPaid in this state: the '-nosource' crops hide it (visibility only, nothing moves); 'invoice-head' and 'pool-head' end above it.",
      crops: {
        invoice: "W-JG-01.invoice",
        pool: "W-JG-01.pool",
        "pool-amount": { of: "W-JG-01.pool.amount", pad: 8 },
        funded: { of: "W-JG-01.funded", pad: 8 },
        "invoice-pool-row": { of: ["W-JG-01.invoice", "W-JG-01.pool"], pad: 12, hi: true },
        "invoice-pool-row-nosource": {
          of: ["W-JG-01.invoice", "W-JG-01.pool"],
          pad: 12,
          hi: true,
          css: hide("W-JG-01.markPaid"),
        },
        "invoice-nosource": { of: "W-JG-01.invoice", css: hide("W-JG-01.markPaid") },
        "invoice-head": {
          from: (b) => {
            const card = b["W-JG-01.invoice"];
            const amount = b["W-JG-01.invoice.amount"];
            return card && amount ? [card[0], card[1], card[2], amount[1] + amount[3] + 44 - card[1]] : null;
          },
          hi: true,
        },
      },
    });

    // ------------------------------------------------------------------- #9 the reading room: 1 needs a person
    await followPill(/\/reading/);
    await waitForRun(http, run, (r) => r.run.state === "IN_REVIEW", 120_000);
    // the room moves on to the slip that needs a person once the reading is done: come back to it by the rail
    await click(page.getByTestId("W-JG-01.rail.reading"));
    await expect(page.getByTestId("W-TR-03")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("W-TR-03.beds.row.0462")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await stills.take("09-needs-a-person", {
      state: "9",
      title: "47 of 48 read: slip 0462 needs a person",
      boxes: [/^W-TR-03\.(film|status|bench|beds$|beds\.row\.0462|beds\.you\.0462|room|enterByHand)/],
      crops: {
        progress: { of: "W-TR-03.film.progress", pad: 8 },
        status: { of: "W-TR-03.status", pad: 8 },
        "row-0462": { of: "W-TR-03.beds.row.0462", pad: 6 },
        "enter-by-hand": { of: "W-TR-03.enterByHand", pad: 10, hi: true },
        beds: "W-TR-03.beds",
        bench: "W-TR-03.bench",
        film: "W-TR-03.film",
      },
    });

    // ------------------------------------------------------------------- #7 Claude's recorded readings, slip 0403
    // (the exhibit sits under the room, in the screen's own scroller; its ten photos load as they come into view)
    const tile = page.locator('[data-testid^="W-TR-03.hero."]').filter({ hasText: "0403" }).first();
    const screen = page.locator("main.fsc-console__screen");
    const bring = async (target: Locator, block: "start" | "center") => {
      for (let i = 0; i < 8; i++) {
        await target.evaluate(
          (node, where) =>
            node.scrollIntoView({ block: where as ScrollLogicalPosition, behavior: "instant" }),
          block,
        );
        await page.waitForTimeout(900);
        const box = await target.boundingBox().catch(() => null);
        if (box && box.y >= 70 && box.y + Math.min(box.height, 960) <= VIEW.height + 1) return true;
      }
      notes.push("reading: the 0403 exhibit would not stay in view");
      return false;
    };
    const hero = async () => {
      await page.getByTestId("W-TR-03.heroes").evaluate((node) => node.scrollIntoView({ block: "start" }));
      await expect
        .poll(
          () =>
            page
              .locator(".fsc-heroes__photo > img")
              .evaluateAll((imgs) => imgs.every((img) => (img as HTMLImageElement).complete)),
          { timeout: 30_000 },
        )
        .toBe(true)
        .catch(() => notes.push("reading: not every exhibit photo loaded"));
      // round 6: the photo is two layers of one image (the whole frame in grey, the paper in colour over it)
      const frame = tile.locator(".fsc-heroes__photo");
      const photo = tile.locator("img.fsc-heroes__paper");
      await photo.evaluate((img: HTMLImageElement) => img.decode().catch(() => undefined));
      await figure(tile.locator(".fsc-heroes__comparison"), "38.45 / 38.45", "0403 read A / read B");
      await stills.style(HERO_CSS, "hero");
      await bring(tile, "start");
      await stills.take("07a-claude-reads-0403", {
        state: "7",
        title: "Claude's recorded reading of slip 0403: the slip and both net readings",
        keepFocus: true,
        note: "The exhibit's stand-in column, its provisional notes and the summary line are hidden for the film (HERO_CSS). The photo's own printed 'SPECIMEN · SYNTHETIC DEMO PAD' line is in its pixels: 'paper' ends above it and leaves the mat out.",
        boxes: [/^W-TR-03\.hero\./, "W-TR-03.heroes"],
        crops: {
          tile: { of: tile, hi: true },
          slip: { of: frame, hi: true },
          paper: { from: paperIn(photo, PAPER_0403), hi: true },
          // round 6 draws the paper in colour only inside one fixed cut (reading.css .fsc-heroes__paper), which on
          // this slip leaves its serial and its left rule in the grey layer: this crop stays inside that cut
          "paper-colour": {
            from: paperIn(photo, { x0: 0.126, y0: 0.097, x1: 0.87, y1: 0.898 }),
            hi: true,
            note: "Only the part of the paper the product draws in colour (its serial number and left table rule fall outside the product's colour cut and show grey in 'paper').",
          },
          "net-a-b": { of: tile.locator(".fsc-heroes__comparison > div").first(), pad: 6, hi: true },
          "caption-claude": { of: tile.locator("p.fs-t-caption").first(), pad: 4, hi: true },
        },
      });
      await stills.style(undefined, "hero");
      await tile.locator("summary").click();
      await stills.style(HERO_CSS, "hero");
      await bring(tile.locator("table"), "center");
      await stills.take("07b-claude-reads-0403-table", {
        state: "7",
        title: "Claude's recorded readings of slip 0403: Read A beside Read B, field by field",
        keepFocus: true,
        boxes: [/^W-TR-03\.hero\./, "W-TR-03.heroes"],
        crops: {
          table: { of: tile.locator("table"), pad: 4, hi: true },
          "net-row": {
            of: tile
              .locator("tbody tr")
              .filter({ hasText: /^net kg/i })
              .first(),
            pad: 2,
            hi: true,
          },
          "table-head": { of: tile.locator("thead"), pad: 2, hi: true },
          "net-a-b": { of: tile.locator(".fsc-heroes__comparison > div").first(), pad: 6, hi: true },
        },
      });
    };
    await hero().catch((error: unknown) => notes.push(`hero exhibit: ${String(error).slice(0, 240)}`));
    await stills.style(undefined, "hero");
    await tile
      .locator("details")
      .evaluate((node: HTMLDetailsElement) => {
        node.open = false;
      })
      .catch(() => undefined);
    await screen.evaluate((node) => node.scrollTo(0, 0)).catch(() => undefined);
    await page.waitForTimeout(800);

    // ------------------------------------------------------------------- #10 slip 0462 by hand (MM-2)
    await followPill(/\/by-hand\/0462/, 20_000);
    const field = page.getByTestId("W-TR-04.input");
    await expect(field).toBeEnabled({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    const byHand = {
      boxes: [/^W-TR-04\./],
      crops: {
        slip: { of: "W-TR-04.crop", hi: true },
        logbook: { of: "W-TR-04.logbook", hi: true },
        entry: { of: ["W-TR-04.input", "W-TR-04.commit.face"], pad: 16, hi: true },
        input: { of: "W-TR-04.input", pad: 8 },
      },
    } as const;
    await stills.take("10a-by-hand-empty", {
      state: "10",
      title: "By hand: the stained digit, empty",
      ...byHand,
    });
    // Analyn types the stained digit from the keyboard, then Enter
    await field.focus();
    await page.keyboard.press("4");
    await expect(field).toHaveValue("64.80");
    await page.waitForTimeout(1200);
    await stills.take("10b-by-hand-filled", {
      state: "10",
      title: "By hand: 64.80 typed",
      keepFocus: true,
      css: `[data-testid="W-TR-04.input"] { outline-color: transparent !important; }`,
      ...byHand,
    });
    await expect(field).toHaveValue("64.80");
    await field.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("W-TR-04.committed")).toBeVisible();
    await page.waitForTimeout(2000);
    await stills.take("10c-by-hand-committed", {
      state: "10",
      title: "By hand: committed, 64.50 kg net",
      boxes: [/^W-TR-04\./],
      crops: {
        slip: { of: "W-TR-04.crop", hi: true },
        logbook: { of: "W-TR-04.logbook", hi: true },
        committed: { of: "W-TR-04.committed", pad: 12, hi: true },
        net: { of: "W-TR-04.net", pad: 8 },
        provenance: { of: "W-TR-04.provenance", pad: 8 },
      },
    });

    // ------------------------------------------------------------------- #11 the split: three holds, over the limit
    await click(page.getByTestId("W-JG-01.rail.split"));
    await expect(page.getByTestId("W-TR-05.grid")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("W-TR-05.row.M-007")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    const splitBoxes = [
      /^W-TR-05\.(bench|dial|reading|pools?$|grid|totals|note\.|dup\.|row\.|reconcile|next)/,
    ];
    /** The grid's full width from the top of one row to the bottom of another (a row's own id is its first cell). */
    const rows =
      (first: string, last: string, above = 0) =>
      (b: Record<string, Rect>): Rect | null => {
        const grid = b["W-TR-05.grid"];
        const a = b[`W-TR-05.row.${first}`];
        const z = b[`W-TR-05.row.${last}`];
        if (!grid || !a || !z) return null;
        const top = above ? grid[1] : a[1] - 3;
        return [grid[0], top, grid[2], z[1] + z[3] + 3 - top];
      };
    await figure(page.getByTestId("W-TR-05.reading"), "2.05", "shrink before");
    await stills.take("11-split-three-holds", {
      state: "11",
      title: "The split: three holds, the dial over the limit",
      boxes: splitBoxes,
      note: "The dial is amber over the limit: 'held-rows' and 'grid' leave it out.",
      crops: {
        bench: "W-TR-05.bench",
        dial: { of: "W-TR-05.dial", pad: 8 },
        pools: { of: "W-TR-05.pools", pad: 8, hi: true },
        grid: "W-TR-05.grid",
        "held-rows": { from: rows("M-007", "M-018") },
        "head-and-held-rows": { from: rows("M-007", "M-018", 1) },
        "row-M-007": { from: rows("M-007", "M-007") },
        "note-H1": { of: "W-TR-05.note.H1" },
        "note-H2": { of: "W-TR-05.note.H2" },
      },
    });

    // ------------------------------------------------------------------- #12 H1 open: the white and the pink twin
    await followPill(/hold=H1/, 15_000);
    await expect(page.locator('[data-moment="MM-3"]')).toHaveAttribute("data-moment-phase", "ready", {
      timeout: 20_000,
    });
    await page.waitForTimeout(2500);
    const drawerBoxes = [/^W-TR-06\./, /^W-TR-05\.(reading|dial|row\.M-007|bench)/];
    await stills.take("12-h1-open", {
      state: "12",
      title: "Hold H1: slip 0457 counted twice (white original, pink copy)",
      boxes: drawerBoxes,
      crops: {
        drawer: { of: "W-TR-06.drawer", hi: true },
        card: { of: "W-TR-06.card", hi: true },
        twin: { of: "W-TR-06.twin", pad: 6, hi: true },
        "twin-white": { of: "W-TR-06.twin.a", hi: true },
        "twin-pink": { of: "W-TR-06.twin.b", hi: true },
        "twin-slips": { of: ["W-TR-06.twin.a", "W-TR-06.twin.b"], pad: 4, hi: true },
        effect: { of: "W-TR-06.card.effect", pad: 6, hi: true },
        "twin-fields": { of: "W-TR-06.twin.fields", pad: 4 },
        "twin-verdict": { of: "W-TR-06.twin.verdict", pad: 4 },
        "count-once": { of: "W-TR-06.countOnce.face", pad: 10 },
      },
    });

    // ------------------------------------------------------------------- #13 Count it once: resolved
    capture.phases.length = 0;
    await click(page.getByTestId("W-TR-06.countOnce.face"));
    await phase("MM-3", "resolved", 20_000);
    await page.waitForTimeout(3000);
    await figure(page.getByTestId("W-TR-06.result"), "17.94", "H1 back to members");
    await figure(page.getByTestId("W-TR-05.reading"), "1.62", "shrink after");
    await stills.take("13-h1-resolved", {
      state: "13",
      title: "H1 resolved: +US$17.94 back to 63 members, 1.62%",
      boxes: drawerBoxes,
      crops: {
        drawer: { of: "W-TR-06.drawer", hi: true },
        result: { of: "W-TR-06.result", pad: 8, hi: true },
        bench: "W-TR-05.bench",
        dial: { of: "W-TR-05.dial", pad: 8 },
        reading: { of: "W-TR-05.reading", pad: 10 },
        "row-M-007": { from: rows("M-007", "M-007") },
      },
    });

    // ------------------------------------------------------------------- #14 H2: more than the plot can grow
    await followPill(/hold=H2/, 15_000);
    await expect(page.getByTestId("W-TR-06.registerPlot.face")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    await stills.take("14a-h2-open", {
      state: "14",
      title: "Hold H2: more than the plot can grow",
      boxes: drawerBoxes,
      crops: {
        drawer: { of: "W-TR-06.drawer", hi: true },
        yield: { of: "W-TR-06.yield", pad: 6, hi: true },
        register: { of: "W-TR-06.registerPlot.face", pad: 10 },
      },
    });
    await click(page.getByTestId("W-TR-06.registerPlot.face"));
    await expect(page.getByTestId("W-TR-06.result")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await stills.take("14b-h2-registered", {
      state: "14",
      title: "H2 decided: the second plot registered",
      boxes: drawerBoxes,
      crops: {
        drawer: { of: "W-TR-06.drawer", hi: true },
        result: { of: "W-TR-06.result", pad: 8, hi: true },
      },
    });

    // ------------------------------------------------------------------- #15 H3: a fine with no rule
    await followPill(/hold=H3/, 15_000);
    await expect(page.getByTestId("W-TR-06.returnCredit.face")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2000);
    await stills.take("15a-h3-open", {
      state: "15",
      title: "Hold H3: a deduction with no rule",
      boxes: drawerBoxes,
      crops: {
        drawer: { of: "W-TR-06.drawer", hi: true },
        norule: { of: "W-TR-06.norule", pad: 6, hi: true },
        "norule-slip": { of: "W-TR-06.norule.slip", hi: true },
        "return-credit": { of: "W-TR-06.returnCredit.face", pad: 10 },
      },
    });
    await click(page.getByTestId("W-TR-06.returnCredit.face"));
    await expect(page.getByTestId("W-TR-06.result")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await stills.take("15b-h3-returned", {
      state: "15",
      title: "H3 decided: the ₱200 returned as a credit",
      boxes: drawerBoxes,
      crops: {
        drawer: { of: "W-TR-06.drawer", hi: true },
        result: { of: "W-TR-06.result", pad: 8, hi: true },
      },
    });

    // ------------------------------------------------------------------- #16 the balanced split
    await page
      .getByTestId("W-TR-06.drawer.close")
      .click()
      .catch(() => notes.push("holds: no drawer close"));
    await expect(page.getByTestId("W-TR-06.drawer"))
      .toBeHidden({ timeout: 10_000 })
      .catch(() => undefined);
    await page.waitForTimeout(2500);
    await stills.take("16-split-balanced", {
      state: "16",
      title: "The balanced split: 64 lines, 1.62%, nothing held",
      boxes: splitBoxes,
      crops: {
        bench: "W-TR-05.bench",
        dial: { of: "W-TR-05.dial", pad: 8 },
        pools: { of: "W-TR-05.pools", pad: 8, hi: true },
        grid: "W-TR-05.grid",
        "rows-top": {
          from: (b) => {
            const grid = b["W-TR-05.grid"];
            const ids = Object.keys(b).filter((k) => /^W-TR-05\.row\.M-\d+$/.test(k));
            const sixth = ids.map((k) => b[k] as Rect).sort((p, q) => p[1] - q[1])[5];
            return grid && sixth ? [grid[0], grid[1], grid[2], sixth[1] + sixth[3] + 3 - grid[1]] : null;
          },
        },
        reconcile: { of: "W-TR-05.reconcile", pad: 8, hi: true },
        "totals-net": { of: "W-TR-05.totals.net", pad: 8 },
        balanced: { of: "W-TR-05.totals.balanced", pad: 8 },
      },
    });

    // ------------------------------------------------------------------- #4 the rate card's hash plate
    await click(page.getByTestId("W-JG-01.rail.rate-card"));
    await expect(page.getByTestId("W-TR-02")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("W-TR-02.bolted")).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(2500);
    await stills.take("04-rate-card", {
      state: "4",
      title: "The rate card: hashed and ratified before the first slip",
      boxes: [/^W-TR-02\./],
      crops: {
        plate: { of: "W-TR-02.bolted", hi: true },
        hash: { of: "W-TR-02.bolted.hash", pad: 8, hi: true },
        sealed: { of: ["W-TR-02.bolted.sealed", "W-TR-02.bolted.hash"], pad: 8, hi: true },
        page1: { of: "W-TR-02.pages.page1", hi: true },
        pages: { of: "W-TR-02.pages", hi: true },
        rules: { of: "W-TR-02.rules", hi: true },
        state: { of: "W-TR-02.state", pad: 8 },
      },
    });

    // ------------------------------------------------------------------- #5 the rate card refuses (MM-4)
    capture.phases.length = 0;
    await click(page.getByTestId("W-TR-02.addOpen"));
    await page.waitForTimeout(500);
    const label = page.getByTestId("W-TR-02.addLabel");
    if ((await label.isVisible().catch(() => false)) && (await label.inputValue().catch(() => "")) === "")
      await label.fill("Iba pa (Other)");
    const amount = page.getByTestId("W-TR-02.addAmount");
    if ((await amount.isVisible().catch(() => false)) && (await amount.inputValue().catch(() => "")) === "")
      await amount.fill("150");
    await page.waitForTimeout(900);
    await click(page.getByTestId("W-TR-02.addCommit.face"));
    await expect(page.getByTestId("W-TR-02.refusal")).toBeVisible({ timeout: 15_000 });
    await phase("MM-4", "done", 15_000).catch(() => notes.push("rate: MM-4 done not observed"));
    await page.getByTestId("W-TR-02.refusal").scrollIntoViewIfNeeded();
    await page.waitForTimeout(2000);
    const refusal = {
      boxes: [/^W-TR-02\./],
      crops: {
        add: { of: "W-TR-02.add", hi: true },
        refusal: { of: "W-TR-02.refusal", pad: 8, hi: true },
        "refused-row": { of: "W-TR-02.refusedRow", pad: 8, hi: true },
        pages: { of: "W-TR-02.pages", hi: true },
      },
    } as const;
    await stills.take("05a-rate-card-refused", {
      state: "5",
      title: "The rate card refuses: Schedule A is closed",
      ...refusal,
    });
    await page
      .getByTestId("W-TR-02.why")
      .locator("summary")
      .click()
      .catch(() => notes.push("rate: no Why to open"));
    await page.waitForTimeout(1200);
    await stills.take("05b-rate-card-refused-why", {
      state: "5",
      title: "The refusal, with its reason and the card's hash",
      boxes: refusal.boxes,
      crops: { ...refusal.crops, why: { of: "W-TR-02.why", pad: 8, hi: true } },
    });

    // ------------------------------------------------------------------- #17 approve: ready for key 1 (MM-5)
    await followPill(/\/approve$/, 20_000);
    await expect(page.getByTestId("W-TR-07.approve.face")).toBeEnabled({ timeout: 30_000 });
    await expect(member.getByTestId("M-MB-01.capsule")).toBeAttached({ timeout: 30_000 });
    await capture.refresh();
    await page.waitForTimeout(2500);
    const approveBoxes = [
      /^W-TR-07\./,
      new RegExp(`^${C.replaceAll(".", "\\.")}>M-BD-0[12]`),
      /^W-JG-01\.frame\./,
    ];
    const approveCrops = {
      "seal-block": { of: "W-TR-07.sealBlock", pad: 8, hi: true },
      seal: { of: "W-TR-07.seal", pad: 6, hi: true },
      amount: { of: "W-TR-07.amount", pad: 8 },
      keys: { of: ["W-TR-07.key.treasurer", "W-TR-07.key.chair"], pad: 8, hi: true },
      safe: { of: "W-TR-07.safe", pad: 6, hi: true },
      "money-bar": { of: "W-TR-07.rail", pad: 6 },
      payees: { of: "W-TR-07.payees", pad: 6, hi: true },
    } as const;
    await figure(page.getByTestId("W-TR-07.amount"), "368.39", "batch");
    await stills.take("17-approve-ready", {
      state: "17",
      title: "Approve: the batch, ready for key 1",
      boxes: approveBoxes,
      crops: { ...approveCrops, slab: { of: "W-TR-07.approve.face", pad: 10 } },
    });

    // ------------------------------------------------------------------- #18 key 1 signed; the Chair's phone
    const posted1 = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/v1/runs/${run.runSlug}/approvals` && r.request().method() === "POST",
      { timeout: 20_000 },
    );
    await test.step("Scripted human: Analyn holds her slab for key 1", async () => {
      await hold(page, page.getByTestId("W-TR-07.approve.face"), 1600);
    });
    expect((await posted1).status()).toBe(201);
    await page.waitForTimeout(3000);
    await stills.take("18a-key-1-signed", {
      state: "18",
      title: "Key 1 signed: 1 of 2",
      boxes: approveBoxes,
      crops: approveCrops,
    });
    await click(page.getByTestId("W-TR-07.cosign.frame"));
    await expect(chair.getByTestId("M-BD-01")).toHaveAttribute("data-state", "request", { timeout: 30_000 });
    await page.waitForTimeout(2500);
    const chairCrops = {
      phone: { of: device, hi: true },
      screen: { of: C, hi: true },
    } as const;
    await stills.take("18b-key-1-chair-phone", {
      state: "18",
      title: "Key 1 signed: the Chair's phone shows the same seal and hash",
      boxes: approveBoxes,
      crops: {
        ...approveCrops,
        ...chairCrops,
        "phone-seal": { of: [`${C}>M-BD-01.seal`, `${C}>M-BD-01.hash`], pad: 8, hi: true },
        "console-and-phone": { of: ["W-TR-07.sealBlock", device], pad: 8 },
      },
    });

    // ------------------------------------------------------------------- #19 the Chair's sign screen (M-BD-02)
    await click(chair.getByTestId("M-BD-01.sign"));
    await expect(chair.getByTestId("M-BD-02.slab")).toBeVisible({ timeout: 20_000 });
    await capture.refresh();
    await page.waitForTimeout(2500);
    await stills.take("19-chair-sign-screen", {
      state: "19",
      title: "The Chair's sign screen: the same seal, hash and amount",
      boxes: approveBoxes,
      crops: {
        ...chairCrops,
        "phone-seal": { of: [`${C}>M-BD-02.seal`, `${C}>M-BD-02.hash`], pad: 8, hi: true },
        "seal-block": approveCrops["seal-block"],
        "console-and-phone": { of: ["W-TR-07.sealBlock", device], pad: 8 },
      },
    });

    // ------------------------------------------------------------------- key 2, then the fan-out: nothing is shot
    // while PayPal's events are in flight. fs-api reads the batch 25 s after it posts it; an item whose event has not
    // landed by then settles by that status check, and Proof then honestly reads 5 of 6. So the take first waits for
    // a quiet machine (nothing is pending: key 2 is the Chair's to give when he likes), and once key 2 is given the
    // page is left (no frames to draw, no event stream) until fs-api says the run needs its follow-up.
    for (let waited = 0; waited < 240_000; waited += 5000) {
      const busy = await load(4000);
      if (busy < 0.7) break;
      if (waited === 0)
        process.stdout.write(
          `[film-stills] the machine is busy (${Math.round(busy * 100)}%): waiting up to 4 min before key 2\n`,
        );
      await page.waitForTimeout(1000);
    }
    const inFlight = async (want: (state: string) => boolean, ms: number) => {
      await page.goto("about:blank");
      const until = Date.now() + ms;
      let state = "";
      while (Date.now() < until) {
        const r = await http.get(`/v1/runs/${run.runSlug}`, run.asTreasurer);
        state = r.status === 200 ? (r.json as { run: { state: string } }).run.state : state;
        if (want(state)) break;
        await new Promise((done) => setTimeout(done, 2000));
      }
      if (!want(state)) throw new Error(`the run stayed ${state}`);
      // the last verified events (and their confirmations of what a status check read first) land after the state
      await new Promise((done) => setTimeout(done, 8000));
      await page.goto(`/runs/${run.runSlug}/fanout`);
      await booted();
      await expect(page.getByTestId("W-TR-08.fan")).toBeVisible({ timeout: 60_000 });
      await page.evaluate(() => document.fonts.ready);
    };
    const posted2 = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/v1/runs/${run.runSlug}/approvals` && r.request().method() === "POST",
      { timeout: 20_000 },
    );
    await test.step("Scripted human: Ernesto holds Sign on his phone for key 2", async () => {
      await hold(page, chair.getByTestId("M-BD-02.slab"), 1600);
    });
    expect((await posted2).status()).toBe(201);
    // The Chair's phone, signed ("Napirmahan"): the one thing shot between key 2 and the follow-up, and only as one
    // light raster of the phone alone, a second after the key (fs-api's read of the batch comes 25 s after it posts
    // it). A session that then loses its 6 of 6 is dropped as ever, and the fresh one does not shoot it again, so
    // it can cost one session at most. FILM_STILLS_SIGNED=0 leaves it out.
    if (testInfo.retry === 0 && process.env.FILM_STILLS_SIGNED !== "0") {
      await page.mouse.move(VIEW.width - 1, VIEW.height - 1);
      const signed = chair.getByTestId("M-BD-02.signed");
      const shown = await signed.waitFor({ state: "visible", timeout: 4000 }).then(
        () => true,
        () => false,
      );
      if (shown) {
        await page.waitForTimeout(700);
        await stills.takeElement("20c-chair-phone-signed", {
          state: "20",
          title: "Key 2 given: the Chair's phone, signed",
          of: device,
          name: "phone",
          extra: Object.fromEntries(
            ["M-BD-02", "M-BD-02.seal", "M-BD-02.hash", "M-BD-02.amount", "M-BD-02.signed"].map((testId) => [
              `${C}>${testId}`,
              chair.getByTestId(testId).first(),
            ]),
          ),
          boxes: [new RegExp(`^${C.replaceAll(".", "\\.")}>M-BD-0[12]`), /^W-JG-01\.frame\./],
          note: "One raster of the phone alone at the high scale (no full frame): shot a second after key 2, before PayPal's events are in flight.",
        });
      } else notes.push("signed: the Chair's phone did not show M-BD-02.signed within 4 s; not shot");
    } else {
      notes.push(
        "signed: the Chair's signed phone is not shot in this session (a retry, or FILM_STILLS_SIGNED=0)",
      );
      await page.waitForTimeout(1200);
    }
    await inFlight((state) => state === "NEEDS_FOLLOW_UP" || state === "SETTLED", 240_000);
    await expect(page.getByTestId("W-TR-08.parked")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("W-TR-08.status"))
      .toContainText(/7/, { timeout: 60_000 })
      .catch(() => notes.push("fan-out: its count does not read 7"));
    await page.waitForTimeout(4000);

    // ------------------------------------------------------------------- #22 the fan-out, Rhea parked
    const fanBoxes = [
      /^W-TR-08\.(parked|payCash|count|fan$|settled|cashLabel|kept|share|figureBlock|label\.|thread\.M-031)/,
    ];
    await stills.take("22a-fanout-rhea-parked", {
      state: "22",
      title: "The fan-out: 7 of 8 confirmed, Rhea Jumawan parked",
      boxes: fanBoxes,
      crops: {
        fan: { of: "W-TR-08.fan" },
        parked: { of: "W-TR-08.parked", pad: 8, hi: true },
        share: { of: "W-TR-08.share", pad: 8, hi: true },
        threads: {
          from: (b) => {
            const fan = b["W-TR-08.fan"];
            const share = b["W-TR-08.share"];
            return fan && share
              ? [fan[0], share[1] + share[3] + 8, fan[2], fan[1] + fan[3] - share[1] - share[3] - 8]
              : null;
          },
        },
        counts: { of: "W-TR-08.status", pad: 8, hi: true },
        count: { of: "W-TR-08.count", pad: 10 },
      },
    });

    // ------------------------------------------------------------------- Rhea moves to cash; nothing shot in flight
    const cash = page.getByTestId("W-TR-08.payCash.face");
    await cash.scrollIntoViewIfNeeded();
    await expect(cash).toBeEnabled({ timeout: 60_000 });
    await page.waitForTimeout(800);
    const paid = page.waitForResponse(
      (r) =>
        /^\/v1\/lines\/[^/]+\/pay-cash$/.test(new URL(r.url()).pathname) && r.request().method() === "POST",
      { timeout: 30_000 },
    );
    await click(cash);
    expect((await paid).status()).toBeLessThan(300);
    await inFlight((state) => state === "SETTLED", 120_000);
    await expect(page.getByTestId("W-TR-08.settled")).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(4000);
    await figure(page.getByTestId("W-TR-08.settled"), /7.*57/, "7 PayPal, 57 cash");
    await figure(page.getByTestId("W-TR-08.cashLabel"), "3,876.43", "57 cash");
    await stills.take("22b-fanout-settled", {
      state: "22",
      title: "Settled: 7 PayPal, 57 cash at the bodega",
      boxes: fanBoxes,
      crops: {
        fan: { of: "W-TR-08.fan" },
        settled: { of: "W-TR-08.settled", pad: 8, hi: true },
        share: { of: "W-TR-08.share", pad: 8, hi: true },
        threads: {
          from: (b) => {
            const fan = b["W-TR-08.fan"];
            const share = b["W-TR-08.share"];
            return fan && share
              ? [fan[0], share[1] + share[3] + 8, fan[2], fan[1] + fan[3] - share[1] - share[3] - 8]
              : null;
          },
        },
        counts: { of: "W-TR-08.status", pad: 8, hi: true },
        kept: { of: "W-TR-08.kept", pad: 8 },
        "cash-label": { of: "W-TR-08.cashLabel", pad: 8 },
      },
    });

    // ------------------------------------------------------------------- #27 Proof: idle, then 6 of 6 (or a fresh session)
    const chip = page.getByTestId("W-JG-01.proofChip");
    await expect(chip).toBeVisible({ timeout: 30_000 });
    await chip.click();
    await expect(page.getByTestId("W-PF-01")).toBeVisible({ timeout: 30_000 });
    const verify = page.getByTestId("W-PF-01.verify").getByRole("button", { name: /Verify in your browser/ });
    await expect(verify).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    const proofBoxes = [/^W-PF-01\.(verify|verdict|seal|checks|money|chain$|plate\.[a-zA-Z]+$|hero|title)/];
    await stills.take("27a-proof-idle", {
      state: "27",
      title: "Proof, before the check",
      boxes: proofBoxes,
      crops: {
        verify: { of: "W-PF-01.verify", pad: 8, hi: true },
        checks: { of: "W-PF-01.checks", pad: 8, hi: true },
        seal: { of: "W-PF-01.seal", pad: 8, hi: true },
      },
    });
    let verdictState = "";
    for (let attempt = 1; attempt <= 3 && verdictState !== "sample"; attempt++) {
      if (attempt > 1) {
        await page.waitForTimeout(8000);
        await page.reload();
        await booted();
        await expect(page.getByTestId("W-PF-01")).toBeVisible({ timeout: 30_000 });
        await page.waitForTimeout(2500);
      }
      await verify.scrollIntoViewIfNeeded();
      await click(verify);
      const verdict = page.getByTestId("W-PF-01.verdict");
      await expect(verdict).toHaveAttribute("data-state", /sample|mismatch|replay|matches/, {
        timeout: 60_000,
      });
      verdictState = (await verdict.getAttribute("data-state")) ?? "";
      if (verdictState !== "sample") notes.push(`proof: attempt ${attempt} read ${verdictState}`);
    }
    // FILM_STILLS_KEEP_MISMATCH=1 shoots the rest anyway, to look at (such a take never replaces the film's stills)
    const proofGood = verdictState === "sample";
    if (!proofGood && process.env.FILM_STILLS_KEEP_MISMATCH !== "1")
      throw new Error(`Proof read ${verdictState}, not 6 of 6, three times: this session is dropped`);
    await figure(page.getByTestId("W-PF-01.verdict"), /6\s*\/\s*6|6 of 6/, "Proof 6 of 6");
    await page.waitForTimeout(3000);
    await page
      .getByTestId("W-PF-01.checks")
      .evaluate((node) => node.scrollIntoView({ block: "center" }))
      .catch(() => undefined);
    await page.waitForTimeout(1200);
    const SAMPLE = drop("W-PF-01.verdict.sample");
    await stills.take("27b-proof-6-of-6", {
      state: "27",
      title: "Proof: 6 of 6 checks match",
      css: SAMPLE,
      note: "Shot with the verdict's 'Sample keys · not PayPal-verified' line hidden; the '-as-is' crops keep it. Never caption this 'Verified'.",
      boxes: proofBoxes,
      crops: {
        verdict: { of: "W-PF-01.verdict", pad: 8, hi: true },
        "verdict-count": { of: "W-PF-01.verdict.count", pad: 8, hi: true },
        checks: { of: "W-PF-01.checks", pad: 8, hi: true },
        seal: { of: "W-PF-01.seal", pad: 8, hi: true },
        stamps: { of: "W-PF-01.verdict.stamps", pad: 8, hi: true },
        money: { of: "W-PF-01.money", pad: 8, hi: true },
        hero: { of: "W-PF-01.hero" },
      },
    });
    await stills.take("27b-proof-6-of-6-as-is", {
      state: "27",
      title: "Proof: 6 of 6, with the product's own 'Sample keys' line",
      boxes: proofBoxes,
      crops: { verdict: { of: "W-PF-01.verdict", pad: 8, hi: true } },
    });
    await page
      .getByTestId("W-PF-01.money")
      .evaluate((node) => node.scrollIntoView({ block: "center" }))
      .catch(() => notes.push("proof: no money block"));
    await page.waitForTimeout(1500);
    await figure(page.getByTestId("W-PF-01.hero"), "4,333.50", "Proof invoice");
    await figure(page.getByTestId("W-PF-01.money"), "341.74", "Proof PayPal");
    await figure(page.getByTestId("W-PF-01.money"), "3,876.43", "Proof cash");
    await stills.take("27c-proof-where-every-dollar-went", {
      state: "27",
      title: "Proof: where every dollar went",
      css: SAMPLE,
      boxes: proofBoxes,
      crops: { money: { of: "W-PF-01.money", pad: 8, hi: true } },
    });

    // ------------------------------------------------------------------- #25 the slip behind a peso, on Proof
    const trace = async () => {
      const peso = page.getByTestId("W-PF-01.peso.M-014");
      if (!(await peso.isVisible().catch(() => false)))
        await page.getByTestId("W-PF-01.plate.computed.toggle").click();
      await peso.scrollIntoViewIfNeeded();
      await click(peso);
      await expect(page.getByTestId("W-PF-01.trace")).toBeVisible({ timeout: 15_000 });
      const centreTrace = () =>
        page.getByTestId("W-PF-01.trace").evaluate((node) => node.scrollIntoView({ block: "center" }));
      await centreTrace();
      await page.waitForTimeout(2500);
      const traceBoxes = [/^W-PF-01\.(trace|peso\.M-014)/];
      await stills.take("25b-proof-line-traced", {
        state: "25",
        title: "Proof: Nang Celing's line, its sum and its four slips",
        css: SAMPLE,
        boxes: traceBoxes,
        crops: {
          trace: { of: "W-PF-01.trace", pad: 6, hi: true },
          receipt: { of: "W-PF-01.trace.receipt", pad: 6, hi: true },
          line: { of: page.getByTestId("W-PF-01.peso.M-014").locator("xpath=ancestor::tr[1]"), hi: false },
        },
      });
      await click(page.getByTestId("W-PF-01.trace.slip.0403"));
      await expect(page.getByTestId("W-PF-01.trace.crop")).toBeVisible({ timeout: 15_000 });
      await centreTrace();
      await page.waitForTimeout(3000);
      const slipCrops = {
        trace: { of: "W-PF-01.trace", pad: 6, hi: true },
        slip: { of: "W-PF-01.trace.paper", hi: true },
        chips: { of: page.locator(".pf-trace__slips"), pad: 6, hi: true },
      } as const;
      await stills.take("25c-slip-0403-on-proof", {
        state: "25",
        title: "Proof: the line traced to slip 0403 (the net and payable boxes)",
        css: SAMPLE,
        note: "The receipt above the slip is dimmed by the product while the slip is open: use 'slip', or 25b for the receipt.",
        boxes: traceBoxes,
        crops: slipCrops,
      });
      // the same slip drawn whole: the product's own zoom-out control, as far as it goes
      const out = page.getByTestId("W-PF-01.trace.zoom-out");
      for (let i = 0; i < 5; i++) {
        await out.click();
        await page.waitForTimeout(450);
      }
      await centreTrace();
      await page.waitForTimeout(2000);
      await stills.take("25d-slip-0403-on-proof-wide", {
        state: "25",
        title: "Proof: slip 0403 zoomed out",
        css: SAMPLE,
        boxes: traceBoxes,
        crops: slipCrops,
      });
    };
    await trace().catch((error: unknown) => notes.push(`proof trace: ${String(error).slice(0, 200)}`));

    // ------------------------------------------------------------------- #20 approved by both (after the follow-up)
    await page.goto(`/runs/${run.runSlug}/approve`);
    await booted();
    await expect(page.getByTestId("W-TR-07.approved")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3000);
    await stills.take("20a-approved-by-both", {
      state: "20",
      title: "Approved by Analyn and Ernesto",
      boxes: approveBoxes,
      crops: {
        ...approveCrops,
        approved: { of: "W-TR-07.approved", pad: 8, hi: true },
      },
    });
    await page.getByTestId("W-JG-01.tab.chair").click();
    await page.waitForTimeout(2500);
    await stills.take("20b-approved-chair-phone", {
      state: "20",
      title: "Approved by both: the console, with the Chair's phone at rest",
      note: "The phone's 'Napirmahan' (signed) screen exists only in the seconds after key 2, while PayPal's events are in flight, so it is not shot; after the follow-up the phone reads 'nothing to sign now'.",
      boxes: approveBoxes,
      crops: {
        ...chairCrops,
        "seal-block": approveCrops["seal-block"],
        approved: { of: "W-TR-07.approved", pad: 8, hi: true },
        "console-and-phone": { of: ["W-TR-07.sealBlock", device], pad: 8 },
      },
    });

    // ------------------------------------------------------------------- #23 the member's phone: Bayad na
    await page.getByTestId("W-JG-01.tab.member").click();
    await expect(member.getByTestId("M-MB-01.capsule")).toContainText(/Bayad/, { timeout: 30_000 });
    await capture.refresh();
    await page.waitForTimeout(3000);
    const memberBoxes = [new RegExp(`^${M.replaceAll(".", "\\.")}>M-MB-0`), /^W-JG-01\.frame\./];
    const phoneCrops = { phone: { of: device, hi: true }, screen: { of: M, hi: true } } as const;
    await figure(member.getByTestId("M-MB-01.amount"), "64.45", "Nang Celing");
    const statement = async (id: string, lang: string) => {
      await member
        .getByTestId("M-MB-01.amountBlock")
        .evaluate((node) => node.scrollIntoView({ block: "center" }))
        .catch(() => undefined);
      await page.waitForTimeout(1200);
      await stills.take(id, {
        state: "23",
        title: `The member's statement, paid (${lang})`,
        boxes: memberBoxes,
        crops: {
          ...phoneCrops,
          "amount-block": { of: `${M}>M-MB-01.amountBlock`, pad: 6, hi: true },
          capsule: { of: `${M}>M-MB-01.capsule`, pad: 8, hi: true },
          paminawa: { of: `${M}>M-MB-01.paminawa`, pad: 8, hi: true },
          languages: { of: `${M}>M-MB-01.lang`, pad: 8, hi: true },
        },
      });
    };
    await statement("23a-member-bayad-na-ceb", "Cebuano");
    for (const [code, id, lang] of [
      ["en", "23b-member-paid-en", "English"],
      ["fil", "23c-member-bayad-na-fil", "Filipino"],
    ] as const) {
      const pick = member.getByTestId(`M-MB-01.lang.${code}`);
      if (!(await pick.count())) {
        notes.push(`member: no ${code} in the language picker`);
        continue;
      }
      await pick.scrollIntoViewIfNeeded();
      await click(pick);
      await expect(pick)
        .toHaveAttribute("aria-checked", "true", { timeout: 10_000 })
        .catch(() => undefined);
      await page.waitForTimeout(1500);
      await statement(id, lang);
    }
    const ceb = member.getByTestId("M-MB-01.lang.ceb");
    if (await ceb.count()) {
      await ceb.scrollIntoViewIfNeeded();
      await click(ceb);
      await page.waitForTimeout(1500);
    }
    // the receipt further down her statement
    await member
      .getByTestId("M-MB-01.receipt")
      .evaluate((node) => node.scrollIntoView({ block: "center" }))
      .catch(() => notes.push("member: no receipt"));
    await page.waitForTimeout(1500);
    await stills.take("23d-member-receipt", {
      state: "23",
      title: "Her statement: the receipt lines",
      boxes: memberBoxes,
      crops: { ...phoneCrops, receipt: { of: `${M}>M-MB-01.receipt`, pad: 6, hi: true } },
    });

    // ------------------------------------------------------------------- #24 tap a peso (MM-7)
    const net = member.getByTestId("M-MB-01.receipt.net.amount");
    await net.scrollIntoViewIfNeeded().catch(() => notes.push("member: net amount not scrolled"));
    await page.waitForTimeout(1200);
    await click(net);
    await expect(member.getByTestId("M-MB-01.trace.net.equation")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000);
    await member
      .getByTestId("M-MB-01.trace.net.equation")
      .evaluate((node) => node.scrollIntoView({ block: "center" }))
      .catch(() => undefined);
    await page.waitForTimeout(1200);
    await stills.take("24-tap-a-peso", {
      state: "24",
      title: "Tap a peso: 43.69 + 21.85 − 1.09 = US$64.45, and its four slips",
      boxes: memberBoxes,
      crops: {
        ...phoneCrops,
        equation: { of: `${M}>M-MB-01.trace.net.equation`, pad: 8, hi: true },
        slips: { of: `${M}>M-MB-01.trace.net.slips`, pad: 8, hi: true },
        trace: { of: [`${M}>M-MB-01.trace.net.equation`, `${M}>M-MB-01.trace.net.slips`], pad: 10, hi: true },
      },
    });

    // ------------------------------------------------------------------- #25 the slip behind it, on her phone
    const zoom = async () => {
      const slip = member.getByTestId("M-MB-01.slip.0403");
      await slip.scrollIntoViewIfNeeded();
      await click(slip);
      await expect(member.getByTestId("M-MB-01.zoom")).toHaveAttribute("data-state", "tiled", {
        timeout: 15_000,
      });
      await page.waitForTimeout(2500);
      await stills.take("25a-slip-0403-on-her-phone", {
        state: "25",
        title: "The slip behind the peso: 0403, on her phone",
        boxes: memberBoxes,
        crops: {
          ...phoneCrops,
          slip: { of: `${M}>M-MB-01.zoom.0403`, pad: 6, hi: true },
          "slip-to-net": {
            from: (b) => {
              const slip = b[`${M}>M-MB-01.zoom.0403`];
              return slip ? [slip[0], slip[1], slip[2], slip[3] * 0.885] : null;
            },
            hi: true,
            note: "Ends under the Net kg box: a hatched glyph overlaps the word Grade in the row below.",
          },
          total: { of: `${M}>M-MB-01.zoom.total`, pad: 8, hi: true },
          "slip-and-tray": {
            from: (b) => {
              const slip = b[`${M}>M-MB-01.zoom.0403`];
              const back = b[`${M}>M-MB-01.zoom.back`];
              const screen = b[M];
              return slip && back && screen
                ? [screen[0], slip[1] - 10, screen[2], back[1] + back[3] + 10 - (slip[1] - 10)]
                : null;
            },
            hi: true,
          },
          "phone-clear": {
            of: device,
            hi: true,
            css: '[data-testid="M-MB-01.zoom"] > div:first-child { opacity: 1 !important; }',
            note: "The product veils her statement behind the slip (it shows through, faded); here that veil is made solid so nothing ghosts.",
          },
        },
      });
      await member.getByTestId("M-MB-01.zoom.back").click();
      await expect(member.getByTestId("M-MB-01.zoom")).toBeHidden({ timeout: 10_000 });
    };
    await zoom().catch((error: unknown) => notes.push(`member zoom: ${String(error).slice(0, 200)}`));

    // ------------------------------------------------------------------- #26 listen (Paminawa, M-MB-03)
    const listen = async () => {
      const paminawa = member.getByTestId("M-MB-01.paminawa");
      await paminawa.scrollIntoViewIfNeeded();
      await click(paminawa);
      await expect(member.getByTestId("M-MB-03")).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(2000);
      const premium = member
        .locator('[data-testid^="M-MB-03.sentence."]')
        .filter({ hasText: /Premium/i })
        .first();
      await premium.scrollIntoViewIfNeeded().catch(() => notes.push("listening: premium row not scrolled"));
      await page.waitForTimeout(800);
      await click(premium);
      await expect(premium)
        .toHaveAttribute("data-state", "current", { timeout: 5000 })
        .catch(() => notes.push("listening: the premium row never read current"));
      await page.waitForTimeout(1500);
      await stills.take("26-listen", {
        state: "26",
        title: "Listen: her statement read aloud, the premium sentence current",
        boxes: [new RegExp(`^${M.replaceAll(".", "\\.")}>M-MB-03`), /^W-JG-01\.frame\./],
        crops: {
          ...phoneCrops,
          sentence: { of: premium, pad: 6, hi: true },
          player: { of: [`${M}>M-MB-03.play`, `${M}>M-MB-03.progress`], pad: 10, hi: true },
        },
      });
      await member
        .getByTestId("M-MB-03.close")
        .click()
        .catch(() => notes.push("listening: no close"));
    };
    await listen().catch((error: unknown) => notes.push(`listening: ${String(error).slice(0, 200)}`));

    // ------------------------------------------------------------------- #29 What's real, #28 Try to break it
    await page.goto(`/runs/${run.runSlug}/fanout`);
    await booted();
    await expect(page.getByTestId("W-JG-01.whatsRealOpen")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2500);
    await page.getByTestId("W-JG-01.whatsRealOpen").click();
    await expect(page.getByTestId("W-JG-01.whatsReal")).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(2000);
    await stills.take("29-whats-real", {
      state: "29",
      title: "What's real: the one disclosure, on product",
      note: "This sheet is the disclosure itself: its 'Simulated', 'Replayed' and 'Synthetic' rows are meant to be read.",
      boxes: [/^W-JG-01\.(whatsReal|tryToBreak|tamper)/],
      crops: {
        sheet: { of: "W-JG-01.whatsReal", hi: true },
        rows: { of: "W-JG-01.whatsReal.rows", pad: 6, hi: true },
      },
    });
    await page.getByTestId("W-JG-01.tryToBreak").scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    await stills.take("28a-try-to-break-it", {
      state: "28",
      title: "Try to break it: the three tampers",
      boxes: [/^W-JG-01\.(whatsReal|tryToBreak|tamper)/],
      crops: {
        sheet: { of: "W-JG-01.whatsReal", hi: true },
        tampers: { of: "W-JG-01.tampers", pad: 8, hi: true },
      },
    });
    const answer = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === `/v1/judge/sessions/${run.sessionId}/tamper` &&
        r.request().method() === "POST",
    );
    await click(page.getByTestId("W-JG-01.tamper.amount"));
    expect((await answer).status()).toBe(200);
    await page
      .getByTestId("W-JG-01.tamper.result")
      .scrollIntoViewIfNeeded()
      .catch(() => undefined);
    await page.waitForTimeout(2000);
    await stills.take("28b-try-to-break-it-refused", {
      state: "28",
      title: "Try to break it: the overcharge, refused by code",
      boxes: [/^W-JG-01\.(whatsReal|tryToBreak|tamper)/],
      crops: {
        sheet: { of: "W-JG-01.whatsReal", hi: true },
        tampers: { of: "W-JG-01.tampers", pad: 8, hi: true },
        result: { of: "W-JG-01.tamper.result", pad: 8, hi: true },
      },
    });
    phone = await page
      .getByTestId("W-JG-01.frame")
      .first()
      .evaluate((node) => {
        // the rounded case and the rounded screen inside it: the first box on each side that has a radius
        const radius = (from: Element | null, stop: Element | null) => {
          for (let el = from; el && el !== stop; el = el.parentElement) {
            const r = getComputedStyle(el).borderTopLeftRadius;
            if (r && r !== "0px") return r;
          }
          return "";
        };
        const screen = node.querySelector("iframe");
        const rounded = Array.from(node.querySelectorAll("*")).find(
          (el) => getComputedStyle(el).borderTopLeftRadius !== "0px",
        );
        return {
          deviceRadius: rounded ? getComputedStyle(rounded).borderTopLeftRadius : "",
          screenRadius: radius(screen, node),
        };
      })
      .catch(() => null);
    good = proofGood;
  } finally {
    stills.write({
      recordedAt: new Date(startedAt).toISOString(),
      complete: good,
      phone,
      run: s ? { slug: (s as JudgeSession).runSlug } : null,
      phases: capture.phases,
    });
    if (api && s) await stopBrowserJudge(page, api as Api, s as JudgeSession).catch(() => undefined);
  }
  // only a whole, good take replaces the film's stills
  expect(good, "Proof must read 6 of 6 for the take to be used").toBe(true);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  cpSync(TAKE, OUT, { recursive: true });
  writeFileSync(join(OUT, ".gitignore"), "*\n");
  process.stdout.write(`[film-stills] ${stills.entries.length} stills in ${OUT}\n`);
  if (notes.length) process.stdout.write(`[film-stills] notes:\n - ${notes.join("\n - ")}\n`);
});

/** A slip's paper cut from the product's own photo file at the file's own pixels (the page draws it smaller). */
const SOURCE_PAPERS = [
  {
    still: "07a-claude-reads-0403",
    like: "paper",
    name: "paper-source",
    file: join(HERE, "..", "..", ".codex-scratch", "e2e-stack", "media", "slips", "spike-0403.webp"),
    share: PAPER_0403,
    // the CSS size this crop had in the first take: scenes place marks on it by position, so it does not follow the
    // exhibit tile's size from one UI round to the next (the pixels are the file's own either way)
    css: { width: 297, height: 343 },
  },
] as const;

// Re-run alone, with no stack and no judge session, on the stills already in video/film2/stills/:
//   $env:E2E_BASE_URL = "http://127.0.0.1:9"; corepack pnpm exec playwright test -c e2e/film/stills.config.ts -g "contact sheet"
test("film stills: the source crops and the labelled contact sheet", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const manifest = JSON.parse(readFileSync(join(OUT, "stills.json"), "utf8")) as { stills: StillEntry[] };
  {
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    for (const want of SOURCE_PAPERS) {
      const entry = manifest.stills.find((s) => s.id === want.still);
      const like = entry?.crops.find((c) => c.name === want.like);
      if (!entry || !like || !existsSync(want.file)) {
        process.stdout.write(`[film-stills] no source crop ${want.still}.${want.name}\n`);
        continue;
      }
      const html = join(OUT, "..", `.source-${want.name}.html`);
      writeFileSync(
        html,
        `<!doctype html><body style="margin:0;background:#fff"><img id="i" src="${pathToFileURL(want.file).href}" style="display:block"></body>`,
      );
      await page.goto(pathToFileURL(html).href);
      const natural = await page.locator("#i").evaluate(async (img: HTMLImageElement) => {
        await img.decode();
        return { w: img.naturalWidth, h: img.naturalHeight };
      });
      rmSync(html, { force: true });
      // the same picture as the product's crop: its width from the paper's share, its height from that crop's shape
      const width = Math.round(natural.w * (want.share.x1 - want.share.x0));
      const height = Math.round((width * want.css.height) / want.css.width);
      const x = Math.round(natural.w * want.share.x0);
      const y = Math.round(natural.h * ((want.share.y0 + want.share.y1) / 2) - height / 2);
      await page.setViewportSize({ width: Math.max(natural.w, 800), height: Math.max(natural.h, 600) });
      const file = `${want.still}.${want.name}.png`;
      await page.screenshot({ path: join(OUT, file), clip: { x, y, width, height } });
      entry.crops = entry.crops.filter((c) => c.name !== want.name);
      entry.crops.push({
        name: want.name,
        file,
        box: { x: like.box.x, y: like.box.y, ...want.css },
        deviceScale: Math.round((width / want.css.width) * 1000) / 1000,
        px: { width, height },
        note: "Cut from the product's own photo file at the file's own pixels: the sharpest copy of this slip. Its scale is the file's pixels over the crop's CSS width.",
      });
    }
    await context.close();
    const whole = JSON.parse(readFileSync(join(OUT, "stills.json"), "utf8")) as { stills: StillEntry[] };
    whole.stills = manifest.stills;
    writeFileSync(join(OUT, "stills.json"), `${JSON.stringify(whole, null, 1)}\n`);
  }
  const work = join(HERE, "..", "film-out", "stills-sheet");
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const url = (file: string) => pathToFileURL(join(OUT, file)).href;
  // thumbnails first, one image a page, so the sheet never holds every 4K frame at once
  const cards: string[] = [];
  let n = 0;
  for (const still of manifest.stills) {
    const thumbs: { file: string; label: string; width: number }[] = [
      {
        file: still.file,
        label: `${still.px.width}×${still.px.height}`,
        width: Math.round(Math.min(320, (180 * still.css.width) / still.css.height)),
      },
    ];
    for (const crop of still.crops) {
      const best = crop.hi ?? crop;
      const ratio = crop.box.width / crop.box.height;
      const height = Math.min(180, 320 / ratio);
      thumbs.push({
        file: best.file,
        label: `${crop.name} ${best.px.width}×${best.px.height}${crop.flags ? " ⚑" : ""}`,
        width: Math.max(24, Math.round(height * ratio)),
      });
    }
    const cells: string[] = [];
    for (const t of thumbs) {
      const out = join(work, `t${String(n++).padStart(4, "0")}.png`);
      const html = join(work, "one.html");
      writeFileSync(
        html,
        `<!doctype html><body style="margin:0;background:#fff"><img id="i" src="${url(t.file)}" style="display:block;width:${t.width}px;height:auto"></body>`,
      );
      await page.goto(pathToFileURL(html).href);
      await page.locator("#i").evaluate((img: HTMLImageElement) => img.decode().catch(() => undefined));
      await page.locator("#i").screenshot({ path: out });
      cells.push(
        `<figure><img src="${pathToFileURL(out).href}"><figcaption>${t.label.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</figcaption></figure>`,
      );
    }
    cards.push(
      `<section><h2>${still.id} <small>#${still.state} · ${still.title.replace(/&/g, "&amp;").replace(/</g, "&lt;")}${still.flags.length ? ` · ⚑ ${still.flags.length} disclaimer words left in the full frame` : ""}</small></h2><div class="row">${cells.join("")}</div></section>`,
    );
  }
  const sheet = join(work, "sheet.html");
  writeFileSync(
    sheet,
    `<!doctype html><meta charset="utf-8"><style>
body{margin:0;padding:24px;background:#F7F8FB;color:#0E1525;font:13px/1.3 system-ui,sans-serif;width:2512px}
.cols{columns:2;column-gap:14px}section{break-inside:avoid}
h1{font-size:22px;margin:0 0 4px}p{margin:0 0 16px;color:#5B6475}
section{margin:0 0 14px;padding:10px 12px;background:#fff;border:1px solid #D9DEE7;border-radius:8px}
h2{font-size:15px;margin:0 0 8px}h2 small{font-weight:400;color:#5B6475}
.row{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-start}
figure{margin:0}figure img{display:block;border:1px solid #D9DEE7;max-height:180px}
figcaption{font:11px ui-monospace,monospace;color:#5B6475;margin-top:2px;max-width:320px}
</style><h1>Fair Split film v7: product stills (${manifest.stills.length} states)</h1>
<p>Full frames 3840×2160 (1920×1080 CSS, scale ${SCALE}); crops shown from their scale-${HI_SCALE} copy where one exists (pixel size in the label). ⚑ = a disclaimer word is inside that crop. Files: video/film2/stills/, boxes in stills.json.</p>
<div class="cols">${cards.join("\n")}</div>`,
  );
  await page.goto(pathToFileURL(sheet).href);
  await page.waitForLoadState("load");
  mkdirSync(join(SHEET, ".."), { recursive: true });
  await page.screenshot({ path: SHEET, fullPage: true });
  await context.close();
  expect(existsSync(SHEET)).toBe(true);
  process.stdout.write(`[film-stills] contact sheet: ${SHEET}\n`);
});
