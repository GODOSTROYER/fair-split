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
    slipImages: number;
    photos: number;
    creditsCents: number;
    redirectedDuplicateCents: number;
    endPaidMembers: number;
    endCashMembers: number;
  };
  rateCard: { canonical: { rules: { cosign: { batchOverCents: number } } } };
  proof: { lines: readonly { memberNo: string; premiumCents: number; netCents: number }[] };
}
const seed: Seed = JSON.parse(
  readFileSync(new URL("../packages/seed/snapshot/season-2026A.json", import.meta.url), "utf8"),
);
const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;
const hero = seed.proof.lines.find((line) => line.memberNo === "M-014");
if (!hero) throw new Error("IC-03 hero line is missing");
const figures = seed.figures;
const cosign = usd(seed.rateCard.canonical.rules.cosign.batchOverCents);

/** The three parts the owner asked for, in order: understand it all in the first minute, then the depth. */
export const PARTS = [
  { id: "overview", title: "Overview: problem, solution, architecture, highlights", start: 0, end: 57 },
  { id: "deep-dive", title: "Deep dive: the problem, the product, why it holds up", start: 57, end: 154 },
  { id: "close", title: "Limits, impact and end card", start: 154, end: 175 },
] as const;
export type PartId = (typeof PARTS)[number]["id"];

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
  /** An on-screen title over the clip (the highlight reel names each feature). */
  readonly label: string | null;
  readonly shows: string;
  /** The research/design-1104 screenshot of this state on the real judge path, as evidence it exists. */
  readonly reference: string | null;
}

interface Reading {
  readonly picture: string;
  readonly say: string;
  readonly show: readonly string[];
  /** What must be true before this variant may be selected; null when nothing is needed. */
  readonly requires: string | null;
  readonly slot: Pick<CaptureSlot, "state" | "phase" | "shows" | "reference">;
}
export const READING_VARIANTS: Readonly<Record<ReadingVariant, Reading>> = {
  "stand-in": {
    picture: "MM-2: the run's replay rows beside the slip crops; keep the seed chip visible.",
    say: "Claude is built to read every slip twice; this replay is a labelled stand-in. Analyn enters a stained digit by hand.",
    show: ["Seed stand-in, not a Claude recording", "Replay of a seed stand-in"],
    requires: null,
    slot: {
      state: "MM-2 on W-TR-03",
      phase: "landed",
      shows:
        "The reading room after the reading: every row of photo A printed, with the seed stand-in chip in frame.",
      reference: "05-W-TR-03-reading-done-1920.png",
    },
  },
  "real-reading": {
    picture:
      "Cut from the run to one tile of C5d's hero-slip exhibit, then back to the run's own rows with the seed chip.",
    say: "Here is Claude's real reading of one slip. The run itself replays a labelled stand-in; Analyn enters a stained digit by hand.",
    show: [
      "Claude's real reading of this slip, recorded 1 Nov 2026",
      "Seed stand-in, not a Claude recording",
    ],
    requires:
      "R1's readings in packages/eval/recordings, dated 1 Nov 2026, and C5d's hero-slip exhibit in the reading room (HeroExhibits.tsx); both are on main at 2af75e6. Never use the seed run's date.",
    slot: {
      state: "Hero-slip exhibit on W-TR-03",
      phase: null,
      shows:
        "One tile of the reading room's R1 exhibit with its caption in frame, and its comparison row 'Seed stand-in, not a Claude recording'.",
      reference: null,
    },
  },
};

