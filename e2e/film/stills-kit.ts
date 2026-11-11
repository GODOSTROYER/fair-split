// The stills take's kit (film v7): sharp still images of real product states, for the film's product windows.
// One page at 1920 × 1080 CSS, device scale 2 (3840 × 2160 full frames); tight crops of the named elements at the
// same scale, and again at FILM_HI_SCALE (4 by default) for the elements a film shows large (the phones, the slips,
// the seal), by raising the page's own device scale for the shot. Nothing is enlarged after the fact.
//
// Honesty: test injection only. The product is driven the way a judge drives it and no time, state, response or
// figure changes. The film says "simulated" once, at its end (owner's direction, 11 Nov 2026), so the product's
// own labels of that kind are hidden *in the stills* by FILM_STYLE; every one left in a frame is listed in
// stills.json under `flags`, with its box, so a builder can crop around it. Nothing ships in the console or the app.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CDPSession, Locator, Page } from "@playwright/test";

export const VIEW = { width: 1920, height: 1080 };
export const SCALE = 2;
export const HI_SCALE = Number(process.env.FILM_HI_SCALE ?? 4);
/** A crop no wider than this (CSS px) is also shot at HI_SCALE; a wider one already has the pixels at scale 2. */
const HI_MAX_WIDTH = 1000;

/** The marks the film hides (product-states.md §3), the capture's own helpers, and the scrims. */
export const FILM_STYLE = `
[data-testid="W-JG-01.notice"], [data-testid="W-PF-01.rail"], [data-fs-tag="micro"],
[data-testid="M-MB-01.when"] ~ *, .fsc-screen__meta,
[data-testid="W-TR-08.fees"], [data-testid="W-PF-01.plate.paid.fact"],
[data-testid="W-JG-01.toast"], .fsc-dock__scrim-label,
[data-testid="M-MB-01.voice"], [data-testid="M-MB-03.voice"], [data-fs-glyph], [data-fs-film-hide],
[data-fs-film-keeper], [data-fs-film-touch], [data-fs-film-cursor], [data-fs-film-wait] { display: none !important; }
.fsc-drawer-scrim, .fsc-sheet__scrim, .fsc-dock__backdrop { opacity: 0 !important; }
* { caret-color: transparent !important; }
`;

/**
 * A whole line of provenance the product writes beside a figure (not a tag with a selector of its own): the element
 * whose entire text is one of these is marked `data-fs-film-hide` before each still, and FILM_STYLE hides it.
 */
const HIDE_LINES = [
  "^Seed stand-in, not a Claude recording\\.?$",
  // the phone's slip zoom, under a drawn slip: "This is a sample. The real photo is still to come." (ceb, fil, en)
  "^Sample pa ni\\.",
  "^Sample pa (lang )?ito\\.",
  "^This is (still )?a sample\\.",
];

/**
 * Runs in every document (the page and the phone frames) before its scripts: the film's style, as a constructed
 * sheet the document adopts. The phone's app hydrates its whole document and would drop a style element put there.
 */
export function installFilmStyle(css: string) {
  const host = window as typeof window & { __fsFilmSheets?: Record<string, CSSStyleSheet> };
  const held = host.__fsFilmSheets?.base;
  if (held && document.adoptedStyleSheets.includes(held)) return;
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  host.__fsFilmSheets = { ...host.__fsFilmSheets, base: sheet };
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}

/** Sets (or, with no css, clears) one keyed extra sheet in this document. */
function setSheet({ css, key }: { css: string | undefined; key: string }) {
  const host = window as typeof window & { __fsFilmSheets?: Record<string, CSSStyleSheet> };
  host.__fsFilmSheets ??= {};
  let sheet = host.__fsFilmSheets[key];
  if (!sheet || !document.adoptedStyleSheets.includes(sheet)) {
    sheet = new CSSStyleSheet();
    host.__fsFilmSheets[key] = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }
  sheet.replaceSync(css ?? "");
}

