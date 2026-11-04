// Stage and chrome copy that @fairsplit/i18n does not carry yet, in the console's English (S1.11: sentence
// case, no exclamation marks, outcomes on buttons, the co-op's own words). Figures come from the snapshot,
// never from here. PayPal wording follows the rail (ADR-0002): under the simulator nothing says "real" or
// "verified" about PayPal, and nothing says "live" about sandbox activity (S1.11's word list). These keys
// move into @fairsplit/i18n (WS-DS) under W-JG-01.* when it adds them.

import type { PaypalRail } from "../lib/env.js";

export const WORDMARK = { name: "Fair Split", qualifier: "co-op payroll" } as const;

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

/** The ribbon's phone lane (1024–1679 px): the collapsed phone, read like the log's three lanes beside it. */
export const PHONE_LANE = {
  name: "Phone",
  raise: "Raise the phone",
  lower: "Lower the phone",
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
  phoneVisitTitle: "Open on a laptop for the full stage",
  phoneVisitBody:
    "The stage needs a window at least 1024 px wide: the co-op's console on the left and the member's phone beside it. Here is Nang Celing's statement from the showcase run.",
  phoneVisitCopy: "Copy the link",
  phoneVisitCopied: "Link copied. Open it on a laptop.",
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

/** W-JG-02 (S1.6): what is real, replayed, simulated, seeded and synthetic, and what is not built. */
export function whatsReal(f: WhatsRealFacts): readonly WhatsRealSection[] {
  const build: readonly WhatsRealSection[] = f.mock
    ? [{ id: "build", title: "This build", items: [MOCK_DATA.note] }]
    : [];
  return [...build, ...whatsRealSections(f)];
}

function whatsRealSections(f: WhatsRealFacts): readonly WhatsRealSection[] {
  const simulated = f.rail === "simulator";
  const paypal: WhatsRealSection = simulated
    ? {
        id: "simulated-paypal",
        title: "PayPal, simulated",
        items: [
          "PayPal runs only on our simulated PayPal sandbox, contract-tested against PayPal's published OpenAPI specs. The calls use Agent Toolkit 1.11.0 and Server SDK code; this integration is untested against PayPal's own sandbox.",
          "Simulated: the invoice, record-payment, the payout batch, item notices signed the way PayPal signs them, Rhea's unclaimed item and its cancel, and one repeated delivery.",
          "Every PayPal figure and status on screen is labelled with this rail.",
        ],
      }
    : {
        id: "real-paypal",
        title: "PayPal sandbox (untested in this build)",
        items: [
          "The invoice, created through PayPal's Agent Toolkit 1.11.0, its send and its auto-cancel rule.",
          "The simulated PayPal sandbox models record-payment and its INVOICING.INVOICE.PAID notice.",
          "The typed Payouts POST and the item notices, Rhea's UNCLAIMED, our cancel and RETURNED, one resent duplicate, and PayPal's reported fees.",
        ],
      };
  return [
    {
      id: "real",
      title: "Real",
      items: [
        "Your presses, the holds you resolve and the approvals you sign. Signatures are Ed25519, made in your browser with a demo key for this session.",
        "Every amount, computed by the engine in integer cents. Claude never writes a number into a line, a payout or a statement.",
        "The rate card's hash, fixed before the first slip; editing it is refused, citing the hash.",
      ],
    },
    paypal,
    {
      id: "replayed",
      title: "Replayed",
      items: [
        `${f.replaySlips} slips in ${f.replayPhotos} photos use the labelled seed stand-in, not a Claude recording. The reading room separately exhibits the real hero-slip readings when a committed recording exists.`,
        "The invoice line labels are a placeholder written with the seed. The audit agent is paused; the live policy lattice checks every amount against the engine's quote.",
      ],
    },
    {
      id: "simulated",
      title: "Simulated",
      items: [
        "The push banners on the phone, the biometric step (a demo key made in your browser), the clerk's scanner (sample slips) and SMS previews.",
      ],
    },
    {
      id: "seeded",
      title: "Seeded",
      items: [
        `The invoice-send approval and the ${f.earlierPhotos} earlier photo-manifest entries with their seeded read dates. Earlier photos are not imaged.`,
      ],
    },
    {
      id: "synthetic",
      title: "Synthetic",
      items: [
        `The ${f.members} members, the co-op and the brand are fictional. The 10 hero slips are Codex-made (OpenAI's image model via Codex CLI). The photos A–L are composed in code from hero flats and code-drawn slips. All images are synthetic. Voice clips, where served, use Gemini TTS; device voice is labelled separately. No real farmer is paid.`,
      ],
    },
    {
      id: "accounts",
      title: simulated ? "Accounts the simulator models" : "Untested sandbox accounts",
      items: [
        `One business account is the co-op: it sends the invoice and the payouts. ${f.paypalMembers - 1} personal accounts are the members who end up paid by PayPal, one each, and one is Lantern Bay.`,
        "Rhea's address has no PayPal account, on purpose: that is what produces UNCLAIMED.",
      ],
    },
    {
      id: "merchant",
      title: "Who holds the money",
      items: [
        "In the product design, the co-op is the merchant of record and payout sender using its own account; this build models that account in the simulated PayPal sandbox. Fair Split is software and never holds, pools or converts funds.",
      ],
    },
    {
      id: "privacy",
      title: "Your visit",
      items: ["We hash your IP address for one day to rate-limit visits. We don't store it."],
    },
    {
      id: "not-built",
      title: "Not built",
      items: [
        "Production partner onboarding (PayPal must grant third-party permissions for Invoicing and Payouts), real SMS, push notifications and offline capture.",
      ],
    },
  ];
}

export const TRY_TO_BREAK = {
  title: "Try to break it",
  lede: "Each attempt is labelled, refused by code, and moves no money.",
  attempts: [
    "Make the invoice draft overcharge Lantern Bay: the policy lattice refuses it before any PayPal call.",
    "Offset two invoice amounts or change the recipient: policy refuses the altered draft.",
    "Arm a payout change before key 2: the Payouts tool re-hashes the batch, refuses the change and voids both approvals.",
  ],
} as const;
