// F1, script v4: a product video, overview first (ADR-0017). replan-1031 §6 and ADR-0002/0010/0015 govern
// every claim. Script data only: F2 assembles local captures and original cards, F4 makes the Gemini narration.
// No remote IO. Colours belong to the film's design, never to this file.
import { readFileSync } from "node:fs";

interface Seed {
  figures: {
    display: {
      invoice: string;
      batchTotal: string;
      proofShare: string;
      endPaid: string;
      endCash: string;
      shrinkOnce: string;
      shrinkTwice: string;
      tolerance: string;
    };
    members: number;
    creditsCents: number;
    redirectedDuplicateCents: number;
    endPaidMembers: number;
    endCashMembers: number;
  };
  rateCard: { canonical: { rules: { cosign: { batchOverCents: number; lineOverCents: number } } } };
  slips: readonly { copy: string; replaySet: boolean }[];
  photos: readonly { photoId: string; set: string }[];
  proof: { lines: readonly { memberNo: string; premiumCents: number; netCents: number }[] };
}
const seed: Seed = JSON.parse(
  readFileSync(new URL("../packages/seed/snapshot/season-2026A.json", import.meta.url), "utf8"),
);
const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;
const heroLine = seed.proof.lines.find((line) => line.memberNo === "M-014");
if (!heroLine) throw new Error("IC-03 hero line is missing");
/** Narrowed once here, so the hoisted beat and slot builders below read it as defined. */
const hero = heroLine;
const figures = seed.figures;
const rules = seed.rateCard.canonical.rules.cosign;
const cosign = usd(rules.batchOverCents);
/** Deliveries: one white original each. The pink duplicate is a copy, not a delivery. */
const weighSlips = seed.slips.filter((slip) => slip.copy === "WHITE_ORIGINAL").length;
/** What the judge run actually images: the replay set A–L, composed in code. Earlier photos are manifest rows. */
const runPhotos = seed.photos.filter((photo) => photo.set === "REPLAY");
const runSlips = seed.slips.filter((slip) => slip.replaySet).length;
const photoRange = `${runPhotos[0]?.photoId}–${runPhotos.at(-1)?.photoId}`;

/** The three parts the owner asked for, in order: understand it all in the first minute, then the depth. */
export const PARTS = [
  {
    id: "overview",
    title: "Overview: problem, solution, architecture, highlights",
    start: 0,
    end: 57,
    bumper: null,
  },
  {
    id: "deep-dive",
    title: "Deep dive: the problem, the product, why it holds up",
    start: 57,
    end: 154,
    // Tells the judge the overview is over (visual only, no spoken words).
    bumper: "The deep dive: one season, step by step",
  },
  { id: "close", title: "Limits, impact and end card", start: 154, end: 175, bumper: null },
] as const;
export type PartId = (typeof PARTS)[number]["id"];
/** How long a part's bumper stays over the first frames of its first beat. */
export const BUMPER_SECONDS = 1.5;

export type ReadingVariant = "stand-in" | "real-reading";
// The sole editorial switch. R1's readings and C5d's hero-slip exhibit are both on main, so the film cuts to
// the exhibit; the judge run itself still replays the labelled seed stand-in, and the film says so.
export const READING_VARIANT: ReadingVariant = "real-reading";

export type CaptureSource = "console film mode" | "phone recording" | "Proof in the browser";

/** One recording F3 makes from the real product. `shows` is the on-screen state to record. */
export interface CaptureSlot {
  readonly id: string;
  readonly beat: string;
  readonly start: number;
  readonly duration: number;
  readonly source: CaptureSource;
  /** "MM-n on SCREEN" when a magic moment carries the slot; otherwise the screen and its state. */
  readonly state: string;
  /** The terminal data-moment-phase to record to, when `state` names a moment. */
  readonly phase: string | null;
  readonly persona: string | null;
  /** An on-screen title over the clip (the highlight reel names each feature in five words or fewer). */
  readonly label: string | null;
  /** The narration words the clip cuts in on; its start is the time they are said. Null when it is not cut to a word. */
  readonly word: string | null;
  /** Evidence lines held only while this clip plays (a beat's `show` holds for the whole beat). */
  readonly overlay: readonly string[];
  readonly shows: string;
  /** The research/design-1104 screenshot of this state on the real judge path, as evidence it exists. */
  readonly reference: string | null;
}

/** The exhibit caption C5d ships beside each R1 tile (HeroExhibits.tsx); only an exhibit slot may carry it. */
export const REAL_READING_CAPTION = "Claude's real reading of this slip, recorded 1 Nov 2026";
const STAND_IN_CHIP = "Seed stand-in, not a Claude recording";

type SlotText = Pick<CaptureSlot, "state" | "phase" | "shows" | "reference" | "overlay">;
interface Reading {
  readonly picture: string;
  readonly say: string;
  /** The narration words at which the film cuts from the first reading clip to slip 0462 by hand. */
  readonly cut: string;
  /** What must be true before this variant may be selected; null when nothing is needed. */
  readonly requires: string | null;
  readonly slot: SlotText;
  readonly byHand: Pick<CaptureSlot, "overlay">;
}
const BY_HAND_OVERLAY = [`This run · ${STAND_IN_CHIP}`, "Entered by Analyn, from logbook line 7"];
export const READING_VARIANTS: Readonly<Record<ReadingVariant, Reading>> = {
  "stand-in": {
    picture: "MM-2: the run's replay rows beside the slip crops; keep the seed chip visible.",
    say: "Claude is built to read every slip twice; this replay is a labelled stand-in. Analyn enters a stained digit by hand.",
    cut: "analyn",
    requires: null,
    slot: {
      state: "MM-2 on W-TR-03",
      phase: "landed",
      shows:
        "The reading room after the reading: every row of photo A printed, with the seed stand-in chip in frame.",
      reference: "05-W-TR-03-reading-done-1920.png",
      overlay: [STAND_IN_CHIP, "Replay of a seed stand-in"],
    },
    byHand: { overlay: BY_HAND_OVERLAY },
  },
  "real-reading": {
    picture:
      "Cut from the run to one tile of C5d's hero-slip exhibit; then slip 0462 by hand, whose own text reads 'Seed stand-in, not a Claude recording'.",
    say: "Claude's real reading of one slip. The run itself replays a labelled stand-in; Analyn types one stained digit by hand.",
    cut: "the run",
    requires:
      "R1's readings in packages/eval/recordings, dated 1 Nov 2026, and C5d's hero-slip exhibit in the reading room (HeroExhibits.tsx); both are on main at 2af75e6. Never use the seed run's date.",
    slot: {
      state: "Hero-slip exhibit tile 'Slip 0403, M-014' on W-TR-03",
      phase: null,
      shows:
        "Scroll the reading room to its hero-slip exhibit (W-TR-03.heroes) and frame the 'Slip 0403, M-014' tile with both of its captions (the R1 date line and the provisional, Codex-made image line) and its stand-in comparison row in frame. Never the slip 0449 tile.",
      reference: null,
      overlay: [
        REAL_READING_CAPTION,
        "A separate exhibit, not this run",
        "Codex-made synthetic slip image · labels agent-checked, provisional",
      ],
    },
    byHand: { overlay: BY_HAND_OVERLAY },
  },
};

