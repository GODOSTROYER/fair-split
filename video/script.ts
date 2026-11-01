// F1, script v3. Plan timeline; replan-1031 §6 and ADR-0002/0010 govern every claim.
// Script data only: F2 assembles local captures, F4 makes the Gemini narration. No remote IO.
import { readFileSync } from "node:fs";

interface Seed {
  figures: {
    display: { invoice: string; batchTotal: string; proofShare: string; endPaid: string; endCash: string };
    redirectedDuplicateCents: number;
    endCashMembers: number;
  };
  rateCard: { canonical: { rules: { cosign: { batchOverCents: number } } } };
  proof: { lines: readonly { memberNo: string; premiumCents: number }[] };
}
const seed: Seed = JSON.parse(
  readFileSync(new URL("../packages/seed/snapshot/season-2026A.json", import.meta.url), "utf8"),
);
const usd = (cents: number) => `US$${(cents / 100).toFixed(2)}`;
const hero = seed.proof.lines.find((line) => line.memberNo === "M-014");
if (!hero) throw new Error("IC-03 hero line is missing");
const heroPremiumCents = hero.premiumCents;

export type ReadingVariant = "stand-in" | "real-reading";
// The sole editorial switch. Select the exhibit only after its evidence requirement is met.
export const READING_VARIANT: ReadingVariant = "stand-in";

interface Reading {
  readonly picture: string;
  readonly say: string;
  readonly show: readonly string[];
  readonly requires: string | null;
}
export const READING_VARIANTS: Readonly<Record<ReadingVariant, Reading>> = {
  "stand-in": {
    picture: "MM-2: replay rows print beside the slip crops; keep the seed chip visible.",
    say: "Claude is built to read every slip twice; this replay is a labelled stand-in. Analyn checks the stained digit.",
    show: ["Seed stand-in, not a Claude recording", "Replay of a seed stand-in"],
    requires: null,
  },
  "real-reading": {
    picture: "Cut away from the run to C5d's hero-flat tile and R1's reading of that same slip.",
    say: "A real Claude reading, in its own exhibit. The run remains a labelled stand-in; Analyn checks the stained digit.",
    show: [
      "Claude's real reading of this slip, recorded {date}; the run is a seed stand-in, not a Claude recording.",
    ],
    requires:
      "R1 evidence and C5d exhibit shipped; replace {date} with the exhibit's verified recording date before capture. Never use the seed run date.",
  },
};

export const FILM = {
  version: 3,
  duration: 170,
  title: "Fair Split: co-op payroll",
  firstCaption:
    "Simulated PayPal sandbox · Synthetic people and data · Narration: Gemini TTS (synthetic voice)",
  endCard: [
    "Fair Split: co-op payroll",
    "Every peso, traced to the pencil mark.",
    "Simulated PayPal sandbox; untested against PayPal's own sandbox",
    "Synthetic people and data; no money moves",
    "Narration and member audio: Gemini TTS (synthetic voices)",
  ],
  descriptionDisclosure:
    "Narration and member audio: Gemini TTS. Synthetic people and data. Simulated PayPal sandbox; untested against PayPal's own sandbox. Judge readings are a seed stand-in.",
  capture: [
    "Local captures only; captions throughout, word for word with every spoken line.",
    "No music; mute product sound under narration. Member audio plays alone in its beat.",
    "Label accelerated waits ×12 real time. Use the reduced-motion capture for any unasserted moment.",
    "Keep Simulated PayPal sandbox beside every PayPal-derived value, including phone, console and Proof crops.",
    "Seed-written invoice placeholder; statements are hand-written templates; audit agent paused.",
    "Persona lower thirds from the funding beat; Cebuano audio labelled Machine-translated, pending native review.",
    "Use status-check confirmation wording until W1 is verified; no webhook-to-screen latency claim.",
    "Show measured capture-run metrics only with a dated evidence receipt; otherwise omit the metrics panel.",
  ],
} as const;