/** Marks the provenance lines (HIDE_LINES) in this document. */
function markLines(patterns: string[]) {
  const tests = patterns.map((p) => new RegExp(p, "i"));
  const texts = document.createTreeWalker(document.body ?? document.documentElement, NodeFilter.SHOW_TEXT);
  for (let node = texts.nextNode(); node; node = texts.nextNode()) {
    const text = (node.textContent ?? "").trim();
    if (!text || !tests.some((t) => t.test(text))) continue;
    let el = node.parentElement;
    if (!el || el.closest(".fs-sr, script, style")) continue;
    // the line, with its glyph: the widest ancestor that says nothing else
    while (el.parentElement && (el.parentElement.textContent ?? "").trim() === text) el = el.parentElement;
    el.setAttribute("data-fs-film-hide", "");
  }
}

export type Rect = [number, number, number, number];

/**
 * Every visible [data-testid] box in the page and its same-origin phone frames, in top-page CSS pixels, with the
 * disclaimer words still on screen. A phone frame's ids carry its frame's id as a prefix (`W-JG-01.frame.member>…`).
 */
function measure(view: { width: number; height: number }) {
  const boxes: Record<string, [number, number, number, number]> = {};
  const flags: { text: string; box: [number, number, number, number] }[] = [];
  const words =
    /simulat|synthetic|sintetik|sample|stand-in|replay|seed|not paypal|provisional|ai-generated|demo|sandbox|gisundog|kunwari/i;
  const round = (v: number) => Math.round(v * 10) / 10;
  const walk = (
    doc: Document,
    dx: number,
    dy: number,
    prefix: string,
    port: { x: number; y: number; r: number; b: number },
  ) => {
    const inPort = (r: { x: number; y: number; width: number; height: number }) => {
      const x = Math.max(r.x + dx, port.x);
      const y = Math.max(r.y + dy, port.y);
      const right = Math.min(r.x + dx + r.width, port.r);
      const bottom = Math.min(r.y + dy + r.height, port.b);
      return right - x >= 1 && bottom - y >= 1
        ? ([x, y, right - x, bottom - y].map(round) as [number, number, number, number])
        : null;
    };
    const shown = (el: Element) =>
      (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility?.({
        checkOpacity: true,
        checkVisibilityCSS: true,
      }) ?? true;
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>("[data-testid]"))) {
      const id = `${prefix}${el.dataset.testid}`;
      if (id in boxes || !shown(el)) continue;
      const box = inPort(el.getBoundingClientRect());
      if (box) boxes[id] = box;
    }
    const texts = doc.createTreeWalker(doc.body ?? doc.documentElement, NodeFilter.SHOW_TEXT);
    for (let node = texts.nextNode(); node; node = texts.nextNode()) {
      const text = (node.textContent ?? "").trim();
      const parent = node.parentElement;
      if (!text || !parent || !words.test(text) || !shown(parent)) continue;
      if (parent.closest("script, style, noscript, .fs-sr, [hidden]")) continue;
      const range = doc.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      // a screen-reader-only run is clipped to a pixel
      if (r.width < 4 || r.height < 4) continue;
      const clip = parent.closest<HTMLElement>("[class*='sr'], [class*='visually']");
      if (clip && clip.getBoundingClientRect().width < 4) continue;
      const box = inPort(r);
      if (box) flags.push({ text: `${prefix}${text.slice(0, 120)}`, box });
    }
    for (const frame of Array.from(doc.querySelectorAll<HTMLIFrameElement>("iframe"))) {
      const r = frame.getBoundingClientRect();
      const test = frame.dataset.testid;
      if (!test || r.width < 1 || !shown(frame)) continue;
      const inner = inPort(r);
      if (!inner) continue;
      // a phone panel behind the one on show (kept mounted) is not on screen
      if (doc.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) !== frame) continue;
      try {
        if (frame.contentDocument)
          walk(frame.contentDocument, dx + r.x, dy + r.y, `${test}>`, {
            x: inner[0],
            y: inner[1],
            r: inner[0] + inner[2],
            b: inner[1] + inner[3],
          });
      } catch {
        // a cross-origin frame has nothing to measure
      }
    }
  };
  walk(document, 0, 0, "", { x: 0, y: 0, r: view.width, b: view.height });
  return { boxes, flags, scrollY: window.scrollY };
}

