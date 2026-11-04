// Stage and chrome copy that @fairsplit/i18n does not carry yet, in the console's English (S1.11: sentence
// case, no exclamation marks, outcomes on buttons, the co-op's own words). Figures come from the snapshot,
// never from here. PayPal wording follows the rail (ADR-0002): under the simulator nothing says "real" or
// "verified" about PayPal, and nothing says "live" about sandbox activity (S1.11's word list). These keys
// move into @fairsplit/i18n (WS-DS) under W-JG-01.* when it adds them.

import type { PaypalRail } from "../lib/env.js";

export const WORDMARK = { name: "Fair Split", qualifier: "co-op payroll" } as const;

/** The stage's one-line story: no longer printed (UI gate round 2), kept as the bar's title for the lockup. */
export function story(members: number): string {
  return `A cacao co-op pays ${members} farmers from one brand invoice.`;
}

/**
 * The stage bar's honesty line (I8), one line beside the run pill: how PayPal runs here, in ink, then the
 * promise about replays. The contract-testing detail lives in What's real, linked beside it.
 */
export function railNotice(rail: PaypalRail): { readonly lead: string; readonly rest: string } {
  return rail === "simulator"
    ? { lead: "Simulated PayPal sandbox.", rest: "Anything replayed says so." }
    : { lead: "PayPal sandbox (untested in this build).", rest: "Anything replayed says so." };
}

/**
 * The honesty tag's words in the top bar, beside the Proof counter (UI gate round 2): the label alone, never a
 * sentence. Under the simulator it is the pinned "Simulated PayPal sandbox".
 */
export function railTag(rail: PaypalRail): string {
  return rail === "simulator" ? "Simulated PayPal sandbox" : "PayPal sandbox, untested in this build";
}

export function railLine(rail: PaypalRail): string {
  const { lead, rest } = railNotice(rail);
  return `${lead} ${rest}`;
}

export function stageCaption(_recordedOn: string): string {
  return "Synthetic co-op, people and slips. Seed stand-in, not a Claude recording.";
}

export const MOCK_DATA = {
  chip: "Mock data",
  note: "This build answers from a mock of the API over the seeded season. Nothing reaches PayPal or Claude.",
} as const;

/** The run log's rows (UI gate round 3: one toast and the Log sheet replace the ribbon): the zone, PayPal's notices. */
export const RIBBON = {
  /** Philippine time, the co-op's wall clock (Davao). */
  zone: "PHT",
  seeded: "Seed stand-in",
  seededTitle: "Seed stand-in, not a Claude recording",
  notice: (what: string) => `Notice: ${what}`,
} as const;

/** The top bar's Log: the whole timeline, newest first, behind one icon (round 3). */
export const LOG = {
  open: "Log",
  title: "Run log",
  close: "Close",
  empty: "Nothing yet.",
  /** The toast's landmark name, for assistive technology. */
  toast: "Latest event",
} as const;

/** How long one event's toast stays (round 3: 3 s, then it goes; the Log keeps everything). */
export const TOAST_MS = 3000;

/** The phone's 56 px rail (round 3): the phone glyph expands it, the avatars pick a frame. */
export const PHONE_RAIL = {
  name: "Phone",
  expand: "Show the phone",
  collapse: "Hide the phone",
} as const;

export const STAGE = {
  whatsReal: "What's real",
  zone: "Davao time",
  soundOn: "Sound on",
  soundOff: "Sound off",
  reset: "Reset",
  /** The top bar's short Proof counter: "Proof 0/8", or "Proof replayed" on a replayed run. */
  proof: "Proof",
  proofReplayed: "replayed",
  resetting: "Starting a fresh run. About 10 s.",
  skip: "Skip to the screen",
  /** The phone visit's heading, for assistive technology: the statement under it is the page. */
  phoneVisitTitle: "Fair Split: a member's statement",
  phoneVisitLine: "Best on a laptop",
  phoneVisitPx: "≥ 1024 px",
  /** The laptop line's title: what the full stage is. */
  phoneVisitBody: "The full stage: the co-op's console with the member's phone beside it.",
  phoneVisitCopy: "Copy the link",
  phoneVisitCopied: "Copied",
  frameAsleep: "The app's web build isn't answering on this server.",
  frameAsleepDetail:
    "fs-api serves it at /app. Until it loads, this is what the phone would show, from the seeded run.",
  framePreview: "A preview drawn from the run on the stage. The app's web build loads here.",
  frameStub: "Development stand-in for the app at /app. The preview shows what the phone would.",
  /** The caption under the phone while the app's web build is not what it shows (S1.6's caption is for the app). */
  frameCaptionPreview: "A preview drawn from the run, until the app's web build answers.",
  frameCaptionAsleep: "A preview drawn from the run: the app's web build isn't running here.",
  frameCaptionStub: "A development stand-in, not the app.",
  frameLabel: (persona: string) => `${persona} frame`,
  raise: "Raise the phone",
  lower: "Lower the phone",
  focusPhone: "Use the phone",
  /** The rail's foot: who the judge acts as, short; the catalog's whole sentence is its title. */
  actingShort: (first: string, role: string) => `${first} · ${role}`,
  ribbonEmpty: "Nothing yet in this lane.",
  menu: "Screens",
  shortcuts: "Shortcuts",
  dataMode: "Data mode",
  stageRegion: "Judge stage",
} as const;

