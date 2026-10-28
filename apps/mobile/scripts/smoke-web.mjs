// Smoke walk of the web export: every app route of register §4 (and the web entry points) opened in Chromium at phone
// size, each checked for its screen root (`data-testid` = register ID), a settled `data-state`, and no page or console
// errors. The walk runs once per language (Cebuano and Filipino by default): every surface must show the
// "Machine-translated, pending native review" chip exactly once in ceb and fil (OD-2, S1.6) and none in en. Routes
// that show money are opened again at 200% zoom (a 206 px window, design §8 "Web reflows at 200%"): no amount may be
// clipped or push the page sideways. Run `pnpm build` first. Local verification only; it starts serve-web.mjs on its
// own port and stops it.
//
// Usage: node scripts/smoke-web.mjs [--port 8099] [--shots <dir>] [--only <substring>] [--langs ceb,fil,en]
// Playwright is not a dependency of this app: the walk uses `playwright-core` (or `playwright`, `@playwright/test`)
// when installed, or the folder named by PLAYWRIGHT_CORE (a playwright-core package with its Chromium installed).
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const port = Number(arg("port", process.env.SMOKE_PORT || 8099));
const shots = arg("shots", null);
const only = arg("only", null);
const langs = arg("langs", "ceb,fil")
  .split(",")
  .map((l) => l.trim())
  .filter(Boolean);
const origin = `http://localhost:${port}`;
const VIEWPORT = { width: 412, height: 915 };
/** 200% zoom of the phone frame: the same CSS layout as a 412 px window zoomed to 200%. */
const ZOOMED = { width: 206, height: 458 };
/** The chip's words are the same in every language (`common.machineTranslated`), so a judge reads them on camera. */
const CHIP = "Machine-translated, pending native review";

function loadChromium() {
  const require = createRequire(import.meta.url);
  const tried = [];
  for (const id of [process.env.PLAYWRIGHT_CORE, "playwright-core", "playwright", "@playwright/test"]) {
    if (!id) continue;
    try {
      const m = require(id);
      if (m?.chromium) return m.chromium;
    } catch (e) {
      tried.push(`${id}: ${e.code ?? e.message}`);
    }
  }
  throw new Error(
    `Playwright not found (set PLAYWRIGHT_CORE to a playwright-core folder).\n  ${tried.join("\n  ")}`,
  );
}

/** A member link token in the shim's shape (`base64url(JCS{exp,lineId}).base64url(sig)`); demo data never checks it. */
function memberToken() {
  const b64 = (buf) => Buffer.from(buf).toString("base64url");
  const body = b64(JSON.stringify({ exp: "2027-01-01T00:00:00Z", lineId: "line_2026A_r37_M-014" }));
  return `${body}.${b64(new Uint8Array(64).fill(7))}`;
}
const token = memberToken();

/**
 * The walk. `id` is the screen root's register ID; `states` (when given) lists the settled `data-state`s accepted;
 * `path` checks where the app ended up (redirects); `shot` names the screenshot.
 */
