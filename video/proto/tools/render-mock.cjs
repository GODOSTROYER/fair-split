// Renders single product panels out of the Hayag target mock (research/theme-1104/final/mock.html) as
// transparent PNGs, for the opening prototype's floating windows. A design mock, not a product capture:
// F3's recordings replace these once the console is re-skinned.
// Usage (from the worktree root): node video/proto/tools/render-mock.cjs
// Uses an already installed Playwright and its cached Chromium (no download).
const path = require("node:path");
const PW = process.env.PLAYWRIGHT_MODULE || "Z:/Projects/Paypal/fs-wt/design/node_modules/playwright";
const { chromium } = require(PW);

const MOCK = "Z:/Projects/Paypal/research/theme-1104/final/mock.html";
const OUT = path.resolve(__dirname, "..", "assets");

// file, selector, wrapper classes (for descendant selectors), device scale, padding (px, for rotated edges)
const JOBS = [
  { file: "win-member-phone.png", sel: ".member .phone", wrap: "member", scale: 2, pad: 0, natural: true },
  { file: "win-chair-phone.png", sel: ".stage .phone", wrap: "panel stage", scale: 2, pad: 0, natural: true },
  { file: "win-split.png", sel: ".panel.split", wrap: "", scale: 2, pad: 0 },
  { file: "win-proof.png", sel: ".panel.proof", wrap: "", scale: 2, pad: 0 },
  { file: "win-peso.png", sel: ".member .peso-card", wrap: "member", scale: 2, pad: 0 },
  { file: "win-slip-read.png", sel: ".member .slip", wrap: "member", scale: 3, pad: 16 },
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  await page.goto(`file:///${MOCK}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(200);
  // Measure every source element in place first.
  const sizes = await page.evaluate(
    (jobs) =>
      jobs.map((j) => {
        const el = document.querySelector(j.sel);
        return { w: el.offsetWidth, h: el.offsetHeight };
      }),
    JOBS,
  );
  await browser.close();

  for (const [i, job] of JOBS.entries()) {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 1920, height: 1400 }, deviceScaleFactor: job.scale });
    await p.goto(`file:///${MOCK}`);
    await p.evaluate(() => document.fonts.ready);
    const { w, h } = sizes[i];
    await p.evaluate(
      ({ job, w, h }) => {
        const src = document.querySelector(job.sel);
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
      `;
        document.head.appendChild(style);
        const wrap = document.createElement("div");
        wrap.id = "iso";
        if (job.wrap) wrap.className = job.wrap;
        clone.classList.add("iso-el");
        clone.style.width = `${w}px`;
        if (!job.natural) clone.style.height = `${h}px`;
        clone.style.visibility = "visible";
        wrap.appendChild(clone);
        document.body.appendChild(wrap);
      },
      { job, w, h },
    );
    await p.waitForTimeout(150);
    const el = await p.$("#iso");
    await el.screenshot({ path: path.join(OUT, job.file), omitBackground: true });
    console.log(job.file, `${w}x${h} css @${job.scale}x`);
    await b.close();
  }
})();