export const FILM = {
  version: 4,
  duration: 175,
  title: "Fair Split: co-op payroll",
  firstCaption:
    "Simulated PayPal sandbox · Synthetic people and data · Demo runs: seed reading stand-in · Synthetic voices · Gemini TTS",
  endCard: [
    "Fair Split: co-op payroll",
    "Every peso, traced to the pencil mark.",
    "Simulated PayPal sandbox; untested against PayPal's own sandbox",
    "Synthetic people and data; no money moves",
    "Demo runs use a seed stand-in, not a Claude recording",
    "Music: “Machina” and “Aurora” by Scott Buckley · CC BY 4.0",
    "Cebuano: machine-translated, pending native review",
    "Synthetic voices · Gemini TTS",
  ],
  /** The end card's last line, held to the final frame: one wording for the voices everywhere (review v4 item 3). */
  voiceDisclosure: "Synthetic voices · Gemini TTS",
  /** The music's credit (CC BY 4.0): on the end card, and in full in CREDITS.txt for the upload's description. */
  musicCredit: "Music: “Machina” and “Aurora” by Scott Buckley · CC BY 4.0",
  /**
   * Her statement's language (review v5 item 3), one wording everywhere: the chip on the Paminawa transcript, the
   * statement's voice in the limits, the end card, the captions' bracket and the description. The product's own chip
   * reads "Machine-translated, pending native review" (apps/api statements REVIEW_CHIP).
   */
  translationDisclosure: "Cebuano: machine-translated, pending native review",
  descriptionDisclosure:
    "Synthetic voices · Gemini TTS: the narration (voice Charon) and the member's statement. Cebuano: machine-translated, pending native review. Synthetic people and data. Slip images are synthetic: Codex-made hero flats (OpenAI's image model) and code-drawn slips, composed in code into photos A–L. Simulated PayPal sandbox; untested against PayPal's own sandbox. Demo runs use a seed stand-in for the slip reading; Claude's only real readings are the hero-slip exhibit of 1 Nov 2026. The invoice is a seed-written placeholder, statements are hand-written templates, and the audit agent is paused.",
  capture: [
    "Local captures only; captions throughout, word for word with every spoken line.",
    "Sound (owner, 5 Nov; ADR-0018): Gemini TTS narration, voice Charon; Scott Buckley's “Machina” into “Aurora” (CC BY 4.0, credited) 18–22 dB under the voice; sparse CC0 sound effects. Record captures muted: the film adds its own cues. Member audio plays alone in its beat, with no music under it.",
    "Label accelerated waits ×12 real time. Never accelerate a person signing. Use the reduced-motion capture for any unasserted moment.",
    "Keep Simulated PayPal sandbox beside every PayPal-derived value, including phone, console and Proof crops.",
    "Seed-written invoice placeholder; statements are hand-written templates; audit agent paused.",
    "Persona lower thirds on deep-dive captures; Cebuano audio labelled Machine-translated, pending native review.",
    "No webhook-to-screen latency claim; confirmations come from status checks and simulator-signed webhooks.",
    "Show measured capture-run metrics only with a dated evidence receipt; otherwise omit the metrics panel.",
    "Cards and the architecture are original; every other picture is recorded from the real product.",
    "Answer the console's sound offer before recording (design-1104 observation 11).",
    "If no physical phone is paired on film day, record the member, listening and hl-member slots from console film mode's docked phone frame (as design-1104 does) and change their source; the Chair's co-sign stays a person on a phone.",
  ],
} as const;

export const CHAPTERS = [
  { start: 0, title: "The problem" },
  { start: 14, title: "How Fair Split solves it" },
  { start: 30, title: "Architecture" },
  { start: 44, title: "What's special on the site" },
  { start: 57, title: "The paper and the money" },
  { start: 73, title: "Read, check, count once" },
  { start: 92, title: "Holds and frozen rules" },
  { start: 102, title: "Two keys, then payouts" },
  { start: 121, title: "Proof and the member" },
  { start: 143, title: "Why it holds up" },
  { start: 154, title: "Limits and impact" },
] as const;

// Every timed reveal (card lines, architecture steps, reel cuts) lands on the narration words it belongs to, at the
// time the recorded voice says them (F4, ADR-0018), the same times the captions use.
const SAY = {
  problem:
    "Picture a co-op paying sixty-four cacao farmers from handwritten weigh-slips. A duplicate, or a fine no rule allows, goes unseen. Members can't check it. Nor can the buyer.",
  solution:
    "Fair Split: Claude reads the paper. Code computes every amount and holds what it can't justify. Two officers sign large batches. A simulated PayPal pays. The buyer re-checks everything.",
  architecture:
    "Slips go to Claude, then a deterministic engine; two keys sign. A PayPal invoice funds it; simulated PayPal Payouts pay members, safe to retry.",
  highlights:
    "Highlights: a split matrix that rebalances; a frozen rate card; two keys, one hash; proof in your browser; pay you can hear; Try to break it.",
  holds:
    "Two more holds go to a person. Analyn tries a deduction. Refused: the rate card was locked before the first slip.",
  impressive:
    "Underneath: over five thousand automated tests and three kill switches. Others we found share parts; none starts from a handwritten weigh-slip.",
  limits:
    "The limits: PayPal is a simulated sandbox; no real farmer was paid. Synthetic people and slips. A replayed stand-in. Gemini TTS voices.",
} as const;
type Timed = keyof typeof SAY;