/** The stage's own states (S1.6), shown as one strip under the top bar. Figures come from the run. */
export const STAGE_NOTICE = {
  queued: (seconds: number) =>
    `The simulated PayPal sandbox is pacing us (PayPal's documented limit, modelled). You're next, about ${seconds} s.`,
  resetting: STAGE.resetting,
  startFailed: "We couldn't start a run.",
  startRetry: "Try again",
  resetFailed: "Reset didn't go through: this session is still running.",
  resetRetry: "Try Reset again",
  ended: "This session ended in another tab, or it expired. The stage is back at the first press.",
  requestId: (id: string) => `Request ${id}`,
  aiOff: "Live slip reading is off. The labelled seed stand-in still plays.",
  // S1.6's words for the API's replay reasons `circuit_open` and `balance_low`.
  circuit: "The simulated PayPal rate limit paused calls. For 6 minutes, PayPal steps use a labelled replay.",
  balanceLow:
    "The simulated PayPal balance is low. This run's payouts replay, labelled, until it's topped up.",
  paypalOff: "Simulated PayPal calls are off. This run's payout steps wait; nothing is replayed for them.",
  payoutsOff: "Payouts are paused by the co-op. Everything else works.",
  autoplay: "Autoplay is driving. Any key or click hands it back to you.",
  paused: "Paused. You're driving.",
} as const;

/** What the phone frames show before the app's web build answers (FramePoster). Never the app itself. */
export const POSTER = {
  chairIdle: "Nothing to sign yet. Ernesto signs after Analyn.",
  chairRole: (name: string) => `${name}, Chair`,
  /** M-BD-01's heading, as the app words it (Cebuano; the machine-translated chip sits beneath). */
  chairTitle: (season: string) => `Pirmahan sa Season ${season}`,
  /** Under the poster's hatched "Pirmahi" slab: a still, never a control. */
  slabPreview: "Preview. In the app, Ernesto holds this slab to sign.",
  clerkRole: (name: string) => `${name}, clerk`,
  clerkReady: "Ready to scan slips",
} as const;

/** The console's drawers (W-TR-06, W-TR-09): the frame around them is shared. */
export const DRAWER = {
  close: "Close",
  closeHint: "Esc",
} as const;

export const SOUND_OFFER = {
  question: "Sound on? Payments play a chord.",
  yes: "Turn on",
  no: "No thanks",
  label: "Sound",
} as const;

export const CONNECTION = {
  reconnecting: (at: string | null) =>
    at ? `Reconnecting. Showing changes up to ${at}.` : "Reconnecting to the run's updates.",
  unauthorized: "This run belongs to another session. Showing what was last received.",
  expired: "This session's credential lapsed. Showing what was last received until it renews.",
  offline: "You're offline. Showing the last copy. Actions are paused.",
} as const;

export interface WhatsRealSection {
  readonly id: string;
  readonly title: string;
  /** The row's one line (UI gate round 2): ten words or so. */
  readonly line: string;
  /** The details, behind the row's "More". */
  readonly items: readonly string[];
}

export interface WhatsRealFacts {
  readonly rail: PaypalRail;
  readonly recordedOn: string;
  readonly replayPhotos: number;
  readonly replaySlips: number;
  readonly earlierPhotos: number;
  readonly members: number;
  readonly paypalMembers: number;
  /** A mock-data build (I8): the sheet says first that nothing here reaches PayPal or Claude. */
  readonly mock?: boolean;
}

/**
 * W-JG-02 (S1.6; UI gate round 2): five rows, Real code, the simulated PayPal sandbox, Replayed, Synthetic and
 * Not built, each one line with its details behind "More". Seeded entries sit under Replayed; the simulated phone
 * features, accounts, the merchant of record and the visitor's privacy sit under the row they belong to.
 */
export function whatsReal(f: WhatsRealFacts): readonly WhatsRealSection[] {
  const build: readonly WhatsRealSection[] = f.mock
    ? [{ id: "build", title: "This build", line: MOCK_DATA.chip, items: [MOCK_DATA.note] }]
    : [];
  return [...build, ...whatsRealSections(f)];
}

/** The sheet's legend words, in the honesty row's order. */
export const WHATS_REAL = {
  more: "More",
  less: "Less",
} as const;