export const FILM = {
  version: 4,
  duration: 175,
  title: "Fair Split: co-op payroll",
  firstCaption:
    "Simulated PayPal sandbox · Synthetic people and data · Narration: Gemini TTS (synthetic voice)",
  endCard: [
    "Fair Split: co-op payroll",
    "Every peso, traced to the pencil mark.",
    "Simulated PayPal sandbox; untested against PayPal's own sandbox",
    "Synthetic people and data; no money moves",
    "Judge runs use a seed stand-in, not a Claude recording",
    "Narration and member audio: Gemini TTS (synthetic voices)",
  ],
  /** The end card's last line, held to the final frame. */
  voiceDisclosure: "Narration and member audio: Gemini TTS (synthetic voices)",
  descriptionDisclosure:
    "Narration and member audio: Gemini TTS. Synthetic people and data. Simulated PayPal sandbox; untested against PayPal's own sandbox. Judge runs use a seed stand-in for the slip reading; Claude's only real readings are the hero-slip exhibit of 1 Nov 2026.",
  capture: [
    "Local captures only; captions throughout, word for word with every spoken line.",
    "No music; mute product sound under narration. Member audio plays alone in its beat.",
    "Label accelerated waits ×12 real time. Never accelerate a person signing. Use the reduced-motion capture for any unasserted moment.",
    "Keep Simulated PayPal sandbox beside every PayPal-derived value, including phone, console and Proof crops.",
    "Seed-written invoice placeholder; statements are hand-written templates; audit agent paused.",
    "Persona lower thirds on deep-dive captures; Cebuano audio labelled Machine-translated, pending native review.",
    "No webhook-to-screen latency claim; confirmations come from status checks and simulator-signed webhooks.",
    "Show measured capture-run metrics only with a dated evidence receipt; otherwise omit the metrics panel.",
    "Cards and the architecture are original; every other picture is recorded from the real product.",
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

// Every timed reveal (card lines, architecture steps) lands on the narration word it belongs to, at the same
// word-proportional time the provisional captions use, so both move together when F4 aligns the narration.
const SAY = {
  problem:
    "Sixty-four cacao farmers are paid from handwritten weigh-slips. A duplicate copy, or a fine no rule allows, goes unseen. Members can't check their pay, and the buyer can't prove its premium arrived.",
  solution:
    "Fair Split: Claude reads the paper. Code computes every amount and holds what it can't justify. Two officers sign. PayPal pays, on a simulated sandbox; cash members get the same statement. The brand re-checks it all.",
  architecture:
    "Slips go to Claude, then a deterministic engine. Two keys sign the batch hash. A transactional outbox makes each PayPal call idempotent, against an in-process simulator whose signed webhooks we verify.",
  impressive:
    "Underneath: more than five thousand automated tests, idempotent PayPal calls, verified simulator webhooks, three kill switches, and replays always labelled.",
  limits:
    "The limits: PayPal runs on a simulated sandbox. People and data are synthetic; no real farmer was paid. Judge runs replay a labelled reading stand-in. Voices are Gemini TTS.",
} as const;
type Timed = keyof typeof SAY;
const BEAT_TIMES: Readonly<Record<Timed, readonly [number, number]>> = {
  problem: [0, 14],
  solution: [14, 30],
  architecture: [30, 44],
  impressive: [143, 154],
  limits: [154, 167],
};
const spoken = (say: string) => say.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word));
/** The film second at which `word` (the first spoken word starting with it) is said in `beat`. */
function at(beat: Timed, word: string): number {
  const words = spoken(SAY[beat]);
  const index = words.findIndex((w) => w.toLowerCase().replace(/^\W+/, "").startsWith(word.toLowerCase()));
  if (index < 0) throw new Error(`${beat}: "${word}" is not spoken`);
  const [start, end] = BEAT_TIMES[beat];
  return Math.round((start + ((end - start) * index) / words.length) * 10) / 10;
}