// ------------------------------------------------------------------------------------- F4: the recorded voice
/**
 * The narration (ADR-0018): one Gemini TTS clip per beat, voice Charon, in `audio/narration/` (`manifest.json`,
 * written by `tools/narration.mjs`). `NARRATION_AT` is the edit: the film second each clip starts. The speech window
 * and every word's time come from the clip's measured speech and its offline alignment, so the captions, the card
 * lines, the architecture's steps and the reel's cuts land on the words as the voice says them.
 */
export const NARRATION_AT: Readonly<Record<string, number>> = {
  // the night shows only what the voice names (review v5 item 1): the duplicate (7.05 s), the fine (8.35 s),
  // "unseen." (10.0 s), the members fading, the buyer's invoice (13.1 s)
  problem: 1.4,
  solution: 14.35, // "Fair Split:" on the turn (14.45 s); the line ends before "Every peso, traced." (27.2 s)
  architecture: 30, // the line ends by 41 s, so the finished diagram holds 3 s
  highlights: 43.9, // "Try to break it" on the reel's night cut (55.1 s)
  paper: 58.4, // once the bumper's words have gone (review v5 item 10)
  funding: 65,
  reading: 73,
  "count-once": 83,
  holds: 92,
  signing: 102,
  payouts: 111,
  proof: 121,
  member: 129.1, // ends before her own sentence (134.36 s)
  impressive: 143.1, // "three kill switches" as the 3 arrives; "handwritten weigh-slip" as the hand's box closes
  limits: 154,
  end: 164.6, // a breath after the limits (review v5 item 10); "Every peso" as the end line lands (169.95 s)
};
/** One spoken word and when it is said, in film seconds. */
export interface SpokenWord {
  readonly w: string;
  readonly start: number;
  readonly end: number;
}
interface Clip {
  readonly beat: string;
  readonly speech: readonly [number, number];
  readonly text: string;
  readonly alignment: { readonly words: readonly SpokenWord[] } | null;
}
const narration: { readonly beats: readonly Clip[] } = JSON.parse(
  readFileSync(new URL("audio/narration/manifest.json", import.meta.url), "utf8"),
);
const r3 = (value: number) => Math.round(value * 1000) / 1000;
/** A beat's recorded speech window and word times, when its clip reads exactly this line; else null. */
function voiced(
  id: string,
  say: string,
): { speech: readonly [number, number]; words: readonly SpokenWord[] } | null {
  const clip = narration.beats.find((item) => item.beat === id);
  const from = NARRATION_AT[id];
  if (!clip?.alignment || from === undefined || clip.text !== say) return null;
  return {
    speech: [r3(from + clip.speech[0]), r3(from + clip.speech[1])],
    words: clip.alignment.words.map((w) => ({ w: w.w, start: r3(from + w.start), end: r3(from + w.end) })),
  };
}
/**
 * The member's own sentence (IC-11 PREMIUM.default for M-014 in Cebuano, Gemini TTS, 8.44 s): it plays alone in the
 * listening beat. Its speech runs 0.21-8.18 s in three phrases (silencedetect at -45 dB, 5 Nov); the captions time
 * each phrase's words by their letters, since no English transcriber reads Cebuano.
 */
export const MEMBER_AUDIO = {
  file: "media/audio/M-014/ceb/s03-PREMIUM-97d6108ac9e8.m4a",
  start: 134.15,
  duration: 8.44,
  phrases: [
    { words: 7, from: 0.21, to: 3.28 },
    { words: 5, from: 4.15, to: 6.89 },
    { words: 2, from: 7.23, to: 8.18 },
  ],
} as const;
function memberWords(say: string): readonly SpokenWord[] {
  const all = spoken(say);
  const out: SpokenWord[] = [];
  for (const phrase of MEMBER_AUDIO.phrases) {
    const words = all.slice(out.length, out.length + phrase.words);
    const letters = words.reduce((sum, w) => sum + w.length, 0);
    let t = MEMBER_AUDIO.start + phrase.from;
    const per = (phrase.to - phrase.from) / letters;
    for (const w of words) {
      out.push({ w, start: r3(t), end: r3(t + w.length * per) });
      t += w.length * per;
    }
  }
  if (out.length !== all.length) throw new Error("listening: the member's phrases do not cover her sentence");
  return out;
}
/** Placeholder windows for a line that has no recorded clip yet (word-proportional timing). */
const PLACEHOLDER: Readonly<Record<Timed, readonly [number, number]>> = {
  problem: [0, 14],
  solution: [14, 30],
  architecture: [30, 41],
  highlights: [44, 57],
  holds: [92, 102],
  impressive: [143, 154],
  limits: [154, 164],
};
const spoken = (say: string) => say.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
const bare = (word: string) => word.toLowerCase().replace(/^\W+/, "");
/**
 * The film second at which `phrase` (the first run of spoken words starting with its words) is said: the recorded
 * word's start when the beat has a voice, else word-proportional across the window.
 */
function timeOf(label: string, say: string, window: readonly [number, number], phrase: string): number {
  const words = spoken(say);
  const want = phrase.toLowerCase().split(/\s+/);
  const index = words.findIndex((_, i) => want.every((w, k) => bare(words[i + k] ?? "").startsWith(w)));
  if (index < 0) throw new Error(`${label}: "${phrase}" is not spoken`);
  const voice = voiced(label, say);
  const [start, end] = window;
  return Math.round((voice?.words[index]?.start ?? start + ((end - start) * index) / words.length) * 10) / 10;
}
const at = (beat: Timed, phrase: string) => timeOf(beat, SAY[beat], PLACEHOLDER[beat], phrase);
const tenths = (value: number) => Math.round(value * 10) / 10;

