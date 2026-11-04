// The film's plan in the motion language of video/proto/STYLE.md: which composition covers which beats, the seams
// between them, the one keyword and the one honesty tag per capture slot, the closed captions and the audio cue
// points. Shared by build.mjs (which writes the film) and check.mjs (which verifies what was written). Words and time
// belong to script.ts; this file only places them.
import { readFileSync } from "node:fs";
import { beats, CAPTURES, FILM, REAL_READING_CAPTION } from "./script.ts";

export const SIM = "Simulated PayPal sandbox";
export const NAVY = "#090D18";

/**
 * Every composition on the film's track 0, in order. Parts that exist as their own HyperFrames projects are mounted
 * in place (one source, no copies); the opening is generated from the prototype; capture-slot beats are generated.
 */
export const SEGMENTS = [
  {
    id: "opening",
    beats: ["problem", "solution"],
    src: "compositions/opening.html",
    from: "proto/index.html",
    field: "night, then day",
  },
  {
    id: "architecture",
    beats: ["architecture"],
    src: "parts/architecture/compositions/architecture.html",
    field: "night",
  },
  { id: "highlights", beats: ["highlights"], src: "compositions/highlights.html", slots: true, field: "day" },
  ...[
    "paper",
    "funding",
    "reading",
    "count-once",
    "holds",
    "signing",
    "payouts",
    "proof",
    "member",
    "listening",
  ].map((id) => ({ id, beats: [id], src: `compositions/${id}.html`, slots: true, field: "day" })),
  {
    id: "close-impressive",
    beats: ["impressive"],
    src: "parts/close/compositions/impressive.html",
    field: "night, blooming into day",
  },
  { id: "close-limits", beats: ["limits"], src: "parts/close/compositions/limits.html", field: "day" },
  { id: "close-end", beats: ["end"], src: "parts/close/compositions/end.html", field: "day" },
].map((segment) => {
  const covered = segment.beats.map((id) => beats.find((beat) => beat.id === id));
  if (covered.some((beat) => !beat)) throw new Error(`${segment.id}: unknown beat`);
  return { ...segment, start: covered[0].start, end: covered.at(-1).end };
});

/** Dips to night before a night part: a navy plate fades in over the last frames of the outgoing composition. */
export const SEAMS = [
  {
    id: "seam-30",
    end: 30,
    duration: 0.25,
    why: "the opening's name card dips to night for the architecture",
  },
  {
    id: "seam-44",
    end: 44,
    duration: 0.4,
    why: "the finished diagram dims; the reel opens out of it by an iris",
  },
  { id: "seam-143", end: 143, duration: 0.4, why: "the listening beat dips to night for why it holds up" },
];

/** One word each (STYLE §2, day keyword), said or meant by the narration over that slot. */
export const KEYWORDS = {
  "hl-matrix": "balanced.",
  "hl-ratecard": "frozen.",
  "hl-keys": "signed.",
  "hl-proof": "checked.",
  "hl-member": "heard.",
  "hl-break": "refused.",
  "paper-photos": "paper.",
  "paper-carbon": "twice.",
  "funding-console": "funded.",
  "reading-console": "read.",
  "reading-byhand": "typed.",
  "count-console": "once.",
  "holds-console": "held.",
  "rules-console": "locked.",
  "signing-console": "signed.",
  "signing-phone": "co-signed.",
  "signing-approved": "approved.",
  "payouts-console": "sent.",
  "payouts-cash": "cash.",
  "proof-browser": "re-checked.",
  "member-phone": "traced.",
  "listening-phone": "heard.",
};

/** Window geometry (STYLE §4): a 16:9 console or browser crop, or a phone. `a` beside the keyword, `b` after it. */
export const WINDOWS = {
  landscape: { w: 1000, h: 562.5, radius: 22, a: { x: 1130, y: 590, s: 1 }, b: { x: 960, y: 524, s: 1.16 } },
  phone: { w: 330, h: 715, radius: 48, a: { x: 1250, y: 540, s: 1 }, b: { x: 960, y: 540, s: 1.06 } },
};
export const windowKind = (slot) => (slot.source === "phone recording" ? "phone" : "landscape");

const beatOf = (slot) => beats.find((beat) => beat.id === slot.beat);
/** The deep dive's PayPal run: from the first beat that shows a PayPal value to the last (STYLE §7). */
const deep = beats.filter((beat) => beat.part === "deep-dive" && beat.show.includes(SIM));
const RUN = [Math.min(...deep.map((b) => b.start)), Math.max(...deep.map((b) => b.end))];
/** A slot's own honesty label (the reading's two clips), which takes the tag's place while it plays. */
const honesty = (slot) =>
  slot.overlay[0] === REAL_READING_CAPTION || /stand-in/i.test(slot.overlay[0] ?? "")
    ? slot.overlay[0]
    : null;
/**
 * The one tag over a slot: its own honesty label, else "Simulated PayPal sandbox" wherever a PayPal value can show
 * (a beat that names the sandbox, or any slot inside the deep dive's PayPal run), else none.
 */