const ROUTES = [
  // First run (a fresh browser: nothing stored, no demo flag).
  {
    name: "front door → first run",
    url: "/app/",
    id: "M-ON-01",
    states: ["language"],
    path: /\/app\/onboarding\/language$/,
    shot: "M-ON-01.png",
  },
  {
    name: "onboarding: theme (Klaro ba?)",
    url: "/app/onboarding/theme",
    id: "M-ON-01",
    states: ["theme"],
    zoom: true,
    shot: "more/M-ON-01.theme.png",
  },
  {
    name: "onboarding: pair",
    url: "/app/onboarding/pair",
    id: "M-ON-01",
    states: ["idle", "camera-denied"],
    shot: "more/M-ON-01.pair.png",
  },
  {
    name: "pairing QR link (token leaves the address bar)",
    url: "/app/pair?t=fsp_smoke_not_a_real_token",
    id: "M-ON-01",
    states: ["invalid", "error", "pairing", "expired", "used"],
    noQuery: "t",
  },
  {
    // A phone already paired (the demo board phone) never claims a link by itself: it asks, and nothing is claimed.
    name: "pairing link on a paired phone asks before replacing the pairing",
    url: "/app/pair?t=fsp_smoke_not_a_real_token&demo=board",
    id: "M-ON-01",
    states: ["idle"],
    visible: "M-ON-01.replace",
    noQuery: "t",
    shot: "more/M-ON-01.replace.png",
  },
  // Member (demo data).
  {
    name: "front door → member home, flags carried",
    url: "/app/?demo=member&stage=sent&motion=reduced",
    id: "M-MB-01",
    states: ["sent"],
    path: /\/app\/bayad$/,
    query: { demo: "member", stage: "sent", motion: "reduced" },
  },
  {
    name: "M-MB-01 Bayad: checking",
    url: "/app/bayad?demo=member&stage=checking",
    id: "M-MB-01",
    states: ["checking"],
  },
  {
    // /bayad and /pangutana are shared by the member and board tabs: the flags must survive the role's redirect.
    name: "M-MB-01 Bayad: held line preview, flags kept on the shared /bayad",
    url: "/app/bayad?demo=member&stage=sent&line=HELD",
    id: "M-MB-01",
    states: ["held-line"],
    path: /\/app\/bayad$/,
    query: { demo: "member", stage: "sent", line: "HELD" },
  },
  {
    name: "M-MB-04 Pangutana: flags kept on the shared /pangutana",
    url: "/app/pangutana?demo=member&stage=paid",
    id: "M-MB-04",
    path: /\/app\/pangutana$/,
    query: { demo: "member", stage: "paid" },
  },
  {
    name: "M-MB-01 Bayad: sent (MM-1 cold open)",
    zoom: true,
    url: "/app/bayad?demo=member&stage=sent",
    id: "M-MB-01",
    states: ["sent"],
    shot: "M-MB-01.png",
  },
  {
    name: "M-MB-01 Bayad: paid",
    zoom: true,
    url: "/app/bayad?demo=member&stage=paid",
    id: "M-MB-01",
    states: ["paid"],
    shot: "more/M-MB-01.paid.png",
  },
  {
    name: "M-MB-01 Bayad: unclaimed",
    url: "/app/bayad?demo=member&stage=unclaimed",
    id: "M-MB-01",
    states: ["unclaimed"],
  },
  {
    name: "M-MB-01 Bayad: cash due (₱ amount)",
    zoom: true,
    url: "/app/bayad?demo=member&stage=cash-due",
    id: "M-MB-01",
    states: ["cash-due"],
    shot: "more/M-MB-01.cash-due.png",
  },
  {
    name: "M-MB-01 Bayad: cash received",
    url: "/app/bayad?demo=member&stage=cash-received",
    id: "M-MB-01",
    states: ["cash-received"],
  },
  {
    name: "M-MB-02 Resibo",
    url: "/app/resibo?demo=member&stage=sent",
    id: "M-MB-02",
    states: ["list"],
    shot: "M-MB-02.png",
  },
  {
    name: "M-MB-03 Paminawa (modal)",
    url: "/app/paminawa?demo=member&stage=sent",
    id: "M-MB-03",
    shot: "more/M-MB-03.png",
  },
  {
    name: "M-MB-04 Pangutana",
    url: "/app/pangutana?demo=member&stage=sent",
    id: "M-MB-04",
    states: ["none"],
    shot: "more/M-MB-04.png",
  },
  {
    name: "member link /app/s/:token (dot in the token)",
    url: `/app/s/${token}`,
    id: "M-MB-01",
    states: ["sent", "checking", "paid"],
  },
  {
    name: "member short link /s/:token → /app/s/:token",
    url: `/s/${token}`,
    id: "M-MB-01",
    path: /^\/app\/s\//,
    states: ["sent", "checking", "paid"],
  },
  { name: "member link, broken token", url: "/app/s/not-a-token", id: "M-MB-01", states: ["link-invalid"] },
  // Clerk (demo data).
  { name: "front door → clerk home", url: "/app/?demo=clerk", id: "M-CL-01", path: /\/app\/scan$/ },
  {
    name: "M-CL-01 Scan",
    url: "/app/scan?demo=clerk&stage=cash-due",
    id: "M-CL-01",
    states: ["ready"],
    shot: "M-CL-01.png",
  },
  {
    name: "M-CL-01 Outbox tab",
    url: "/app/outbox?demo=clerk",
    id: "M-CL-02",
    states: ["empty", "online"],
    shot: "more/M-CL-02.outbox.png",
  },
  // Board (demo data).
  {
    name: "front door → board Pirma tab → open request",
    url: "/app/?demo=board",
    id: "M-BD-01",
    states: ["request"],
    path: /\/app\/pirma\/2026A-r37$/,
    query: { demo: "board" },
  },
  {
    name: "M-BD-01 co-sign request",
    zoom: true,
    url: "/app/pirma/2026A-r37?demo=board",
    id: "M-BD-01",
    states: ["request"],
    shot: "M-BD-01.png",
  },
  {
    name: "M-BD-02 sign",
    zoom: true,
    url: "/app/pirma/2026A-r37/sign?demo=board",
    id: "M-BD-02",
    states: ["ready"],
    shot: "M-BD-02.png",
  },
  {
    name: "board Bayad tab (run summary)",
    zoom: true,
    url: "/app/bayad?demo=board",
    id: "M-MB-01",
    states: ["run-summary"],
    shot: "more/M-MB-01.board.png",
  },
  { name: "board Pangutana tab", url: "/app/pangutana?demo=board", id: "M-MB-04" },
];

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${origin}/app/`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`serve-web did not answer on ${origin}`);
}

/**
 * Every amount on the page (`data-amount-state`) at the current size: a drawn figure (SVG text) must end inside its
 * SVG, and no amount may reach past the window. Returns what is clipped, in words.
 */
async function clippedAmounts(page) {
  return page.evaluate(() => {
    const out = [];
    const vw = window.innerWidth;
    for (const el of document.querySelectorAll("[data-amount-state]")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 && box.height === 0) continue;
      const id = el.getAttribute("data-testid") ?? el.getAttribute("data-amount-state");
      if (box.right > vw + 0.5) out.push(`${id} reaches past the window (${box.right.toFixed(1)} > ${vw})`);
      for (const svg of el.querySelectorAll("svg")) {
        const text = svg.querySelector("text");
        if (!text) continue;
        const s = svg.getBoundingClientRect();
        const t = text.getBoundingClientRect();
        if (t.width === 0) out.push(`${id}: the figure has no width`);
        if (t.right > s.right + 0.5 || t.left < s.left - 0.5) {
          out.push(
            `${id}: figure ${t.left.toFixed(1)}–${t.right.toFixed(1)} clipped by ${s.left.toFixed(1)}–${s.right.toFixed(1)}`,
          );
        }
      }
    }
    const root = document.scrollingElement;
    if (root && root.scrollWidth > root.clientWidth + 1)
      out.push(`the page scrolls sideways (${root.scrollWidth} px)`);
    return out;
  });
}

async function walk(browser, route, { lang = null, zoomed = false } = {}) {
  const context = await browser.newContext({
    viewport: zoomed ? ZOOMED : VIEWPORT,
    deviceScaleFactor: zoomed ? 2 : 1,
    isMobile: true,
    hasTouch: true,
    locale: "en-PH",
  });
  // The phone's chosen language, as the first run stores it (`fs.lang`), before the app boots.
  if (lang) {
    await context.addInitScript((l) => {
      try {
        window.localStorage.setItem("fs.lang", l);
      } catch {
        // Storage blocked: the app keeps its default (Cebuano).
      }
    }, lang);
  }
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("response", (r) => {
    if (r.url().startsWith(origin) && r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
  });
  const result = {
    name: `${route.name}${lang ? ` [${lang}]` : ""}${zoomed ? " [200%]" : ""}`,
    url: route.url,
    id: route.id,
    ok: false,
    state: null,
    path: null,
    problems,
  };
  try {
    const res = await page.goto(origin + route.url, { waitUntil: "load" });
    if (res?.status() !== 200) problems.push(`document HTTP ${res?.status()}`);
    const root = page.locator(`[data-testid="${route.id}"]`).first();
    await root.waitFor({ state: "visible", timeout: 20_000 });
    // Settle: a screen that loads says so in data-state; wait for it to say something else.
    const deadline = Date.now() + 15_000;
    let state = await root.getAttribute("data-state");
    while ((state === "loading" || state === null) && Date.now() < deadline) {
      await page.waitForTimeout(150);
      state = await root.getAttribute("data-state");
    }
    result.state = state;
    if (route.states && !route.states.includes(state)) {
      problems.push(`data-state "${state}", expected one of ${route.states.join(", ")}`);
    }
    if (!route.states && (state === "error" || state === "loading")) problems.push(`data-state "${state}"`);
    // The router may still be replacing the address (redirects, a token taken out of it).
    await page.waitForTimeout(1_300);
    const url = new URL(page.url());
    result.path = url.pathname + url.search;
    if (route.path && !route.path.test(url.pathname)) problems.push(`ended at ${url.pathname}`);
    for (const [k, v] of Object.entries(route.query ?? {})) {
      if (url.searchParams.get(k) !== v)
        problems.push(`query ${k}=${url.searchParams.get(k)}, expected ${v}`);
    }
    if (route.noQuery && `${url.search}${url.hash}`.includes(`${route.noQuery}=`)) {
      problems.push(`"${route.noQuery}=" still in the address`);
    }
    // A screen's first focus (`focusFirst`: a tabindex=-1 landing point for screen readers) draws no focus ring.
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body || el.getAttribute("tabindex") !== "-1") return null;
      const style = getComputedStyle(el).outlineStyle;
      return style === "none" ? null : `${el.getAttribute("data-testid") ?? el.tagName} (${style})`;
    });
    if (ring) problems.push(`first focus draws a focus ring around ${ring}`);
    if (route.visible && !(await page.locator(`[data-testid="${route.visible}"]`).first().isVisible())) {
      problems.push(`${route.visible} is not on screen`);
    }
    // OD-2: the review chip, once, on the surface itself (a modal's root has its own), in ceb and fil only.
    if (lang) {
      const want = lang === "en" ? 0 : 1;
      const chips = await root.locator(`[data-testid="${route.id}.machine"]`).count();
      const words = await root.getByText(CHIP, { exact: true }).count();
      if (chips !== want || words !== want) {
        problems.push(`review chip: ${chips} hook(s), ${words} label(s) in ${lang}, expected ${want}`);
      }
    }
    if (zoomed) {
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);
      for (const p of await clippedAmounts(page)) problems.push(`200%: ${p}`);
    }
    const shot = route.shot && zoomed ? route.shot.replace(/\.png$/, ".200.png") : route.shot;
    if (shots && shot && (!lang || lang === langs[0])) {
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(600);
      const file = join(resolve(shots), shot);
      mkdirSync(join(file, ".."), { recursive: true });
      await page.screenshot({ path: file });
      result.shot = file;
    }
    result.ok = problems.length === 0;
  } catch (e) {
    problems.push(`failed: ${e.message.split("\n")[0]}`);
  } finally {
    await context.close();
  }
  return result;
}

const chromium = loadChromium();
const server = spawn(process.execPath, [join(here, "serve-web.mjs"), "--port", String(port)], {
  stdio: "ignore",
});
let failed = 0;
try {
  await waitForServer();
  const browser = await chromium.launch();
  try {
    const picked = ROUTES.filter((r) => !only || r.name.includes(only) || r.url.includes(only));
    const runs = [
      ...langs.flatMap((lang) => picked.map((route) => ({ route, lang, zoomed: false }))),
      ...picked.filter((r) => r.zoom).map((route) => ({ route, lang: langs[0] ?? null, zoomed: true })),
    ];
    for (const { route, lang, zoomed } of runs) {
      const r = await walk(browser, route, { lang, zoomed });
      if (!r.ok) failed++;
      const mark = r.ok ? "ok  " : "FAIL";
      console.log(`${mark} ${r.id.padEnd(8)} ${String(r.state).padEnd(14)} ${r.name}  →  ${r.path ?? r.url}`);
      for (const p of r.problems) console.log(`       ${p}`);
      if (r.shot) console.log(`       shot: ${r.shot}`);
    }
  } finally {
    await browser.close();
  }
} finally {
  server.kill();
}
console.log(failed ? `\n${failed} route(s) failed.` : "\nEvery route rendered without errors.");
process.exit(failed ? 1 : 0);
