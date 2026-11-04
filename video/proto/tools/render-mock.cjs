// Renders single product panels out of the Hayag target mock (research/theme-1104/final/mock.html) as
// transparent PNGs, for the opening prototype's floating windows. A design mock, not a product capture:
// F3's recordings replace these once the console is re-skinned.
// Usage (from the worktree root): node video/proto/tools/render-mock.cjs
// Uses an already installed Playwright and its cached Chromium (no download).
//
// Each job isolates one element of the mock, optionally restyles it for the film (`css`, scoped to the
// isolated copy) and reports the boxes of a few parts (`measure`) in output pixels, which index.html uses
// for the pulses, the waveform overlay and the trace anchors (tools/win-geometry.json).
const fs = require("node:fs");
const path = require("node:path");
const PW = process.env.PLAYWRIGHT_MODULE || "Z:/Projects/Paypal/fs-wt/design/node_modules/playwright";
const { chromium } = require(PW);

const MOCK = "Z:/Projects/Paypal/research/theme-1104/final/mock.html";
const OUT = path.resolve(__dirname, "..", "assets");

// A neutral slip chip: the film lights a chip only when the trace reaches it.
const QUIET_CHIP =
  "#iso .slipchip.on { border-color: var(--rule-strong) !important; background: var(--plate) !important; box-shadow: none !important; }";

// file, selector, wrapper classes (for descendant selectors), device scale, padding (px), width mode
const JOBS = [
  // the split review, whole (kept as the deep, blurred background plane of "checked.")
  { file: "win-split.png", sel: ".panel.split", wrap: "", scale: 2, pad: 0 },
  { file: "win-proof.png", sel: ".panel.proof", wrap: "", scale: 2, pad: 0 },
  { file: "win-chair-phone.png", sel: ".stage .phone", wrap: "panel stage", scale: 2, pad: 0, natural: true },
  // "checked.": the one duplicate row, lifted out of the table and stacked so it can be large
  {
    file: "win-catch.png",
    sel: ".split .res",
    wrap: "",
    scale: 4,
    pad: 0,
    maxContent: true,
    css: `
      #iso .res { display: grid !important; grid-template-columns: auto auto; column-gap: 18px; row-gap: 14px; align-items: center;
                  padding: 20px 30px 26px 20px; background: var(--plate); border-radius: 20px; }
      #iso .res .thumbs { grid-row: 1 / span 2; }
      #iso .res .say { font-size: 0 !important; line-height: 0 !important; }
      #iso .res .say b { font-size: 12.5px; line-height: 17px; }
      #iso .res .slab--quiet { display: none !important; }
      #iso .res .slab--hand { justify-self: start; }`,
    measure: { say: ".say b", btn: ".slab--hand", thumbs: ".thumbs" },
  },
  // "read.": Claude's reading, without the header line; the yellow sticker becomes a film tag
  {
    file: "win-read.png",
    sel: ".member .slip",
    wrap: "member",
    scale: 4,
    pad: 0,
    maxContent: true,
    css: `
      #iso .slip { transform: none !important; padding: 10px 16px 12px 14px !important; border-radius: 6px !important; }
      #iso .slip-h, #iso .synth { display: none !important; }
      #iso .slip-r { padding-top: 0 !important; }
      #iso .slip-r em { margin-left: 14px !important; }`,
    measure: { name: ".slip-r b:nth-of-type(1)", fig: ".slip-r b:nth-of-type(2)", claude: ".slip-r em" },
  },
  // "paid.": the member's phone. One tag on screen (the film's), the chip quiet, the waveform drawn by the film
  {
    file: "win-phone.png",
    sel: ".member .phone",
    wrap: "member",
    scale: 2,
    pad: 0,
    natural: true,
    css: `
      #iso .stmt .chips { display: none !important; }
      #iso .wave i { visibility: hidden !important; }
      ${QUIET_CHIP}`,
    measure: {
      wave: ".wave",
      bar0: ".wave i:first-child",
      play: ".playbtn",
      paid: ".paid",
      amt: ".bigamt",
      chip: ".lines .slipchip",
    },
  },
  // the peso card without its sentence: quiet (paid.) and lit (the trace reaches it)
  {
    file: "win-peso-quiet.png",
    sel: ".member .peso-card",
    wrap: "member",
    scale: 2,
    pad: 0,
    natural: true,
    css: `#iso .peso-card .k { display: none !important; } #iso .eq { margin-top: 0 !important; }
          #iso .eq .term b.tapped { box-shadow: none !important; } ${QUIET_CHIP}`,
    measure: { chip: ".slipchip.on", premium: ".tapped", paid: ".term--paid b" },
  },
  {
    file: "win-peso-lit.png",
    sel: ".member .peso-card",
    wrap: "member",
    scale: 2,
    pad: 0,
    natural: true,
    css: `#iso .peso-card .k { display: none !important; } #iso .eq { margin-top: 0 !important; }`,
  },
];

(async () => {
  const geometry = {};
  for (const job of JOBS) {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: job.scale });
    await p.goto(`file:///${MOCK}`);
    await p.evaluate(() => document.fonts.ready);
    await p.waitForTimeout(150);
    const out = await p.evaluate((job) => {
      const src = document.querySelector(job.sel);
      const w = src.offsetWidth,
        h = src.offsetHeight;
      const clone = src.cloneNode(true);
      const style = document.createElement("style");
      style.textContent = `
        html, body { background: transparent !important; }
        body > *:not(#iso):not(svg) { visibility: hidden !important; }
        #iso { position: fixed; left: 0; top: 0; z-index: 99999; display: block !important; padding: ${job.pad}px;
               background: transparent !important; box-shadow: none !important; overflow: visible !important;
               width: auto !important; height: auto !important; }
        #iso::before, #iso::after { content: none !important; display: none !important; }
        #iso > .iso-el { box-shadow: none !important; margin: 0 !important; }
        #iso > .iso-el.phone { box-shadow: 0 0 0 1px #2A3240, inset 0 0 0 1.5px #3A4352 !important; }
        ${job.css || ""}
      `;
      document.head.appendChild(style);
      const wrap = document.createElement("div");
      wrap.id = "iso";
      if (job.wrap) wrap.className = job.wrap;
      clone.classList.add("iso-el");
      clone.style.width = job.maxContent ? "max-content" : `${w}px`;
      if (!job.natural && !job.maxContent) clone.style.height = `${h}px`;
      clone.style.visibility = "visible";
      wrap.appendChild(clone);
      document.body.appendChild(wrap);
      const base = wrap.getBoundingClientRect();
      const s = window.devicePixelRatio;
      const boxes = {};
      for (const [k, sel] of Object.entries(job.measure || {})) {
        const el = wrap.querySelector(sel);
        if (!el) {
          boxes[k] = null;
          continue;
        }
        const r = el.getBoundingClientRect();
        boxes[k] = [r.left - base.left, r.top - base.top, r.width, r.height].map(
          (v) => Math.round(v * s * 10) / 10,
        );
      }
      return { size: [Math.round(base.width * s), Math.round(base.height * s)], boxes };
    }, job);
    await p.waitForTimeout(150);
    const el = await p.$("#iso");
    await el.screenshot({ path: path.join(OUT, job.file), omitBackground: true });
    geometry[job.file] = out;
    console.log(job.file, JSON.stringify(out));
    await b.close();
  }
  fs.writeFileSync(path.join(__dirname, "win-geometry.json"), `${JSON.stringify(geometry, null, 2)}\n`);
})();