// F2 draws this SVG itself; text and connecting arrows, no third-party artwork or logos. It matches the code:
// packages/ai (ClaudeGateway) and the labelled seed replay, packages/domain (engine, I1), the two Ed25519 keys
// over batchSha256 and linesDigest (domain approval.ts) under rate-card rule R5's co-sign limits, packages/outbox,
// packages/paypal-toolkit (Agent Toolkit 1.11.0, Invoicing v2) and packages/paypal-payouts (our typed Payouts tool),
// the in-process simulator (ADR-0010), and paypal-core's verifier with W1's stored deliveries (ADR-0013).
// No hosting box: the hosted demo has no evidence yet (replan-1031 §6).
export const ARCHITECTURE = {
  format: "original-svg",
  boxes: [
    { id: "paper", label: "Handwritten slips, photographed" },
    { id: "read", label: "Claude reader / labelled seed replay" },
    { id: "engine", label: "Deterministic engine: every amount, every hold" },
    { id: "keys", label: "Treasurer + Chair (over the co-sign limits): two keys on one batch hash" },
    { id: "cash", label: "Cash at the bodega: same statement" },
    { id: "outbox", label: "Outbox: each PayPal call safe to retry" },
    { id: "tools", label: "Invoicing via PayPal Agent Toolkit · our typed Payouts tool" },
    { id: "paypal", label: "PayPal simulator" },
    { id: "confirmation", label: "Status checks; simulator-signed webhooks verified and stored" },
    { id: "surfaces", label: "Treasurer console · Member phone · Buyer's Proof" },
  ],
  arrows: [
    ["paper", "read"],
    ["read", "engine"],
    ["engine", "keys"],
    ["keys", "outbox"],
    ["keys", "cash"],
    ["outbox", "tools"],
    ["tools", "paypal"],
    ["paypal", "confirmation"],
    ["confirmation", "surfaces"],
    ["cash", "surfaces"],
  ],
  /** The animated build: each step adds its boxes and arrows when the narration reaches them. */
  reveal: [
    { at: 30, boxes: ["paper", "read"], arrows: [["paper", "read"]] },
    { at: at("architecture", "deterministic"), boxes: ["engine"], arrows: [["read", "engine"]] },
    {
      at: at("architecture", "keys"),
      boxes: ["keys", "cash"],
      arrows: [
        ["engine", "keys"],
        ["keys", "cash"],
      ],
    },
    {
      at: at("architecture", "a paypal"),
      boxes: ["outbox", "tools"],
      arrows: [
        ["keys", "outbox"],
        ["outbox", "tools"],
      ],
    },
    {
      at: at("architecture", "simulated"),
      boxes: ["paypal", "confirmation"],
      arrows: [
        ["tools", "paypal"],
        ["paypal", "confirmation"],
      ],
    },
    {
      at: at("architecture", "retry"),
      boxes: ["surfaces"],
      arrows: [
        ["confirmation", "surfaces"],
        ["cash", "surfaces"],
      ],
    },
  ],
} as const;

export interface CardItem {
  /** Absolute film second the line appears; it stays to the end of the beat. */
  readonly at: number;
  readonly text: string;
  readonly detail?: string;
}
/** An original card F2 draws: typography only, no screenshots, no product imitation. */
export interface FilmCard {
  readonly kind: "problem" | "solution" | "architecture" | "facts" | "limits" | "end";
  readonly heading: string;
  readonly kicker?: string;
  readonly items: readonly CardItem[];
}

export interface FilmBeat {
  readonly id: string;
  readonly part: PartId;
  readonly start: number;
  readonly end: number;
  /** When the narration is said (the recorded voice's first word to its last); captions and word times use it. */
  readonly speech?: readonly [number, number];
  /** Every spoken word of `say` and when the recorded voice says it (F4); absent until a beat has a voice. */
  readonly words?: readonly SpokenWord[];
  readonly picture: string;
  /** All audible words, including the member clip, count against the film's limits. */
  readonly say: string;
  /** Lines held for the whole beat; a line that belongs to one clip is that slot's `overlay`. */
  readonly show: readonly string[];
  readonly cues: readonly { readonly at: number; readonly picture: string }[];
  /** Present on original-card beats, which carry no capture slots. */
  readonly card?: FilmCard;
}

const SIM = "Simulated PayPal sandbox";
/** Reel cuts: each clip after the first cuts in on the words that name its feature. */
const REEL = [
  { id: "hl-matrix", word: "a split" },
  { id: "hl-ratecard", word: "a frozen" },
  { id: "hl-keys", word: "two keys" },
  { id: "hl-proof", word: "proof" },
  { id: "hl-member", word: "pay you" },
  { id: "hl-break", word: "try to" },
] as const;
const reelStart = (i: number) => (i === 0 ? 44 : at("highlights", REEL[i]?.word ?? ""));
/** Each beat with its recorded speech window and word times (the member's own sentence in the listening beat). */
function withVoice(beat: FilmBeat): FilmBeat {
  if (beat.id === "listening") {
    const words = memberWords(beat.say);
    return { ...beat, speech: [words[0]?.start ?? beat.start, words.at(-1)?.end ?? beat.end], words };
  }
  const voice = voiced(beat.id, beat.say);
  return voice ? { ...beat, speech: voice.speech, words: voice.words } : beat;
}
const readingCut = (variant: ReadingVariant) =>
  timeOf("reading", READING_VARIANTS[variant].say, [73, 83], READING_VARIANTS[variant].cut);
const holdsCut = at("holds", "analyn");
const PAYOUTS_SAY =
  "The simulated PayPal accepts the batch: sent, not yet paid. Seven items confirm; a member without PayPal moves to cash.";
/** The cut to cash lands on "a member without PayPal"; the console holds while its seven items confirm (review v5). */
const payoutsCut = timeOf("payouts", PAYOUTS_SAY, [111, 121], "a member");