export const CHAPTERS = [
  { start: 0, title: "Every peso, traced" },
  { start: 20, title: "Fund the run" },
  { start: 32, title: "Read and check" },
  { start: 44, title: "Count it once" },
  { start: 56, title: "Rules before facts" },
  { start: 70, title: "Two keys" },
  { start: 84, title: "Sent, then confirmed" },
  { start: 102, title: "Verify in your browser" },
  { start: 120, title: "Listen to the line" },
  { start: 132, title: "How it works and its limits" },
] as const;

// F2 draws this SVG itself; text and connecting arrows, no third-party artwork or logos.
export const ARCHITECTURE = {
  format: "original-svg",
  boxes: [
    { id: "paper", label: "Handwritten slips" },
    { id: "read", label: "Claude reader / labelled seed replay" },
    { id: "engine", label: "Deterministic engine: all amounts" },
    { id: "keys", label: "Treasurer + Chair: batch digest" },
    { id: "outbox", label: "Transactional outbox: idempotent effects" },
    { id: "invoice", label: "Invoicing via PayPal Agent Toolkit" },
    { id: "payouts", label: "Our typed Payouts tool" },
    { id: "paypal", label: "PayPal simulator" },
    { id: "confirmation", label: "Status checks; simulator-signed webhooks verified and recorded" },
    { id: "surfaces", label: "Console / AG Grid · App · Proof" },
    { id: "host", label: "Render: API + inline executor + Postgres" },
  ],
  arrows: [
    ["paper", "read"],
    ["read", "engine"],
    ["engine", "keys"],
    ["keys", "outbox"],
    ["outbox", "invoice"],
    ["outbox", "payouts"],
    ["invoice", "paypal"],
    ["payouts", "paypal"],
    ["paypal", "confirmation"],
    ["confirmation", "surfaces"],
  ],
} as const;

export interface FilmBeat {
  readonly id: string;
  readonly start: number;
  readonly end: number;
  readonly picture: string;
  /** All audible words, including the member clip, count against the film's limits. */
  readonly say: string;
  readonly show: readonly string[];
  readonly cues: readonly { readonly at: number; readonly picture: string }[];
}