function whatsRealSections(f: WhatsRealFacts): readonly WhatsRealSection[] {
  const simulated = f.rail === "simulator";
  const accounts = [
    `One business account is the co-op: it sends the invoice and the payouts. ${f.paypalMembers - 1} personal accounts are the members who end up paid by PayPal, one each, and one is Lantern Bay.`,
    "Rhea's address has no PayPal account, on purpose: that is what produces UNCLAIMED.",
    "In the product design, the co-op is the merchant of record and payout sender using its own account; this build models that account in the simulated PayPal sandbox. Fair Split is software and never holds, pools or converts funds.",
  ];
  const paypal: WhatsRealSection = simulated
    ? {
        id: "simulated-paypal",
        title: "Simulated PayPal sandbox",
        line: "Invoice, payment, payouts, notices. PayPal's own sandbox is untested.",
        items: [
          "PayPal runs only on our simulated PayPal sandbox, contract-tested against PayPal's published OpenAPI specs. The calls use Agent Toolkit 1.11.0 and Server SDK code; this integration is untested against PayPal's own sandbox.",
          "Simulated: the invoice, record-payment, the payout batch, item notices signed the way PayPal signs them, Rhea's unclaimed item and its cancel, and one repeated delivery.",
          "Every PayPal figure and status on screen is labelled with this rail.",
          ...accounts,
        ],
      }
    : {
        id: "real-paypal",
        title: "PayPal sandbox (untested in this build)",
        line: "Invoice and payouts on PayPal's sandbox, untested here.",
        items: [
          "The invoice, created through PayPal's Agent Toolkit 1.11.0, its send and its auto-cancel rule.",
          "The simulated PayPal sandbox models record-payment and its INVOICING.INVOICE.PAID notice.",
          "The typed Payouts POST and the item notices, Rhea's UNCLAIMED, our cancel and RETURNED, one resent duplicate, and PayPal's reported fees.",
          ...accounts,
        ],
      };
  return [
    {
      id: "real",
      title: "Real code",
      line: "Engine, holds, signatures, Proof. Claude never writes a number.",
      items: [
        "Your presses, the holds you resolve and the approvals you sign. Signatures are Ed25519, made in your browser with a demo key for this session.",
        "Every amount, computed by the engine in integer cents. Claude never writes a number into a line, a payout or a statement.",
        "The rate card's hash, fixed before the first slip; editing it is refused, citing the hash.",
        "Your visit: we hash your IP address for one day to rate-limit visits. We don't store it.",
      ],
    },
    paypal,
    {
      id: "replayed",
      title: "Replayed",
      line: `${f.replaySlips} slip readings: a seed stand-in, not a Claude recording.`,
      items: [
        `${f.replaySlips} slips in ${f.replayPhotos} photos use the labelled seed stand-in, not a Claude recording. The reading room separately exhibits the real hero-slip readings when a committed recording exists.`,
        "The invoice line labels are a placeholder written with the seed. The audit agent is paused; the live policy lattice checks every amount against the engine's quote.",
        `Seeded: the invoice-send approval and the ${f.earlierPhotos} earlier photo-manifest entries with their seeded read dates. Earlier photos are not imaged.`,
      ],
    },
    {
      id: "synthetic",
      title: "Synthetic",
      line: `Co-op, ${f.members} people, slips, voices. No real farmer is paid.`,
      items: [
        `The ${f.members} members, the co-op and the brand are fictional. The 10 hero slips are Codex-made (OpenAI's image model via Codex CLI). The photos A–L are composed in code from hero flats and code-drawn slips. All images are synthetic. Voice clips, where served, use Gemini TTS; device voice is labelled separately. No real farmer is paid.`,
      ],
    },
    {
      id: "not-built",
      title: "Not built",
      line: "Partner onboarding, real SMS, push and offline capture.",
      items: [
        "Production partner onboarding (PayPal must grant third-party permissions for Invoicing and Payouts), real SMS, push notifications and offline capture.",
        "Simulated on the phone instead: the push banners, the biometric step (a demo key made in your browser), the clerk's scanner (sample slips) and SMS previews.",
      ],
    },
  ];
}

export const TRY_TO_BREAK = {
  title: "Try to break it",
  lede: "Refused by code. No money moves, no calls are made.",
  /** Before the first press: the attempts need a run. */
  needsRun: "Press Mark the invoice paid first.",
  refused: "Refused",
  nothingSent: "Nothing sent",
  why: "Why",
  attempts: [
    "Make the invoice draft overcharge Lantern Bay: the policy lattice refuses it before any PayPal call.",
    "Offset two invoice amounts or change the recipient: policy refuses the altered draft.",
    "Arm a payout change before key 2: the Payouts tool re-hashes the batch, refuses the change and voids both approvals.",
  ],
} as const;