export function beatsForReading(variant: ReadingVariant): readonly FilmBeat[] {
  const reading = READING_VARIANTS[variant];
  const timeline: readonly FilmBeat[] = [
    // ------------------------------------------------------------------ Part 1: overview, 0:00-0:57
    {
      id: "problem",
      part: "overview",
      start: 0,
      end: 14,
      picture:
        "Original problem card: the synthetic season in three figures, then each failure lands with the narration. Disclosures on the first caption rail.",
      say: SAY.problem,
      show: [FILM.firstCaption],
      cues: [],
      card: {
        kind: "problem",
        heading: "The problem",
        kicker: `A synthetic cacao co-op: ${figures.members} farmers · ${weighSlips} weigh-slips · one season's pay`,
        items: [
          { at: 0, text: "Pay is worked out from handwritten weigh-slips" },
          { at: at("problem", "duplicate"), text: "A duplicate pink copy counts one delivery twice" },
          { at: at("problem", "fine"), text: "A fine no rule allows still comes off the pay" },
          { at: at("problem", "members"), text: "Members can't check their own line" },
          { at: at("problem", "buyer"), text: "The buyer can't prove its premium reached the farmers" },
        ],
      },
    },
    {
      id: "solution",
      part: "overview",
      start: 14,
      end: 30,
      picture: "Original solution card: six numbered steps, each appearing as it is said.",
      say: SAY.solution,
      show: [SIM],
      cues: [],
      card: {
        kind: "solution",
        heading: "How Fair Split solves it",
        items: [
          {
            at: at("solution", "claude"),
            text: "Claude reads the handwriting",
            detail: "Real readings of ten hero slips, 1 Nov 2026; demo runs replay a labelled stand-in",
          },
          {
            at: at("solution", "code"),
            text: "Code computes every amount",
            detail: "and holds what it can't justify",
          },
          {
            at: at("solution", "two"),
            text: "Two officers sign one batch hash",
            detail: `over ${cosign} a batch or ${usd(rules.lineOverCents)} a line, or any override`,
          },
          {
            at: at("solution", "simulated"),
            text: "PayPal pays the members who have it",
            detail: `${figures.endPaidMembers} of ${figures.members} members have PayPal · ${SIM}`,
          },
          {
            // the 29-word line (AUDIO-CUES, ADR-0018) leaves cash to the card: it lands with "pays"
            at: at("solution", "pays"),
            text: "Cash members get the same statement",
            detail: `${figures.endCashMembers} in cash`,
          },
          {
            at: at("solution", "buyer"),
            text: "The buyer re-checks it all",
            detail: "in its own browser",
          },
        ],
      },
    },
    {
      id: "architecture",
      part: "overview",
      start: 30,
      end: 44,
      speech: PLACEHOLDER.architecture,
      picture:
        "Animate ARCHITECTURE as our own SVG: each reveal step adds its boxes and arrows when the narration names them; the finished diagram then holds in silence.",
      say: SAY.architecture,
      show: [SIM, "PayPal simulator"],
      cues: [],
      card: {
        kind: "architecture",
        heading: "Architecture",
        kicker: "Code computes · People approve · Simulator executes",
        items: [],
      },
    },
    {
      id: "highlights",
      part: "overview",
      start: 44,
      end: 57,
      picture:
        "Fast highlight reel from the real product, one labelled clip per feature, each cutting in as the narration names it.",
      say: SAY.highlights,
      show: [SIM],
      cues: [
        { at: reelStart(1), picture: "The rate card refuses a change after ratification." },
        { at: reelStart(2), picture: "Two keys on one batch hash, then the simulated PayPal fan-out." },
        { at: reelStart(3), picture: "Proof's six checks in the browser." },
        {
          at: reelStart(4),
          picture: "A peso tapped back to its slips, the statement's audio control in frame.",
        },
        { at: reelStart(5), picture: "Try to break it: an attack, refused." },
      ],
    },
    // ------------------------------------------------------------------ Part 2: deep dive, 0:57-2:34
    {
      id: "paper",
      part: "deep-dive",
      start: 57,
      end: 65,
      picture:
        "The problem in depth: the run's code-composed photos, then the white original beside its pink carbon copy.",
      say: "Each slip has a pink carbon copy. Photograph both, and it counts twice.",
      show: [],
      cues: [
        { at: 61, picture: "H1 opens: the white original beside the pink duplicate, four of four fields." },
      ],
    },
    {
      id: "funding",
      part: "deep-dive",
      start: 65,
      end: 73,
      picture: "MM-S: the invoice is marked paid on the simulated rail and the season reads funded.",
      say: "Lantern Bay, the chocolate buyer, pays one invoice through PayPal's Agent Toolkit, on a simulated sandbox.",
      show: [
        SIM,
        figures.display.invoice,
        "Seed-written invoice placeholder · Code computes the quote",
        "INVOICE.PAID · Simulated record-payment · Nothing starts until it reads paid",
      ],
      cues: [],
    },
    {
      id: "reading",
      part: "deep-dive",
      start: 73,
      end: 83,
      picture: reading.picture,
      say: reading.say,
      // Both reading labels are timed to their own clip (CAPTURES overlay), never held over the other one.
      show: [],
      cues: [
        {
          at: readingCut(variant),
          picture: "Analyn enters slip 0462's stained digit by hand from logbook page 14, line 7.",
        },
      ],
    },
    {
      id: "count-once",
      part: "deep-dive",
      start: 83,
      end: 92,
      picture:
        "MM-3: Count it once; the split grid re-sorts and the mass-balance dial falls inside the limit.",
      say: "Counted once, the duplicate's money returns to the other sixty-three members, and the dial drops inside the limit.",
      show: [
        "Slip 0457 · Counted once",
        `${usd(figures.redirectedDuplicateCents)} returned to 63 members`,
        `Shrink ${figures.display.shrinkTwice} → ${figures.display.shrinkOnce} · limit ${figures.display.tolerance}`,
      ],
      cues: [],
    },
    {
      id: "holds",
      part: "deep-dive",
      start: 92,
      end: 102,
      picture:
        "H2 and H3 decided by a person; then MM-4: a new deduction on the ratified rate card, refused by the server citing its hash.",
      say: SAY.holds,
      show: [],
      cues: [
        {
          at: at("holds", "refused"),
          picture: "MM-4: the bolted rate card refuses, citing its computed hash.",
        },
      ],
    },
    {
      id: "signing",
      part: "deep-dive",
      start: 102,
      end: 111,
      picture:
        "MM-5: Analyn holds to sign in the console; a real person co-signs as the Chair on a physical phone; both screens show the same batch hash.",
      say: "Above three hundred dollars, two keys: Analyn signs; the Chair co-signs the same batch hash on his phone.",
      show: [
        SIM,
        `Co-sign above ${cosign}`,
        `${figures.display.batchTotal} batch · Two people · One approved batch hash`,
        "Ed25519 over the batch and every line, cash lines too",
      ],
      cues: [
        { at: 106, picture: "The Chair's phone: hold Sign at real speed until it reads Napirmahan." },
        { at: 109.5, picture: "The console reads Approved by Analyn and Ernesto." },
      ],
    },
    {
      id: "payouts",
      part: "deep-dive",
      start: 111,
      end: 121,
      picture:
        "MM-6: hollow sent threads, confirmed items fill; Rhea parks with no PayPal account and moves to cash at the bodega.",
      say: PAYOUTS_SAY,
      show: [
        SIM,
        `${figures.display.batchTotal} batch · Sent is not paid`,
        "Status checks and simulator-signed webhooks confirm each item",
        figures.display.proofShare,
        `${figures.endCashMembers} in cash · Same statement`,
      ],
      cues: [{ at: payoutsCut, picture: "Rhea Jumawan parked; Pay in cash at the bodega; settled." }],
    },
    {
      id: "proof",
      part: "deep-dive",
      start: 121,
      end: 129,
      picture:
        "Dana opens Proof and presses Verify in your browser; six of six checks match and the verdict reads Sample.",
      say: "Lantern Bay opens Proof and re-checks the rate card, both signatures and every line.",
      show: [
        SIM,
        "Verify in your browser · Six checks",
        "Reads Sample: signed with sample keys, never Verified",
        `${figures.display.endPaid} simulated PayPal · ${figures.display.endCash} cash`,
      ],
      cues: [],
    },
    {
      id: "member",
      part: "deep-dive",
      start: 129,
      end: 134,
      picture: "MM-7: Nang Celing taps her net peso; it traces to the sum and her four slips.",
      say: "Her pay traces to four slips. It plays in Cebuano.",
      show: [SIM, `${usd(hero.netCents)} net · M-014`, "Slips 0403, 0419, 0436 and 0467"],
      cues: [],
    },
    {
      id: "listening",
      part: "deep-dive",
      start: 134,
      end: 143,
      picture:
        "The Paminawa transcript's premium line while only the matching IC-11 PREMIUM sentence plays, seeded demo plan. No narration.",
      // Exact PREMIUM.default spoken clip (8.44 s); English number words follow the approved statement renderer.
      say: "Premium gikan sa Lantern Bay Chocolate Co.: forty-three dollars and sixty-nine cents, walay kaltas.",
      show: [
        SIM,
        `${usd(hero.premiumCents)} premium · M-014`,
        `Premium from Lantern Bay Chocolate Co.: ${usd(hero.premiumCents)}, with no deductions.`,
        "Gemini TTS · Machine-translated, pending native review",
        "Hand-written statement template · Demo readings are a labelled stand-in",
      ],
      cues: [],
    },
    {
      id: "impressive",
      part: "deep-dive",
      start: 143,
      end: 154,
      picture:
        "Original facts card: what is tested, what stops it, and what is new, each line arriving with the narration.",
      say: SAY.impressive,
      show: [SIM],
      cues: [],
      card: {
        kind: "facts",
        heading: "Why it holds up",
        items: [
          {
            at: at("impressive", "over"),
            text: "More than 5,000 automated tests",
            detail: "5,016 Vitest cases (4 Nov) · Playwright end-to-end specs",
          },
          {
            at: at("impressive", "three"),
            text: "Three kill switches",
            detail: "payouts · simulated PayPal calls · slip reading",
          },
          {
            // The narrowed prior-art line (ADR-0017): the combination only, scoped to what the 4 Nov scan found.
            at: at("impressive", "none"),
            text: "None we found starts from a handwritten weigh-slip.",
            detail: "Others we found share parts, not the combination · 4 Nov scan",
          },
        ],
      },
    },
    // ------------------------------------------------------------------ Part 3: limits, impact, end, 2:34-2:55
    // The limits run 10 s (review v4 item 3: four objects, "generated." merged into "synthetic."); the 3 s they gave
    // up go to the end, so its line holds for 2.8 s (item 6).
    {
      id: "limits",
      part: "close",
      start: 154,
      end: 164,
      picture: "Original limits card; every disclosure on screen while it is said. No fabricated metrics.",
      say: SAY.limits,
      show: [SIM],
      cues: [],
      card: {
        kind: "limits",
        heading: "What is simulated, and what is real",
        items: [
          {
            at: at("limits", "paypal"),
            text: "Simulated PayPal sandbox; untested against PayPal's own sandbox",
          },
          // "generated." is merged into "synthetic." (review v4 item 3): people and slip images on one object pair
          { at: at("limits", "synthetic"), text: "Synthetic people and data; no money moves" },
          {
            at: at("limits", "synthetic"),
            text: "Slip images: Codex-made hero flats (OpenAI's image model); photos A–L composed in code",
          },
          {
            at: at("limits", "replayed"),
            text: "Your demo replays a labelled stand-in; Claude's real readings: ten hero slips, 1 Nov 2026",
          },
          {
            at: at("limits", "gemini"),
            // one wording (verify v5-r1): the film plays only Cebuano; Filipino is the product's, not the film's
            text: FILM.translationDisclosure,
          },
          { at: at("limits", "gemini"), text: FILM.voiceDisclosure },
        ],
      },
    },
    {
      id: "end",
      part: "close",
      start: 164,
      end: 175,
      picture: "End card: title, tagline and every disclosure; hold the voice disclosure to the final frame.",
      say: "Members check their own pay; the buyer traces its premium. Every peso, traced to the pencil mark.",
      show: [SIM, ...FILM.endCard],
      cues: [],
      card: { kind: "end", heading: FILM.title, kicker: FILM.endCard[1], items: [] },
    },
  ];
  return timeline.map(withVoice);
}