export function beatsForReading(variant: ReadingVariant): readonly FilmBeat[] {
  const reading = READING_VARIANTS[variant];
  return [
    {
      id: "arrival",
      start: 0,
      end: 9,
      picture:
        "MM-1: Nang Celing's phone, Bayad na; crop the confirmed statement, not a latency demonstration.",
      say: "",
      show: [
        "Simulated PayPal sandbox",
        FILM.firstCaption,
        "PAYOUTS-ITEM.SUCCEEDED, simulator-signed, signature verified; item status confirmed by a status check",
      ],
      cues: [],
    },
    {
      id: "title",
      start: 9,
      end: 20,
      picture: "Title lockup; Analyn beside handwritten cacao weigh-slips. Synthetic persona lower third.",
      say: "At this cacao co-op, a season's pay starts as handwritten weigh-slips. Every mark needs a reason; every amount needs proof.",
      show: [FILM.title, "Analyn · Treasurer · Synthetic persona"],
      cues: [],
    },
    {
      id: "funding",
      start: 20,
      end: 32,
      picture:
        "MM-S in Console: seed-written invoice placeholder, record-payment arc and one overcharge DENY row.",
      say: "Lantern Bay funds one invoice through PayPal's Agent Toolkit, on a simulated PayPal sandbox. Nothing starts until it reads paid.",
      show: [
        "Simulated PayPal sandbox",
        seed.figures.display.invoice,
        "Seed-written placeholder · Code computes the quote",
        "INVOICE.PAID · Simulated record-payment",
      ],
      cues: [],
    },
    {
      id: "reading",
      start: 32,
      end: 44,
      picture: reading.picture,
      say: reading.say,
      show: reading.show,
      cues: [
        {
          at: 42,
          picture:
            "Analyn enters field 0462 by hand from logbook page 14, line 7; keep the replay label visible.",
        },
      ],
    },
    {
      id: "duplicate",
      start: 44,
      end: 56,
      picture:
        "MM-3: original and pink copy overlap; Count it once, then the AG Grid wave and mass-balance dial.",
      say: "The original and its pink copy: one slip. Count it once, remove the duplicate claim, and watch the grid rebalance.",
      show: [
        "Slip 0457 · Counted once",
        `${usd(seed.figures.redirectedDuplicateCents)} duplicate claim removed`,
      ],
      cues: [],
    },
    {
      id: "rules",
      start: 56,
      end: 70,
      picture: "Resolve H2's plot evidence and H3's unruled multa in ink; then attempt a new deduction.",
      say: "Holds resolved in ink. Analyn tries adding a deduction. The rate card was hashed before the first slip. Refused.",
      show: ["Rules frozen before facts"],
      cues: [
        { at: 64, picture: "MM-4: bolted rate card; RATE_CARD_RATIFIED refusal citing its computed hash." },
      ],
    },
    {
      id: "signing",
      start: 70,
      end: 84,
      picture:
        "MM-5: Analyn holds to sign; the human Chair co-signs on a physical phone; show matching batch digests.",
      say: "Above the threshold, a second key. Analyn holds to sign; the Chair signs on his phone. Both sign one batch hash.",
      show: [
        `Co-sign above ${usd(seed.rateCard.canonical.rules.cosign.batchOverCents)}`,
        "Two people · One approved batch digest",
      ],
      cues: [],
    },
    {
      id: "payouts",
      start: 84,
      end: 102,
      picture:
        "MM-6: hollow sent fan, confirmed items fill; Rhea parked, cancelled and returned to cash; resend a duplicate.",
      say: "The simulated PayPal accepts the batch: sent, not yet paid. Status checks confirm each item. An unclaimed member moves to cash. Repeats change nothing.",
      show: [
        "Simulated PayPal sandbox",
        `${seed.figures.display.batchTotal} batch · Sent is not paid`,
        seed.figures.display.proofShare,
        `${seed.figures.endCashMembers} cash · Same statement`,
      ],
      cues: [],
    },
    {
      id: "proof",
      start: 102,
      end: 120,
      picture:
        "Dana verifies Proof locally in her browser; rate card, signatures, lines and conservation show Matches.",
      say: "Lantern Bay re-checks the rate card, signatures, and every line in its browser. PayPal and cash share one statement.",
      show: [
        "Simulated PayPal sandbox",
        `${seed.figures.display.endPaid} simulated PayPal · ${seed.figures.display.endCash} cash`,
        "Verify in your browser",
      ],
      cues: [],
    },
    {
      id: "listening",
      start: 120,
      end: 132,
      picture:
        "MM-7: Nang Celing taps her premium; slip chip rises. Play only the matching IC-11 PREMIUM sentence, seeded demo plan.",
      // Exact PREMIUM.default spoken clip; English number words follow the approved statement renderer.
      say: "Premium gikan sa Lantern Bay Chocolate Co.: forty-three dollars and sixty-nine cents, walay kaltas.",
      show: [
        "Simulated PayPal sandbox",
        `${usd(heroPremiumCents)} premium · M-014`,
        `Premium from Lantern Bay Chocolate Co.: ${usd(heroPremiumCents)}, with no deductions.`,
        "Gemini TTS · Machine-translated, pending native review",
        "Hand-written statement template · Demo readings are a labelled stand-in",
      ],
      cues: [],
    },
    {
      id: "architecture",
      start: 132,
      end: 154,
      picture:
        "Draw ARCHITECTURE as our own SVG. Finish on the prior-art distinction; show only dated, verified test metrics.",
      say: "Our typed Payouts tool, simulator-signed webhooks, and code computing every amount. Similar projects protect a payer or contract. Fair Split protects the people being paid.",
      show: [
        "Simulated PayPal sandbox",
        "PayPal simulator",
        "Code computes · People approve · Simulator executes",
      ],
      cues: [],
    },
    {
      id: "limits",
      start: 154,
      end: 170,
      picture:
        "Limits card, then end card; hold the voice disclosure to the final frame. No fabricated metrics.",
      say: "A prototype on a simulated PayPal sandbox, with synthetic people. No money moves. Code computes. People approve. Every peso, traced to the pencil mark.",
      show: ["Simulated PayPal sandbox", ...FILM.endCard],
      cues: [],
    },
  ];
}

// E-19 reads this exported array's say/start/end fields; alternate takes use the same timeline.
export const beats = beatsForReading(READING_VARIANT);