// F2 draws this SVG itself; text and connecting arrows, no third-party artwork or logos. It matches the code:
// packages/ai (ClaudeGateway) and the labelled seed replay, packages/domain (engine, I1), the two Ed25519 keys
// over batchSha256 and linesDigest (domain approval.ts), packages/outbox, packages/paypal-toolkit (Agent Toolkit
// 1.11.0, Invoicing v2), packages/paypal-payouts (our typed Payouts tool), the in-process simulator (ADR-0010),
// paypal-core's verifier and W1's stored deliveries (ADR-0013), and render.yaml (fs-api, fs-db, fs-cron).
export const ARCHITECTURE = {
  format: "original-svg",
  boxes: [
    { id: "paper", label: "Handwritten slips, photographed" },
    { id: "read", label: "Claude reader / labelled seed replay" },
    { id: "engine", label: "Deterministic engine: every amount, every hold" },
    { id: "keys", label: "Treasurer + Chair: two keys on one batch hash" },
    { id: "cash", label: "Cash at the bodega: same statement" },
    { id: "outbox", label: "Transactional outbox: idempotent effects" },
    { id: "invoice", label: "Invoicing via PayPal Agent Toolkit" },
    { id: "payouts", label: "Our typed Payouts tool" },
    { id: "paypal", label: "PayPal simulator" },
    { id: "confirmation", label: "Status checks; simulator-signed webhooks verified and stored" },
    { id: "surfaces", label: "Console / AG Grid · Member app · Proof in the browser" },
    { id: "host", label: "Render: fs-api with in-process simulator · Postgres · cron tick" },
  ],
  arrows: [
    ["paper", "read"],
    ["read", "engine"],
    ["engine", "keys"],
    ["keys", "outbox"],
    ["keys", "cash"],
    ["outbox", "invoice"],
    ["outbox", "payouts"],
    ["invoice", "paypal"],
    ["payouts", "paypal"],
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
      at: at("architecture", "transactional"),
      boxes: ["outbox", "invoice", "payouts"],
      arrows: [
        ["keys", "outbox"],
        ["outbox", "invoice"],
        ["outbox", "payouts"],
      ],
    },
    {
      at: at("architecture", "in-process"),
      boxes: ["paypal", "host"],
      arrows: [
        ["invoice", "paypal"],
        ["payouts", "paypal"],
      ],
    },
    {
      at: at("architecture", "signed"),
      boxes: ["confirmation", "surfaces"],
      arrows: [
        ["paypal", "confirmation"],
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
  readonly picture: string;
  /** All audible words, including the member clip, count against the film's limits. */
  readonly say: string;
  readonly show: readonly string[];
  readonly cues: readonly { readonly at: number; readonly picture: string }[];
  /** Present on original-card beats, which carry no capture slots. */
  readonly card?: FilmCard;
}

const SIM = "Simulated PayPal sandbox";

export function beatsForReading(variant: ReadingVariant): readonly FilmBeat[] {
  const reading = READING_VARIANTS[variant];
  return [
    // ------------------------------------------------------------------ Part 1: overview, 0:00-0:57
    {
      id: "problem",
      part: "overview",
      start: 0,
      end: 14,
      picture:
        "Original problem card: the season in three figures, then each failure lands with the narration. Disclosures on the first caption rail.",
      say: SAY.problem,
      show: [FILM.firstCaption],
      cues: [],
      card: {
        kind: "problem",
        heading: "The problem",
        kicker: `${figures.members} farmers · ${figures.slipImages} handwritten slip images · one season's pay`,
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
          { at: at("solution", "claude"), text: "Claude reads the handwriting" },
          {
            at: at("solution", "code"),
            text: "Code computes every amount",
            detail: "and holds what it can't justify",
          },
          { at: at("solution", "two"), text: "Two officers sign one batch hash", detail: `above ${cosign}` },
          {
            at: at("solution", "paypal"),
            text: "PayPal pays the members who have it",
            detail: `${figures.display.proofShare} · simulated sandbox`,
          },
          {
            at: at("solution", "cash"),
            text: "Cash members get the same statement",
            detail: `${figures.endCashMembers} in cash`,
          },
          {
            at: at("solution", "brand"),
            text: "The brand re-checks it all",
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
      picture:
        "Animate ARCHITECTURE as our own SVG: each reveal step adds its boxes and arrows when the narration names them.",
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
        "Fast highlight reel from the real product, one labelled clip per feature, in the order the narration names them.",
      say: "What's special: a split matrix that rebalances, a mass-balance dial, a rate card that refuses edits, two keys, browser-side proof, audio statements, and Try to break it.",
      show: [SIM],
      cues: [
        { at: 47, picture: "The rate card refuses a change after ratification." },
        { at: 49, picture: "Two keys on one batch hash." },
        { at: 51, picture: "Proof's six checks in the browser." },
        { at: 53, picture: "The member's Cebuano audio and a peso tapped back to its slip." },
        { at: 55, picture: "Try to break it: an attack, refused." },
      ],
    },
    // ------------------------------------------------------------------ Part 2: deep dive, 0:57-2:34
    {
      id: "paper",
      part: "deep-dive",
      start: 57,
      end: 65,
      picture:
        "The problem in depth: the photographed slips, then the white original beside its pink carbon copy.",
      say: "Each delivery gets a handwritten slip and a pink carbon copy. Photograph both, and it counts twice.",
      show: [
        `${figures.members} members · ${figures.slipImages} slip images · ${figures.photos} photos`,
        "Slip 0457 · white original (B) and pink duplicate (D)",
      ],
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
      say: "Lantern Bay funds the season with one invoice, through PayPal's Agent Toolkit on a simulated sandbox.",
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
      show: reading.show,
      cues: [
        {
          at: 78,
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
      say: "Count it once: the duplicate claim returns to sixty-three members, the grid rebalances, and the dial drops inside the limit.",
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
        "H2 and H3 decided in ink; then MM-4: a new deduction on the ratified rate card, refused by the server citing its hash.",
      say: "Two more holds, decided in ink. Then Analyn tries adding a deduction. Refused: the rate card was hashed before the first slip.",
      show: [
        "H2 · 2.14 kg a tree, limit 1.6 · plot registered",
        `H3 · ₱200 multa, no rule · returned as a ${usd(figures.creditsCents)} credit`,
        "Rules frozen before facts · RATE_CARD_RATIFIED",
      ],
      cues: [{ at: 97, picture: "MM-4: the bolted rate card refuses, citing its computed hash." }],
    },
    {
      id: "signing",
      part: "deep-dive",
      start: 102,
      end: 111,
      picture:
        "MM-5: Analyn holds to sign in the console; a real person co-signs as the Chair on a physical phone; both screens show the batch hash.",
      say: "Above three hundred dollars, two keys: Analyn holds to sign; the Chair co-signs the same batch hash on his phone.",
      show: [
        SIM,
        `Co-sign above ${cosign}`,
        `${figures.display.batchTotal} batch · Two people · One approved batch hash`,
        "Ed25519 over the batch and every line, cash lines too",
      ],
      cues: [
        {
          at: 106,
          picture: "The Chair's phone: hold Sign; the console reads Approved by Analyn and Ernesto.",
        },
      ],
    },
    {
      id: "payouts",
      part: "deep-dive",
      start: 111,
      end: 121,
      picture:
        "MM-6: hollow sent threads, confirmed items fill; Rhea parks with no PayPal account and moves to cash at the bodega.",
      say: "The simulated PayPal accepts the batch: sent, not yet paid. Seven items confirm; a member without PayPal moves to cash.",
      show: [
        SIM,
        `${figures.display.batchTotal} batch · Sent is not paid`,
        "Status checks and simulator-signed webhooks confirm each item",
        figures.display.proofShare,
        `${figures.endCashMembers} in cash · Same statement`,
      ],
      cues: [{ at: 116, picture: "Rhea Jumawan parked; Pay in cash at the bodega; settled." }],
    },
    {
      id: "proof",
      part: "deep-dive",
      start: 121,
      end: 129,
      picture:
        "Dana opens Proof and presses Verify in your browser; six of six checks match and the verdict reads Sample.",
      say: "Lantern Bay opens Proof and re-checks the rate card, both signatures and every line, in its own browser.",
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
      say: "A member taps a peso; it traces to her slips.",
      show: [SIM, `${usd(hero.netCents)} net · M-014`, "Slips 0403, 0419, 0436 and 0467"],
      cues: [],
    },
    {
      id: "listening",
      part: "deep-dive",
      start: 134,
      end: 143,
      picture:
        "The statement's premium line while only the matching IC-11 PREMIUM sentence plays, seeded demo plan. No narration.",
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
      picture: "Original facts card: what is tested and verified, each line arriving with the narration.",
      say: SAY.impressive,
      show: [SIM],
      cues: [],
      card: {
        kind: "facts",
        heading: "Why it holds up",
        // The narrowed prior-art line (ADR-0017): only the combination, held for the whole beat.
        kicker:
          "Prior art, re-scanned 4 Nov 2026: others share a part, not the combination. None we found starts from a handwritten weigh-slip.",
        items: [
          {
            at: at("impressive", "more"),
            text: "More than 5,000 automated tests",
            detail: "Vitest across the workspace, and 33 Playwright end-to-end tests",
          },
          {
            at: at("impressive", "idempotent"),
            text: "Idempotent PayPal calls",
            detail:
              "one fixed batch ID per run and a request ID hashed from it; a resent notice changes nothing",
          },
          {
            at: at("impressive", "verified"),
            text: "Simulator-signed webhooks, verified and stored",
            detail: "RSA-SHA256 over CRC32, against the simulator's own CA",
          },
          {
            at: at("impressive", "three"),
            text: "Three kill switches",
            detail: "payouts, simulated PayPal calls and live slip reading",
          },
          {
            at: at("impressive", "replays"),
            text: "Replays are labelled",
            detail: "and never counted as verified",
          },
        ],
      },
    },
    // ------------------------------------------------------------------ Part 3: limits, impact, end, 2:34-2:55
    {
      id: "limits",
      part: "close",
      start: 154,
      end: 167,
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
          {
            at: at("limits", "people"),
            text: "Synthetic people and data; no money moves; no real farmer was paid",
          },
          { at: at("limits", "judge"), text: "Judge runs use a seed stand-in, not a Claude recording" },
          {
            at: at("limits", "judge"),
            text: "Claude's only real readings here: the ten hero slips, 1 Nov 2026 (R1)",
          },
          {
            at: at("limits", "judge"),
            text: "Seed-written invoice placeholder; hand-written statement templates; audit agent paused",
          },
          {
            at: at("limits", "voices"),
            text: "Cebuano and Filipino are machine-translated, pending native review",
          },
          { at: at("limits", "voices"), text: FILM.voiceDisclosure },
        ],
      },
    },
    {
      id: "end",
      part: "close",
      start: 167,
      end: 175,
      picture: "End card: title, tagline and every disclosure; hold the voice disclosure to the final frame.",
      say: "Members check their own pay; the brand traces its premium. Every peso, traced to the pencil mark.",
      show: [SIM, ...FILM.endCard],
      cues: [],
      card: { kind: "end", heading: FILM.title, kicker: FILM.endCard[1], items: [] },
    },
  ];
}

/** Every capture slot the beats need. Card beats need none; every other beat is covered end to end. */
export function capturesForReading(variant: ReadingVariant): readonly CaptureSlot[] {
  const reading = READING_VARIANTS[variant].slot;
  const analyn = "Analyn · Treasurer · Synthetic persona";
  const celing = "Nang Celing · Member · Synthetic persona";
  const slot = (
    id: string,
    beat: string,
    start: number,
    duration: number,
    source: CaptureSource,
    state: string,
    phase: string | null,
    persona: string | null,
    shows: string,
    reference: string | null,
    label: string | null = null,
  ): CaptureSlot => ({ id, beat, start, duration, source, state, phase, persona, label, shows, reference });
  return [
    // The highlight reel: short clips of the same real states the deep dive shows at length.
    slot(
      "hl-matrix",
      "highlights",
      44,
      3,
      "console film mode",
      "MM-3 on W-TR-06",
      "wave",
      null,
      `The 64-line split grid re-sorting as the mass-balance dial falls from ${figures.display.shrinkTwice} to ${figures.display.shrinkOnce}.`,
      "10-W-TR-06-h1-count-once-mm3-0s7-1920.png",
      "Split matrix (AG Grid) rebalances · mass-balance dial",
    ),
    slot(
      "hl-ratecard",
      "highlights",
      47,
      2,
      "console film mode",
      "MM-4 on W-TR-02",
      "plate",
      null,
      "The refusal plate 'Refused by the server, citing the hash' landing on the bolted rate card.",
      "13-W-TR-02-rate-card-mm4-refusal-plate-1920.png",
      "The rate card refuses a change after ratification",
    ),
    slot(
      "hl-keys",
      "highlights",
      49,
      2,
      "console film mode",
      "MM-5 on M-BD-02",
      "signed-2",
      null,
      "The Chair frame's batch hash beside the console's 'Approved by Analyn and Ernesto'.",
      "17-M-BD-02-chair-signed-1920.png",
      "Two keys on one batch hash",
    ),
    slot(
      "hl-proof",
      "highlights",
      51,
      2,
      "Proof in the browser",
      "Verify on W-PF-01",
      null,
      null,
      "Proof after Verify in your browser: six of six checks match.",
      "22-W-PF-01-proof-after-verify-1920.png",
      "Proof: six checks in your browser",
    ),
    slot(
      "hl-member",
      "highlights",
      53,
      2,
      "phone recording",
      "MM-7 on M-MB-01",
      "zoomed",
      null,
      "A tapped peso traced to its four slips, with the statement's audio control in frame.",
      "21-M-MB-01-member-peso-mm7-traced-1920.png",
      "Cebuano audio · tap a peso back to its slip",
    ),
    slot(
      "hl-break",
      "highlights",
      55,
      2,
      "console film mode",
      "Try to break it on W-JG-01",
      null,
      null,
      "'Overcharge the invoice draft' answered DENY (invoiceEqualsQuote); nothing is sent.",
      "24-W-JG-01-try-to-break-it-amount-denied-1920.png",
      "Try to break it",
    ),
    // The deep dive.
    slot(
      "paper-photos",
      "paper",
      57,
      4,
      "console film mode",
      "Filmstrip on W-TR-03",
      null,
      null,
      "The reading room's filmstrip of photographed weigh-slips, four slips to a photo.",
      "05-W-TR-03-reading-done-1920.png",
    ),
    slot(
      "paper-carbon",
      "paper",
      61,
      4,
      "console film mode",
      "MM-3 on W-TR-06",
      "ready",
      analyn,
      "H1 'Slip 0457 counted twice': the white original (photo B) beside the pink duplicate (photo D), four of four fields matching.",
      "09-W-TR-06-h1-open-1920.png",
    ),
    slot(
      "funding-console",
      "funding",
      65,
      8,
      "console film mode",
      "MM-S on W-JG-01",
      "funded",
      analyn,
      "Mark Lantern Bay's invoice paid (simulated record-payment), then 'Season 2026-A is funded.' with the invoice-to-pool thread and the Funded stamp.",
      "03-W-JG-01-funded-1920.png",
    ),
    slot(
      "reading-console",
      "reading",
      73,
      5,
      "console film mode",
      reading.state,
      reading.phase,
      analyn,
      reading.shows,
      reading.reference,
    ),
    slot(
      "reading-byhand",
      "reading",
      78,
      5,
      "console film mode",
      "MM-2 on W-TR-04",
      "done",
      analyn,
      "Slip 0462 by hand: the field 6□.80 waits on a hidden digit; 'Use logbook line 7'; committed as 64.80, 'Entered by Analyn, from logbook line 7'.",
      "07-W-TR-04-byhand-0462-committed-1920.png",
    ),
    slot(
      "count-console",
      "count-once",
      83,
      9,
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
      5,
      "console film mode",
      "H2 and H3 on W-TR-06",
      null,
      analyn,
      "H2 'more than the plot can grow', Register a plot; H3 'A deduction with no rule on slip 0458', Return the ₱200 as a credit; then 'Every hold is decided.'",
      "12-W-TR-06-h3-returned-credit-1920.png",
    ),
    slot(
      "rules-console",
      "holds",
      97,
      5,
      "console film mode",
      "MM-4 on W-TR-02",
      "done",
      analyn,
      "Add a deduction on the rate card; the bolted slab refuses and the plate reads 'Refused by the server, citing the hash' (RATE_CARD_RATIFIED).",
      "13-W-TR-02-rate-card-mm4-refusal-plate-scrolled-1920.png",
    ),
    slot(
      "signing-console",
      "signing",
      102,
      4,
      "console film mode",
      "MM-5 on W-TR-07",
      "signed-1",
      analyn,
      `Approve: the seal at 0 of 2 and ${figures.display.batchTotal}; hold 'Approve 8 payouts' until it reads Signed; the Chair phone rises.`,
      "15-W-TR-07-after-key1-1920.png",
    ),
    slot(
      "signing-phone",
      "signing",
      106,
      5,
      "phone recording",
      "MM-5 on M-BD-02",
      "inked",
      "Ernesto · Chair · Synthetic persona",
      `A person holds Sign on a physical phone: 'Pirmahi ang batch' with the seal, the batch hash and ${figures.display.batchTotal}; the console then reads 'Approved by Analyn and Ernesto'.`,
      "17-M-BD-02-chair-signed-1920.png",
    ),
    slot(
      "payouts-console",
      "payouts",
      111,
      5,
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
      116,
      5,
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
      8,
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
      5,
      "phone recording",
      "MM-7 on M-MB-01",
      "zoomed",
      celing,
      `Nang Celing's statement, Bayad na, ${usd(hero.netCents)}; tap the net peso: the sum and slips 0403, 0419, 0436 and 0467.`,
      "21-M-MB-01-member-peso-mm7-traced-1920.png",
    ),
    slot(
      "listening-phone",
      "listening",
      134,
      9,
      "phone recording",
      "IC-11 PREMIUM on M-MB-01",
      null,
      celing,
      "The statement's premium line while its Cebuano PREMIUM clip plays, the Gemini TTS and machine-translation labels in frame.",
      "21-M-MB-01-member-receipt-before-tap-1920.png",
    ),
  ];
}

// E-19 reads this exported array's say/start/end fields; alternate takes use the same timeline.
export const beats = beatsForReading(READING_VARIANT);
export const CAPTURES = capturesForReading(READING_VARIANT);