export function slotTag(slot) {
  const own = honesty(slot);
  if (own) return { kind: "honesty", text: own };
  const end = slot.start + slot.duration;
  if (beatOf(slot).show.includes(SIM) || (slot.start >= RUN[0] && end <= RUN[1] + 1e-9))
    return { kind: "sim", text: SIM };
  return null;
}
/** The sandbox tag's span inside one composition, and whether it runs on from or into a neighbour (no re-fade). */
export function simSpan(segment) {
  const own = CAPTURES.filter((slot) => segment.beats.includes(slot.beat) && slotTag(slot)?.kind === "sim");
  if (!own.length) return null;
  const from = Math.min(...own.map((slot) => slot.start));
  const to = Math.max(...own.map((slot) => slot.start + slot.duration));
  const spans = own.reduce((sum, slot) => sum + slot.duration, 0);
  if (Math.abs(spans - (to - from)) > 1e-6) throw new Error(`${segment.id}: the sandbox tag would blink`);
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  const sim = CAPTURES.filter((slot) => slotTag(slot)?.kind === "sim");
  return {
    from,
    to,
    continuesIn: near(from, segment.start) && sim.some((slot) => near(slot.start + slot.duration, from)),
    continuesOut: near(to, segment.end) && sim.some((slot) => near(slot.start, to)),
  };
}

// ------------------------------------------------------------------------------------------------ the opening
// Generated from the prototype, the reference implementation of STYLE.md, so the two cannot drift: ids get the
// composition's prefix (one assembled page), images are read from proto/assets, fonts come from film.css.
export function openingFromPrototype(prefix = "op-") {
  const source = readFileSync(new URL("proto/index.html", import.meta.url), "utf8");
  const pick = (re, what) => {
    const found = re.exec(source);
    if (!found) throw new Error(`proto/index.html: no ${what}`);
    return found;
  };
  const style = pick(/<style>\n([\s\S]*?)<\/style>/, "style")[1];
  const defs = pick(/<svg width="0" height="0"[\s\S]*?<\/svg>/, "symbol defs")[0];
  const rootTag = pick(/<div id="root"[^>]*>/, "root")[0];
  const duration = Number(/data-duration="([\d.]+)"/.exec(rootTag)?.[1]);
  const body = source.slice(
    source.indexOf(rootTag) + rootTag.length,
    source.lastIndexOf("</div>\n\n<script>"),
  );
  const script = pick(/<script>\n([\s\S]*?)<\/script>\n<\/body>/, "timeline script")[1];
  const ids = [...new Set([...source.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]
    .filter((id) => id !== "root")
    .sort((a, b) => b.length - a.length);
  const rename = (text) => {
    let out = text;
    for (const id of ids) {
      const safe = id.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\// ---------------------------------------------------------------------------------------------------- captions",
      );
      out = out
        .replace(new RegExp(`(?<=\\s)id="${safe}"`, "g"), `id="${prefix}${id}"`)
        .replace(new RegExp(`#${safe}(?![\\w-])`, "g"), `#${prefix}${id}`);
    }
    return out.replaceAll('"assets/', '"proto/assets/');
  };
  // The scoper prefixes every rule with the composition, so the prototype's :root tokens move onto #root.
  const css = rename(style)
    .replace(/^@font-face \{[^}]*\}\n/gm, "")
    .replace(/^html, body \{[^}]*\}\n/m, "")
    .replace(/^body \{[^}]*\}\n/m, "")
    .replace(
      /^#root \{[^}]*\}/m,
      "#root { position: absolute; inset: 0; overflow: hidden; background: #04060C; }",
    )
    .replace(/^:root \{/m, "#root {");
  const id = /data-composition-id="([^"]+)"/.exec(rootTag)?.[1];
  if (id !== "opening" || duration !== 30) throw new Error("The prototype is no longer the 30 s opening");
  if (!script.includes(`window.__timelines["${id}"] = tl;`))
    throw new Error("The prototype's timeline key moved");
  return {
    duration,
    html: `<!doctype html>
<!-- Generated by video/build.mjs from video/proto/index.html, the opening prototype and the reference implementation of
     video/proto/STYLE.md: ids prefixed ${prefix}, images read from proto/assets, fonts from film.css. Edit the prototype,
     then rebuild; never edit this file. Script v4 beats problem (0-14 s) and solution (14-30 s). -->
<html lang="en"><head><meta charset="UTF-8"></head><body><template>
<style>
${css}</style>
<div id="root" data-composition-id="${id}" data-width="1920" data-height="1080" data-duration="${duration}">
${rename(defs)}
${rename(body).trim()}
</div>
<script>
${rename(script)}</script>
</template></body></html>
`,
  };
}