/** Every capture slot the beats need. Card beats need none; every other beat is covered end to end. */
export function capturesForReading(variant: ReadingVariant): readonly CaptureSlot[] {
  const reading = READING_VARIANTS[variant];
  const analyn = "Analyn · Treasurer · Synthetic persona";
  const celing = "Nang Celing · Member · Synthetic persona";
  const hash =
    "frame the shared first eight characters of the batch hash on both screens ('3f1c 1ce6' in design-1104)";
  const slot = (
    id: string,
    beat: string,
    start: number,
    end: number,
    source: CaptureSource,
    state: string,
    phase: string | null,
    persona: string | null,
    shows: string,
    reference: string | null,
    extra: Partial<Pick<CaptureSlot, "label" | "word" | "overlay">> = {},
  ): CaptureSlot => ({
    id,
    beat,
    start,
    duration: tenths(end - start),
    source,
    state,
    phase,
    persona,
    label: extra.label ?? null,
    word: extra.word ?? null,
    overlay: extra.overlay ?? [],
    shows,
    reference,
  });
  const reel = (i: number) => ({ start: reelStart(i), end: i + 1 < REEL.length ? reelStart(i + 1) : 57 });
  const clip = (i: number, label: string) => ({ label, word: REEL[i]?.word ?? null });
  const cut = readingCut(variant);
  return [
    // The highlight reel: short clips of the same real states the deep dive shows at length.
    slot(
      "hl-matrix",
      "highlights",
      reel(0).start,
      reel(0).end,
      "console film mode",
      "MM-3 on W-TR-06",
      "wave",
      null,
      `Crop to the mass-balance dial and the top grid rows: the 64-line split grid re-sorting as the dial falls from ${figures.display.shrinkTwice} to ${figures.display.shrinkOnce}.`,
      "10-W-TR-06-h1-count-once-mm3-0s7-1920.png",
      clip(0, "Split matrix rebalances · weight dial"),
    ),
    slot(
      "hl-ratecard",
      "highlights",
      reel(1).start,
      reel(1).end,
      "console film mode",
      "MM-4 on W-TR-02",
      "plate",
      null,
      "Crop to the refusal plate, scrolled into view: 'Refused by the server, citing the hash' on the bolted rate card.",
      "13-W-TR-02-rate-card-mm4-refusal-plate-scrolled-1920.png",
      clip(1, "Rate card refuses edits"),
    ),
    slot(
      "hl-keys",
      "highlights",
      reel(2).start,
      reel(2).end,
      "console film mode",
      "MM-6 on W-TR-08",
      "landing",
      null,
      `From key 2 ('Approved by Analyn and Ernesto'; ${hash}) to the fan-out's first hollow 'sent' threads beside the simulated PayPal log.`,
      "18-W-TR-08-just-after-key2-1920.png",
      clip(2, "Two keys → simulated PayPal payouts"),
    ),
    slot(
      "hl-proof",
      "highlights",
      reel(3).start,
      reel(3).end,
      "Proof in the browser",
      "Verify on W-PF-01",
      null,
      null,
      "Crop to the six checks and the Sample verdict: Proof after Verify in your browser, six of six match.",
      "22-W-PF-01-proof-after-verify-1920.png",
      clip(3, "Proof: six checks in-browser"),
    ),
    slot(
      "hl-member",
      "highlights",
      reel(4).start,
      reel(4).end,
      "phone recording",
      "IC-11 PREMIUM on M-MB-03 (Paminawa)",
      null,
      null,
      "Crop to the phone frame: Paminawa's premium line as it starts to play, the play control and the transcript in frame (review v6 F2: the reel previews hearing, not the trace).",
      null,
      clip(4, "Tap a peso · hear Cebuano"),
    ),
    slot(
      "hl-break",
      "highlights",
      reel(5).start,
      reel(5).end,
      "console film mode",
      "Try to break it on W-JG-01",
      null,
      null,
      "Crop to the attack row: 'Overcharge the invoice draft' answered DENY (invoiceEqualsQuote); nothing is sent.",
      "24-W-JG-01-try-to-break-it-amount-denied-1920.png",
      clip(5, "Try to break it"),
    ),
    // The deep dive.
    slot(
      "paper-photos",
      "paper",
      57,
      61,
      "console film mode",
      "Filmstrip on W-TR-03",
      null,
      null,
      `The reading room's filmstrip of photos ${photoRange}, four synthetic slips to a photo, with its 'Code-composed · synthetic' caption in frame.`,
      "05-W-TR-03-reading-done-1920.png",
      {
        overlay: [
          `This run: ${runPhotos.length} photos (${photoRange}), ${runSlips} slips · composed in code from synthetic slip images`,
        ],
      },
    ),
    slot(
      "paper-carbon",
      "paper",
      61,
      65,
      "console film mode",
      "MM-3 on W-TR-06",
      "ready",
      analyn,
      "H1 'Slip 0457 counted twice': the white original (photo B) beside the pink duplicate (photo D), four of four fields matching.",
      "09-W-TR-06-h1-open-1920.png",
      { overlay: ["Slip 0457 · white original (B) and pink duplicate (D)"] },
    ),
    slot(
      "funding-console",
      "funding",
      65,
      73,
      "console film mode",
      "MM-S on W-JG-01",
      "funded",
      analyn,
      "Mark Lantern Bay's invoice paid (simulated record-payment), then 'Season 2026-A is funded.' with the invoice-to-pool thread and the Funded stamp. Answer the sound offer before recording; crop to the season column or lower the Chair phone (until the console fixes design-1104 observation 2).",
      "03-W-JG-01-funded-1920.png",
    ),
    slot(
      "reading-console",
      "reading",
      73,
      cut,
      "console film mode",
      reading.slot.state,
      reading.slot.phase,
      analyn,
      reading.slot.shows,
      reading.slot.reference,
      { overlay: reading.slot.overlay },
    ),
    slot(
      "reading-byhand",
      "reading",
      cut,
      83,
      "console film mode",
      "MM-2 on W-TR-04",
      "done",
      analyn,
      "Slip 0462 by hand: its text reads 'Seed stand-in, not a Claude recording'; the field 6□.80 waits on a hidden digit; 'Use logbook line 7'; committed as 64.80, 'Entered by Analyn, from logbook line 7'.",
      "07-W-TR-04-byhand-0462-committed-1920.png",
      { word: reading.cut, overlay: reading.byHand.overlay },
    ),
    slot(
      "count-console",
      "count-once",
      83,
      92,
      "console film mode",
      "MM-3 on W-TR-06",
      "resolved",
      analyn,
      `Press 'Count it once': the grid re-sorts, the dial falls from ${figures.display.shrinkTwice} to ${figures.display.shrinkOnce}, and H1 reads 'Returned to 63 members'.`,
      "10-W-TR-06-h1-counted-once-1920.png",
    ),
    slot(
      "holds-console",
      "holds",
      92,
      holdsCut,
      "console film mode",
      "H2 and H3 on W-TR-06",
      null,
      analyn,
      "The end state: H3 returned as a ₱200 credit; the page reads 'Every hold is decided.'",
      "12-W-TR-06-h3-returned-credit-1920.png",
      {
        word: "two more",
        overlay: [
          "Hold 2 · 2.14 kg a tree, over the 1.6 limit · plot registered",
          `Hold 3 · ₱200 fine (multa) with no rule · returned as a ${usd(figures.creditsCents)} credit`,
        ],
      },
    ),
    slot(
      "rules-console",
      "holds",
      holdsCut,
      102,
      "console film mode",
      "MM-4 on W-TR-02",
      "done",
      analyn,
      "Open 'Add a deduction' (13-…-add-row), the bolted slab refuses (13-…-mm4-refusing), then the plate 'Refused by the server, citing the hash' scrolled into view (13-…-refusal-plate-scrolled).",
      "13-W-TR-02-rate-card-mm4-refusal-plate-scrolled-1920.png",
      {
        word: "analyn",
        overlay: ["Rules locked before the first slip · server refusal RATE_CARD_RATIFIED"],
      },
    ),
    slot(
      "signing-console",
      "signing",
      102,
      106,
      "console film mode",
      "MM-5 on W-TR-07",
      "signed-1",
      analyn,
      `Approve: the seal at 0 of 2 and ${figures.display.batchTotal}; hold 'Approve 8 payouts' until it reads Signed; the Chair phone rises; ${hash}.`,
      "15-W-TR-07-after-key1-1920.png",
    ),
    slot(
      "signing-phone",
      "signing",
      106,
      109.5,
      "phone recording",
      "MM-5 on M-BD-02",
      "inked",
      "Ernesto · Chair · Synthetic persona",
      `A person on a physical phone: 'Pirmahi ang batch' with the seal, the batch hash and ${figures.display.batchTotal} (${hash}); hold Sign at real speed until 'Napirmahan'.`,
      null,
    ),
    slot(
      "signing-approved",
      "signing",
      109.5,
      111,
      "console film mode",
      "MM-5 on W-TR-07",
      "signed-2",
      analyn,
      "The console reads 'Approved by Analyn and Ernesto'.",
      "17-M-BD-02-chair-signed-1920.png",
    ),
    slot(
      "payouts-console",
      "payouts",
      111,
      payoutsCut,
      "console film mode",
      "MM-6 on W-TR-08",
      "landing",
      analyn,
      "The fan-out: hollow 'sent' threads, then confirmed items fill; keep the simulated label beside the PayPal log.",
      "18-W-TR-08-fanout-midflight-top-1920.png",
    ),
    slot(
      "payouts-cash",
      "payouts",
      payoutsCut,
      121,
      "console film mode",
      "MM-6 on W-TR-08",
      "settled",
      analyn,
      `Rhea Jumawan 'Parked'; press 'Pay in cash at the bodega'; the run settles with '${figures.endCashMembers} in cash'.`,
      "20-W-TR-08-after-pay-in-cash-settled-1920.png",
    ),
    slot(
      "proof-browser",
      "proof",
      121,
      129,
      "Proof in the browser",
      "Verify on W-PF-01",
      null,
      "Dana · Lantern Bay · Synthetic persona",
      "Press 'Verify in your browser': six of six match; the verdict reads Sample, never Verified; checked at Davao time.",
      "22-W-PF-01-proof-after-verify-1920.png",
    ),
    slot(
      "member-phone",
      "member",
      129,
      134,
      "phone recording",
      "MM-7 on M-MB-01",
      // Bayad's MM-7 goes rest -> framed -> expanded (the product's own phases since UI round 4)
      "expanded",
      celing,
      `Nang Celing's statement, Bayad na, ${usd(hero.netCents)}; tap the net peso: the sum and slips 0403, 0419, 0436 and 0467.`,
      "21-M-MB-01-member-peso-mm7-traced-1920.png",
    ),
    slot(
      "listening-phone",
      "listening",
      134,
      143,
      "phone recording",
      "IC-11 PREMIUM on M-MB-03 (Paminawa)",
      null,
      celing,
      "The Paminawa transcript with the PREMIUM row current (data-state=current) while its clip plays; the scene's own overlay carries Gemini TTS and the machine-translation label.",
      null,
    ),
  ];
}

// E-19 reads this exported array's say/start/end fields; alternate takes use the same beat timeline.
export const beats = beatsForReading(READING_VARIANT);
export const CAPTURES = capturesForReading(READING_VARIANT);