export type CropOf = string | Locator | readonly (string | Locator)[];
export interface CropSpec {
  /** Test ids (as in `boxes`; a phone's carry `frame>`) or locators; several make one box around them all. */
  of?: CropOf;
  /** Or a box worked out from the measured boxes (x, y, width, height in CSS px); null when it cannot be. */
  from?: (boxes: Record<string, Rect>) => Rect | null | Promise<Rect | null>;
  /** CSS px added around the box (default 0). */
  pad?: number;
  /** Extra CSS for this one crop only (a variant), on top of the still's own. */
  css?: string;
  /** Force or forbid the high-scale copy (default: by width). */
  hi?: boolean;
  /** Only the high-scale copy matters: skip nothing, but say so in the manifest. */
  note?: string;
}
export interface StillSpec {
  /** product-states.md's number for the state. */
  state: string;
  title: string;
  /** Extra CSS while this still is taken (measured with it, shot with it, removed after). */
  css?: string;
  /** Test ids (exact, or a RegExp) whose boxes go to stills.json besides the crops' own. */
  boxes?: readonly (string | RegExp)[];
  crops?: Record<string, CropSpec | CropOf>;
  /** Wait before the shot, after the pointer has left and focus is dropped (default 600 ms). */
  settle?: number;
  /** Keep the focused element focused (a field that must keep its value); the caret is hidden anyway. */
  keepFocus?: boolean;
  note?: string;
}
export interface CropEntry {
  name: string;
  file: string;
  /** CSS px in the full frame. */
  box: { x: number; y: number; width: number; height: number };
  deviceScale: number;
  /** Pixel size of the PNG. */
  px: { width: number; height: number };
  /** The same crop at the high scale, if shot. */
  hi?: { file: string; deviceScale: number; px: { width: number; height: number } };
  /** Disclaimer words inside this crop (after the film's style): crop around them. */
  flags?: string[];
  variant?: true;
  note?: string;
}
export interface StillEntry {
  id: string;
  state: string;
  title: string;
  file: string;
  css: { width: number; height: number };
  deviceScale: number;
  px: { width: number; height: number };
  route: string;
  scrollY: number;
  takenAt: string;
  boxes: Record<string, { x: number; y: number; width: number; height: number }>;
  crops: CropEntry[];
  flags: { text: string; box: { x: number; y: number; width: number; height: number } }[];
  note?: string;
}

const asBox = (r: Rect) => ({ x: r[0], y: r[1], width: r[2], height: r[3] });

export class Stills {
  readonly entries: StillEntry[] = [];
  /** Every visible test id's box for each still (the manifest keeps the named ones only). */
  readonly allBoxes: Record<string, Record<string, Rect>> = {};
  readonly notes: string[] = [];
  private cdp: CDPSession | null = null;

  constructor(
    private readonly page: Page,
    readonly out: string,
  ) {
    mkdirSync(out, { recursive: true });
  }

  /**
   * A crop at the high scale: Chromium rasters the clip again at `scale` times the page's device scale (the same
   * pixels as a page at that device scale, checked byte for byte), so nothing is enlarged and the page keeps its
   * layout. Playwright's own screenshot always answers at the context's scale, so this one goes through CDP.
   */
  private async shootHi(path: string, clip: { x: number; y: number; width: number; height: number }) {
    if (!this.cdp) {
      this.cdp = await this.page.context().newCDPSession(this.page);
      // a clip's scale multiplies the device scale this session itself asked for (1 until it asks): ask for the
      // page's own, which changes nothing on the page
      await this.cdp.send("Emulation.setDeviceMetricsOverride", {
        width: VIEW.width,
        height: VIEW.height,
        deviceScaleFactor: SCALE,
        mobile: false,
      });
      await this.page.waitForTimeout(400);
    }
    // CDP clips from the document's corner, Playwright's from the viewport's
    const { cssVisualViewport: port } = await this.cdp.send("Page.getLayoutMetrics");
    const shot = await this.cdp.send("Page.captureScreenshot", {
      format: "png",
      clip: { ...clip, x: clip.x + port.pageX, y: clip.y + port.pageY, scale: HI_SCALE / SCALE },
      captureBeyondViewport: false,
    });
    const png = Buffer.from(shot.data, "base64");
    const width = png.readUInt32BE(16);
    const height = png.readUInt32BE(20);
    if (Math.abs(width - clip.width * HI_SCALE) > 2 || Math.abs(height - clip.height * HI_SCALE) > 2)
      throw new Error(
        `${path}: the high-scale crop came back ${width} × ${height}, not ${clip.width * HI_SCALE} × ${clip.height * HI_SCALE}`,
      );
    writeFileSync(path, png);
  }