// ---------------------------------------------------------------------------------------------------- captions
/** STYLE §8: a closed-caption track, word for word, at most two lines of 42 characters, each cue 1 to 6 seconds. */
export const CAPTION = { line: 42, lines: 2, min: 1, max: 6 };
/** Bracketed lines only where the sound carries meaning. */
export const BRACKETS = { listening: "[Her statement plays in Cebuano]" };
const breakCost = (word, last) => (last || /[.;:!?]$/.test(word) ? 0 : /,$/.test(word) ? 150 : 600);
/** A phrase as one line, or two balanced lines that break after punctuation where they can; null if it cannot fit. */
export function wrap(text, lines = CAPTION.lines) {
  if (text.length <= CAPTION.line) return [text];
  if (lines < 2) return null;
  let best = null;
  for (let k = text.indexOf(" "); k > 0; k = text.indexOf(" ", k + 1)) {
    const a = text.slice(0, k);
    const b = text.slice(k + 1);
    if (a.length > CAPTION.line || b.length > CAPTION.line) continue;
    // Balanced lines, broken at punctuation where possible and never after a little word that leads the next.
    const score =
      Math.max(a.length, b.length) +
      (/[.,;:!?]$/.test(a) ? 0 : 16) +
      (/\b(a|an|and|or|the|to|of|in|on|its|their|then|sa)$/i.test(a) ? 8 : 0) +
      Math.abs(a.length - b.length) / 100;
    if (!best || score < best.score) best = { score, lines: [a, b] };
  }
  return best?.lines ?? null;
}
const ms = (value) => Math.round(value * 1000) / 1000;
/**
 * One beat's cues. Timing is word-proportional across the beat's speech window (as every card, architecture step and
 * reel cut is timed) until F4 aligns the recorded voice; the cheapest split prefers breaks at punctuation.
 */
export function captionCues(beat) {
  const words = beat.say.split(" ");
  const [from, to] = beat.speech ?? [beat.start, beat.end];
  const per = (to - from) / words.length;
  const bracket = BRACKETS[beat.id] ?? null;
  const best = Array(words.length + 1).fill(null);
  best[0] = { cost: 0, from: -1, lines: null };
  for (let i = 1; i <= words.length; i++)
    for (let j = 0; j < i; j++) {
      if (!best[j]) continue;
      const text = words.slice(j, i).join(" ");
      const lines = wrap(text, j === 0 && bracket ? 1 : CAPTION.lines);
      const seconds = (i - j) * per;
      if (!lines || seconds < CAPTION.min - 1e-9 || seconds > CAPTION.max + 1e-9) continue;
      const cost =
        best[j].cost + 100 + breakCost(words[i - 1], i === words.length) + Math.max(0, 28 - text.length) ** 2;
      if (!best[i] || cost < best[i].cost) best[i] = { cost, from: j, lines };
    }
  if (!best[words.length])
    throw new Error(`${beat.id}: no caption split fits ${CAPTION.max} s and two lines`);
  const cues = [];
  for (let i = words.length; i > 0; i = best[i].from) {
    const j = best[i].from;
    cues.unshift({
      beat: beat.id,
      start: ms(from + j * per),
      end: i === words.length ? ms(to) : ms(from + i * per),
      lines: j === 0 && bracket ? [bracket, ...best[i].lines] : best[i].lines,
    });
  }
  return cues;
}
export const captions = beats.flatMap((beat) => (beat.say ? captionCues(beat) : []));

export const stamp = (value) => {
  const total = Math.round(value * 1000);
  const pad = (n, size = 2) => String(n).padStart(size, "0");
  return `${pad(Math.floor(total / 3600000))}:${pad(Math.floor(total / 60000) % 60)}:${pad(Math.floor(total / 1000) % 60)}.${pad(total % 1000, 3)}`;
};
export function vtt(cues, note, shift = 0) {
  const body = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${stamp(cue.start - shift)} --> ${stamp(cue.end - shift)}\n${cue.lines.join("\n")}\n`,
    )
    .join("\n");
  return `WEBVTT\n\nNOTE ${note}\n\n${body}`;
}
export const VTT_NOTE =
  "Fair Split film, script v4: closed captions, word for word with every spoken line and never burned in (video/proto/STYLE.md §8). Generated from video/script.ts by video/build.mjs. Timing is word-proportional within each beat until F4 aligns the recorded voice.";
export const CLOSE_START = 143;
export const CLOSE_NOTE =
  "Closed captions for the film close (script v4 beats impressive, limits, end): video/captions.vtt from 143 s, shifted by -143 s and generated with it by video/build.mjs. Muxed into out/close.mp4 as a soft subtitle track; never burned in.";

// ------------------------------------------------------------------------------------------------ audio cues
/** Picture events the sound is cut to (film seconds). The opening's come from video/proto (its README outline). */
export const OPENING = {
  hairline: 0.3,
  farmers: 1.4,
  shoebox: 3.2,
  wave: 5.5,
  doubled: [7.6, 9.6],
  once: 9.7,
  ring: 12.85,
  invoice: 13.12,
  turn: [14.45, 15.8],
  keywords: [16.6, 20.2, 23.25],
  statement: 23.78,
  jadePulse: 26.6,
  endLine: 27.2,
  name: 28.5,
};
/** The close's own events (video/parts/close): the weigh-slip line blooms into daylight, then the end card. */
export const CLOSE = { bloom: [153.36, 153.98], endLine: 167 };
/** The IC-11 PREMIUM sentence, placed inside the listening beat so it ends before the dip to night at 142.6 s. */
export const MEMBER_CLIP = { start: 134.15, seconds: 8.44 };
export const FILM_SECONDS = FILM.duration;
