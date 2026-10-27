import type { ReviewItem, TrapItem } from "./session.js";

/**
 * The review page served on 127.0.0.1 by `imagegen review`: one row per field with its crop, what the
 * prompt asked for, and an input. Enter keeps the value shown and moves on; typing records what is
 * visible ("?" for a character that cannot be read). Self-contained: no external scripts, fonts or images.
 */

export interface PageData {
  id: string;
  title: string;
  reviewer: string;
  token: string;
  items: ReviewItem[];
  traps: TrapItem[];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** JSON for an inline <script> block: "<" is escaped so no value can close the script element. */
export function inlineJson(v: unknown): string {
  return JSON.stringify(v)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

const CSS = `
:root { color-scheme: light; --ink:#1d1b18; --muted:#6b645a; --paper:#f6f2ea; --line:#d9d1c3; --ok:#1f6f50; --warn:#9a5b00; --bad:#a1251b; --focus:#c45a12; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; background: #fffdf8; border-bottom: 1px solid var(--line); padding: 12px 16px; display: flex; gap: 16px; align-items: baseline; flex-wrap: wrap; }
header h1 { font-size: 18px; margin: 0; }
.tag { font-size: 12px; border: 1px solid var(--ink); padding: 1px 6px; border-radius: 3px; }
#progress { margin-left: auto; color: var(--muted); }
main { max-width: 1100px; margin: 0 auto; padding: 16px; }
.help { color: var(--muted); margin: 0 0 16px; }
.row { display: grid; grid-template-columns: minmax(0, 1fr) 360px; gap: 12px; padding: 10px; margin-bottom: 8px; background: #fffdf8; border: 1px solid var(--line); border-left: 4px solid var(--line); border-radius: 4px; }
.row.done { border-left-color: var(--ok); }
.row.changed { border-left-color: var(--warn); }
.row:focus-within { outline: 2px solid var(--focus); outline-offset: 1px; }
.crop { max-width: 100%; max-height: 140px; background: #fff; border: 1px solid var(--line); image-rendering: auto; }
.meta { display: flex; flex-direction: column; gap: 6px; }
.title { font-weight: 600; }
.asked { color: var(--muted); font-size: 13px; }
.asked b { color: var(--ink); font-weight: 600; }
input[type=text] { font: 18px/1.3 system-ui, sans-serif; padding: 6px 8px; width: 100%; border: 1px solid #b9b0a1; border-radius: 3px; }
select { font: inherit; padding: 3px; }
.controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; font-size: 13px; }
.trap { background: #fff8ec; border: 1px solid #e7cf9e; border-radius: 4px; padding: 10px; margin-bottom: 8px; }
textarea { width: 100%; min-height: 60px; font: inherit; }
button { font: inherit; padding: 8px 16px; border-radius: 4px; border: 1px solid var(--ink); background: var(--ink); color: #fff; cursor: pointer; }
button:disabled { opacity: .45; cursor: not-allowed; }
#result { margin-top: 12px; white-space: pre-wrap; }
.bad { color: var(--bad); }
@media (max-width: 760px) { .row { grid-template-columns: 1fr; } }
`;

const SCRIPT = `
const data = JSON.parse(document.getElementById("data").textContent);
const rows = [...document.querySelectorAll(".row")];
const state = data.items.map((it) => ({ done: false, legTouched: false, expTouched: false }));
const defaultLeg = (v) => (v === "" ? "ABSENT" : v.includes("?") ? "SMUDGED" : "CLEAR");
const intended = (req) => (req.includes("?") ? "HUMAN" : "AUTO");
function progress() {
  const n = state.filter((s) => s.done).length;
  document.getElementById("progress").textContent = n + " of " + state.length + " confirmed";
  document.getElementById("submit").disabled = n !== state.length;
}
const BLANK = "(blank)";
function confirmRow(i, visible) {
  const it = data.items[i];
  const row = rows[i];
  const input = row.querySelector("input[type=text]");
  input.value = visible === "" ? BLANK : visible;
  input.dataset.visible = visible;
  if (!state[i].legTouched) row.querySelector(".leg").value = defaultLeg(visible);
  if (!state[i].expTouched) row.querySelector(".exp").value = visible === it.requested ? intended(it.requested) : "EITHER";
  state[i].done = true;
  row.classList.add("done");
  row.classList.toggle("changed", visible !== it.requested);
  progress();
}
rows.forEach((row, i) => {
  const input = row.querySelector("input[type=text]");
  input.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    // Enter on an empty box keeps what is shown; "(blank)" records that nothing is written.
    let v = input.value.trim();
    if (v === "") v = data.items[i].visible;
    else if (v.toLowerCase() === BLANK) v = "";
    confirmRow(i, v);
    const next = rows[i + 1]?.querySelector("input[type=text]");
    if (next) next.focus(); else document.getElementById("note").focus();
  });
  input.addEventListener("input", () => { state[i].done = false; row.classList.remove("done"); progress(); });
  row.querySelector(".leg").addEventListener("change", () => { state[i].legTouched = true; });
  row.querySelector(".exp").addEventListener("change", () => { state[i].expTouched = true; });
});
document.getElementById("submit").addEventListener("click", async () => {
  const body = {
    fields: data.items.map((it, i) => {
      const row = rows[i];
      return {
        path: it.path,
        visible: row.querySelector("input[type=text]").dataset.visible ?? it.visible,
        legibility: row.querySelector(".leg").value,
        expect: row.querySelector(".exp").value,
        cropWrong: row.querySelector(".crop-wrong").checked,
      };
    }),
    traps: [...document.querySelectorAll(".trap")].map((t) => ({
      slot: t.dataset.slot,
      trap: t.dataset.trap,
      status: t.querySelector("input[value=FAILED]").checked ? "FAILED" : "UNVERIFIED",
      evidence: t.querySelector("textarea").value,
    })),
    note: document.getElementById("note").value,
  };
  const out = document.getElementById("result");
  out.textContent = "Saving…";
  const r = await fetch("/submit", { method: "POST", headers: { "content-type": "application/json", "x-review-token": data.token }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({ error: "bad response" }));
  out.className = r.ok ? "" : "bad";
  out.textContent = r.ok ? j.message : "Not saved: " + (j.error ?? r.status);
  if (r.ok) document.getElementById("submit").disabled = true;
});
rows[0]?.querySelector("input[type=text]")?.focus();
progress();
`;

const LEGS = ["CLEAR", "SMUDGED", "OVERWRITTEN", "ILLEGIBLE", "ABSENT"];
const EXPECTS = ["AUTO", "HUMAN", "EITHER"];

function options(values: readonly string[], selected: string): string {
  return values.map((v) => `<option${v === selected ? " selected" : ""}>${v}</option>`).join("");
}

function defaultLegibility(item: ReviewItem): string {
  if (item.legibility !== "UNVERIFIED") return item.legibility;
  return item.visible === "" ? "ABSENT" : item.visible.includes("?") ? "SMUDGED" : "CLEAR";
}

function row(item: ReviewItem, token: string): string {
  const asked = item.requested === "" ? "<b>(blank)</b>" : `<b>${esc(item.requested)}</b>`;
  const seed = item.value !== item.requested ? ` · seed value <b>${esc(item.value)}</b>` : "";
  const checked =
    item.checkedBy !== null
      ? ` · last checked by ${esc(item.checkedBy)}: <b>${esc(item.visible === "" ? "(blank)" : item.visible)}</b>`
      : "";
  return `<div class="row" data-i="${item.i}">
  <img class="crop" alt="Crop of ${esc(item.title)} (synthetic sample)" src="/crop/${item.i}?t=${esc(token)}" loading="lazy">
  <div class="meta">
    <div class="title">${esc(item.title)}</div>
    <div class="asked">Asked for ${asked}${seed}${checked}</div>
    <input type="text" aria-label="What is visibly written in ${esc(item.title)}" placeholder="${esc(item.visible === "" ? "(blank)" : item.visible)}" autocomplete="off" spellcheck="false">
    <div class="controls">
      <label>Legibility <select class="leg">${options(LEGS, defaultLegibility(item))}</select></label>
      <label>Reader should <select class="exp">${options(EXPECTS, item.expect)}</select></label>
      <label><input type="checkbox" class="crop-wrong"> crop is wrong</label>
    </div>
  </div>
</div>`;
}

function trap(t: TrapItem): string {
  const read = t.by === "read" ? ` A recorded read already says <b>${esc(t.status)}</b>.` : "";
  return `<div class="trap" data-slot="${esc(t.slot)}" data-trap="${esc(t.trap)}">
  <div class="title">${esc(t.slot === "ONLY" ? "" : `${t.slot} · `)}${esc(t.trap)}</div>
  <p>${esc(t.question)}${read}</p>${
    t.leak
      ? `
  <p class="bad">${esc(t.leak)}</p>`
      : ""
  }
  <label><input type="radio" name="trap-${esc(t.slot)}-${esc(t.trap)}" value="UNVERIFIED"${t.status === "FAILED" ? "" : " checked"}> renders as intended (still needs a recorded read)</label>
  <label><input type="radio" name="trap-${esc(t.slot)}-${esc(t.trap)}" value="FAILED"${t.status === "FAILED" ? " checked" : ""}> fails${t.status === "FAILED" && t.by !== "read" ? ` (recorded by ${esc(t.by ?? "")}: change it only if you disagree)` : ""}</label>
  <textarea aria-label="What you saw" placeholder="What you saw (optional)">${esc(t.evidence)}</textarea>
</div>`;
}

export function renderReviewPage(d: PageData): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Review ${esc(d.id)}</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Review ${esc(d.id)}</h1>
  <span class="tag">Synthetic sample</span>
  <span>${esc(d.title)}</span>
  <span id="progress"></span>
</header>
<main>
  <p class="help">Reviewer: <b>${esc(d.reviewer)}</b>. For each crop, type what is <b>visibly written</b>, character for character; use <b>?</b> for a character you cannot read, and type <b>(blank)</b> if nothing is written. <b>Enter</b> on an empty box keeps the value shown in grey and moves to the next field. Tick "crop is wrong" if the crop does not hold exactly its box.</p>
  ${d.items.map((it) => row(it, d.token)).join("\n  ")}
  ${d.traps.length ? `<h2>Traps</h2>\n  ${d.traps.map(trap).join("\n  ")}` : ""}
  <h2>Note</h2>
  <textarea id="note" aria-label="Note for the record" placeholder="Anything else you noticed (optional)"></textarea>
  <p><button id="submit" disabled>Save review</button></p>
  <div id="result" role="status" aria-live="polite"></div>
</main>
<script id="data" type="application/json">${inlineJson({ token: d.token, items: d.items })}</script>
<script>${SCRIPT}</script>
</body>
</html>`;
}