  /** Extra CSS in the page and every phone frame under `key` until it is cleared (no css). */
  async style(css: string | undefined, key: string) {
    for (const frame of this.page.frames())
      await frame.evaluate(setSheet, { css, key }).catch(() => undefined);
    await this.page.evaluate(
      () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(null)))),
    );
  }

  private async rectOf(of: CropOf, boxes: Record<string, Rect>, what: string): Promise<Rect | null> {
    const parts = Array.isArray(of) ? of : [of];
    let x = Number.POSITIVE_INFINITY;
    let y = Number.POSITIVE_INFINITY;
    let r = Number.NEGATIVE_INFINITY;
    let b = Number.NEGATIVE_INFINITY;
    for (const part of parts as readonly (string | Locator)[]) {
      let rect: Rect | null = null;
      if (typeof part === "string") rect = boxes[part] ?? null;
      else {
        const box = await part
          .first()
          .boundingBox({ timeout: 2000 })
          .catch(() => null);
        if (box) rect = [box.x, box.y, box.width, box.height];
      }
      if (!rect) {
        this.notes.push(`${what}: nothing on screen for ${typeof part === "string" ? part : String(part)}`);
        continue;
      }
      x = Math.min(x, rect[0]);
      y = Math.min(y, rect[1]);
      r = Math.max(r, rect[0] + rect[2]);
      b = Math.max(b, rect[1] + rect[3]);
    }
    return Number.isFinite(x) ? [x, y, r - x, b - y] : null;
  }

  /** One still: the full frame, then every named crop (and its high-scale copy). */
  async take(id: string, spec: StillSpec): Promise<StillEntry> {
    const { page } = this;
    // a phone frame's document can be replaced after the init script ran (the app boots into it): adopt again
    for (const frame of page.frames())
      await frame.evaluate(installFilmStyle, FILM_STYLE).catch(() => undefined);
    for (const frame of page.frames()) await frame.evaluate(markLines, HIDE_LINES).catch(() => undefined);
    await page.mouse.move(VIEW.width - 1, VIEW.height - 1, { steps: 4 });
    if (!spec.keepFocus) {
      for (const frame of page.frames())
        await frame
          .evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
          .catch(() => undefined);
    }
    for (const frame of page.frames())
      await frame.evaluate(() => document.fonts?.ready).catch(() => undefined);
    await page.waitForTimeout(spec.settle ?? 600);
    for (const frame of page.frames()) await frame.evaluate(markLines, HIDE_LINES).catch(() => undefined);
    await this.style(spec.css, "still");
    try {
      const m = await page.evaluate(measure, VIEW);
      this.allBoxes[id] = m.boxes;
      const file = `${id}.png`;
      await page.screenshot({
        path: join(this.out, file),
        caret: "hide",
        animations: "allow",
        scale: "device",
      });
      const entry: StillEntry = {
        id,
        state: spec.state,
        title: spec.title,
        file,
        css: { ...VIEW },
        deviceScale: SCALE,
        px: { width: VIEW.width * SCALE, height: VIEW.height * SCALE },
        route: new URL(page.url()).pathname + new URL(page.url()).search,
        scrollY: m.scrollY,
        takenAt: new Date().toISOString(),
        boxes: {},
        crops: [],
        flags: m.flags.map((f) => ({ text: f.text, box: asBox(f.box) })),
        ...(spec.note ? { note: spec.note } : {}),
      };
      for (const want of spec.boxes ?? []) {
        for (const [key, rect] of Object.entries(m.boxes)) {
          if (typeof want === "string" ? key === want || key.endsWith(`>${want}`) : want.test(key))
            entry.boxes[key] = asBox(rect);
        }
      }
      // the crops: first all at scale 2, then all at the high scale (one change of scale per still)
      const plans: { name: string; spec: CropSpec; clip: StillEntry["boxes"][string]; crop: CropEntry }[] =
        [];
      for (const [name, raw] of Object.entries(spec.crops ?? {})) {
        const c: CropSpec =
          typeof raw === "string" ||
          Array.isArray(raw) ||
          !("of" in (raw as object) || "from" in (raw as object))
            ? { of: raw as CropOf }
            : (raw as CropSpec);
        if (c.css) await this.style(c.css, "crop");
        const boxes = c.css ? (await page.evaluate(measure, VIEW)).boxes : m.boxes;
        const rect = c.from
          ? await c.from(boxes)
          : c.of
            ? await this.rectOf(c.of, boxes, `${id}.${name}`)
            : null;
        if (c.from && !rect) this.notes.push(`${id}.${name}: its box could not be worked out`);
        if (!rect) {
          if (c.css) await this.style(undefined, "crop");
          continue;
        }
        const pad = c.pad ?? 0;
        const x = Math.max(0, Math.floor(rect[0] - pad));
        const y = Math.max(0, Math.floor(rect[1] - pad));
        const right = Math.min(VIEW.width, Math.ceil(rect[0] + rect[2] + pad));
        const bottom = Math.min(VIEW.height, Math.ceil(rect[1] + rect[3] + pad));
        const clip = { x, y, width: right - x, height: bottom - y };
        if (clip.width < 2 || clip.height < 2) {
          this.notes.push(`${id}.${name}: off screen`);
          if (c.css) await this.style(undefined, "crop");
          continue;
        }
        const cropFile = `${id}.${name}.png`;
        await page.screenshot({ path: join(this.out, cropFile), clip, caret: "hide", animations: "allow" });
        const inside = m.flags
          .filter(
            (f) =>
              !c.css &&
              f.box[0] < clip.x + clip.width &&
              f.box[0] + f.box[2] > clip.x &&
              f.box[1] < clip.y + clip.height &&
              f.box[1] + f.box[3] > clip.y,
          )
          .map((f) => f.text);
        const crop: CropEntry = {
          name,
          file: cropFile,
          box: clip,
          deviceScale: SCALE,
          px: { width: clip.width * SCALE, height: clip.height * SCALE },
          ...(inside.length ? { flags: inside } : {}),
          ...(c.css ? { variant: true as const } : {}),
          ...(c.note ? { note: c.note } : {}),
        };
        if (c.css) await this.style(undefined, "crop");
        entry.crops.push(crop);
        entry.boxes[`crop:${name}`] = clip;
        plans.push({ name, spec: c, clip, crop });
      }
      const hi = plans.filter((p) => p.spec.hi ?? p.clip.width <= HI_MAX_WIDTH);
      if (HI_SCALE > SCALE && hi.length > 0) {
        for (const p of hi) {
          if (p.spec.css) await this.style(p.spec.css, "crop");
          const hiFile = `${id}.${p.name}@${HI_SCALE}x.png`;
          await this.shootHi(join(this.out, hiFile), p.clip);
          p.crop.hi = {
            file: hiFile,
            deviceScale: HI_SCALE,
            px: { width: p.clip.width * HI_SCALE, height: p.clip.height * HI_SCALE },
          };
          if (p.spec.css) await this.style(undefined, "crop");
        }
      }
      this.entries.push(entry);
      process.stdout.write(
        `[film-stills] ${id}: ${entry.crops.length} crops${entry.flags.length ? `, ${entry.flags.length} flagged words in frame` : ""}\n`,
      );
      return entry;
    } finally {
      await this.style(undefined, "still");
    }
  }

  /** stills.json (the shape is described in its own `shape` field) and the full box dump beside it. */
  write(meta: Record<string, unknown>) {
    const manifest = {
      version: 1,
      shape:
        "stills[]: { id, state (product-states.md #), title, file, css {width,height}, deviceScale, px, route, scrollY, boxes { testId: {x,y,width,height} in CSS px of the full frame; a phone's ids are 'W-JG-01.frame.<persona>>id'; 'crop:<name>' is a crop's own box }, crops[] { name, file, box (CSS px in the full frame), deviceScale, px, hi? { file, deviceScale, px }, flags? (disclaimer words inside it), variant? (shot with extra CSS), note? }, flags[] (disclaimer words left in the full frame, with boxes) }",
      ...meta,
      css: { ...VIEW },
      deviceScale: SCALE,
      hiScale: HI_SCALE,
      stills: this.entries,
      notes: this.notes,
    };
    writeFileSync(join(this.out, "stills.json"), `${JSON.stringify(manifest, null, 1)}\n`);
    writeFileSync(join(this.out, "stills.boxes-all.json"), `${JSON.stringify(this.allBoxes)}\n`);
  }
}
