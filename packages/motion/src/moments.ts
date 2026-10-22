// IC-10: the magic moments and their phases. Frozen on 27 Oct at 18:00 (register §11). Phase names are test
// selectors: every moment root renders data-moment="<id>" and data-moment-phase="<phase>". The full, low-tier
// and reduced-motion renderers all emit the same phases; only what is drawn between them differs.
//
// Phase lists follow S2 §2.9. The supporting INVOICE.PAID beat takes the register's ID, MM-S (S2 called it
// BEAT-PAID; that name stays available as an alias).

export const MOMENTS = {
  "MM-1": ["pending", "press", "flood", "fill", "label", "invite", "done"],
  "MM-2": [
    "idle",
    "band",
    "lift",
    "flight",
    "resolve",
    "print",
    "ring",
    "landed",
    "by-hand",
    "entered",
    "done",
  ],
  "MM-3": ["closed", "glide-in", "converge", "underline", "ready", "pressed", "needle", "wave", "resolved"],
  "MM-4": ["idle", "refuse", "plate", "done"],
  "MM-5": [
    "blocked",
    "rising",
    "ready",
    "hold-1",
    "signed-1",
    "waiting-2",
    "hold-2",
    "signed-2",
    "sealed",
    "inked",
    "released-early",
    "declined",
    "expired",
    "mismatch",
  ],
  "MM-6": ["ready", "sent", "landing", "parked", "rerouted", "settled", "denied"],
  "MM-7": ["rest", "framed", "expanded", "zooming", "zoomed", "tiled", "returning"],
  "MM-S": ["waiting", "arc", "funded"],
} as const;

export type MomentId = keyof typeof MOMENTS;
export type MomentPhase<M extends MomentId = MomentId> = (typeof MOMENTS)[M][number];
export const MOMENT_IDS = Object.keys(MOMENTS) as MomentId[];

/** Older names for the same moments. */
export const MOMENT_ALIASES: Readonly<Record<string, MomentId>> = { "BEAT-PAID": "MM-S" };

export type Surface = "console" | "app" | "proof" | "stage";
export type Owner = "WS-CONSOLE" | "WS-APP";

export interface MomentInfo<M extends MomentId = MomentId> {
  readonly id: M;
  readonly name: string;
  /** The real event that starts it. Motion is evidence: never a timer (design §3, rule 2). */
  readonly trigger: string;
  /** Register §4 screen IDs. */
  readonly screens: readonly string[];
  readonly surfaces: readonly Surface[];
  readonly owners: readonly Owner[];
  /** Register §5 film time, when the moment is in the film. */
  readonly filmTime?: string;
  /** What the moment proves to a viewer (S1 §1.9). */
  readonly proves: string;
  /** Phases a finished run ends in (assertions wait for one of these). */
  readonly terminal: readonly MomentPhase<M>[];
  /** Phases that only appear on an exception path. */
  readonly exceptions: readonly MomentPhase<M>[];
  /** The reduced-motion renderer: same phases, no spatial travel, colour and opacity over 150 ms. */
  readonly reducedMotion: string;
  /** The low tier (≤ 3 GB RAM, or a slow web device): at most three animations, no flights. */
  readonly lowTier: string;
  /** What CI asserts, from S2 §2.9. */
  readonly assertion: string;
}

type Catalogue = { readonly [M in MomentId]: MomentInfo<M> };

export const MOMENT_INFO: Catalogue = {
  "MM-1": {
    id: "MM-1",
    name: "Bayad na",
    trigger: "Verified PAYMENT.PAYOUTS-ITEM.SUCCEEDED for M-014, as item.updated over SSE (rank 60, SUCCESS)",
    screens: ["M-MB-01", "W-TR-05", "W-PF-01"],
    surfaces: ["app", "console", "proof"],
    owners: ["WS-APP"],
    filmTime: "0:00–0:09",
    proves: "PayPal, not the app, says she is paid, and every copy changes at once",
    terminal: ["done"],
    exceptions: [],
    reducedMotion: "Colour and label crossfade over 150 ms; no inset travel and no corner flood",
    lowTier: "Jade fades in over 120 ms instead of flooding from the corner; the amount fills instantly",
    assertion: "Reaches done within 3 s of the event",
  },
  "MM-2": {
    id: "MM-2",
    name: "Paper prints itself",
    trigger:
      "Each replayed extract.row from the recorded real Claude run; field.entered for the by-hand field",
    screens: ["W-TR-03", "W-TR-04"],
    surfaces: ["console"],
    owners: ["WS-CONSOLE"],
    filmTime: "0:32–0:44",
    proves: "Claude reads in pencil; doubt becomes the treasurer's ink",
    terminal: ["landed", "done"],
    exceptions: [],
    reducedMotion:
      "No flight: a 2 px pencil outline on the crop and a 1 px connector for 600 ms; the band jumps",
    lowTier: "Same as reduced motion: no flight, outline and connector, the band jumps",
    assertion: "Row starts are at least 180 ms apart, with at most 8 flights",
  },
  "MM-3": {
    id: "MM-3",
    name: "The pink copy",
    trigger: "H1 opened, then a press on Count it once",
    screens: ["W-TR-06", "W-TR-05"],
    surfaces: ["console"],
    owners: ["WS-CONSOLE"],
    filmTime: "0:44–0:56",
    proves: "The duplicate cost 63 neighbours; counting it once pays them back",
    terminal: ["resolved"],
    exceptions: [],
    reducedMotion:
      "200 ms crossfades into the overlap and for the needle; digits change with a 600 ms pencil-wash",
    lowTier: "The crops start already overlapped",
    assertion: "The needle crosses 2.0% once and the card ends flush in ink with the AS stamp",
  },
  "MM-4": {
    id: "MM-4",
    name: "Bolted",
    trigger: "409 RATE_CARD_RATIFIED citing the rate-card hash",
    screens: ["W-TR-02"],
    surfaces: ["console"],
    owners: ["WS-CONSOLE"],
    filmTime: "1:04–1:10",
    proves: "Not even the treasurer can add a deduction mid-season",
    terminal: ["done"],
    exceptions: [],
    reducedMotion: "No shake; the steel edges and bolts brighten for 200 ms and the plate appears",
    lowTier: "As full: the shake is a CSS transform",
    assertion: "The plate prints at max(120 ms, arrival of the 409)",
  },
  "MM-5": {
    id: "MM-5",
    name: "Two keys",
    trigger: "Last BLOCKS_APPROVAL hold resolved; two approval.signed events (Ed25519)",
    screens: ["W-TR-07", "M-BD-02"],
    surfaces: ["console", "app"],
    owners: ["WS-CONSOLE", "WS-APP"],
    filmTime: "1:10–1:24",
    proves: "Two named people bound this exact batch",
    terminal: ["inked"],
    exceptions: ["released-early", "declined", "expired", "mismatch"],
    reducedMotion: "A stepped bar with a percentage replaces face travel; the edges fade; the rings fade in",
    lowTier: "On the Chair's phone the rings appear complete with a 200 ms fade; the ticks stay",
    assertion:
      "Commit at 1600 ± 50 ms; both contexts reach sealed within 150 ms; a tampered hash gives mismatch",
  },
  "MM-6": {
    id: "MM-6",
    name: "Honest fan-out",
    trigger: "The 201 from the typed Payouts POST, then each rank-forward item.updated",
    screens: ["W-TR-08"],
    surfaces: ["console"],
    owners: ["WS-CONSOLE"],
    filmTime: "1:24–1:42",
    proves: "Sent is not paid; cash members share the page; a repeat changes nothing",
    terminal: ["settled"],
    exceptions: ["denied"],
    reducedMotion:
      "Threads appear at 70%; completion is an instant colour change; stubs change colour without the press",
    lowTier: "Threads draw without stagger; stubs change colour without the inset press",
    assertion: "Colour follows the item's actual transaction_status; a duplicate delivery moves nothing",
  },
  "MM-7": {
    id: "MM-7",
    name: "Tap a peso",
    trigger: "Nang Celing taps US$43.69 on her ReceiptBar",
    screens: ["M-MB-01", "W-PF-01"],
    surfaces: ["app", "proof"],
    owners: ["WS-APP", "WS-CONSOLE"],
    filmTime: "2:00–2:12",
    proves: "Every peso traces to a pencil mark she recognises",
    terminal: ["tiled", "rest"],
    exceptions: [],
    reducedMotion: "A 200 ms crossfade straight to the crop at its final scale",
    lowTier: "A 200 ms crossfade straight to the crop at its final scale",
    assertion: "Zoom commits at 1.6× with one haptic; Back reverses to rest",
  },
  "MM-S": {
    id: "MM-S",
    name: "INVOICE.PAID arc (supporting beat)",
    trigger: "Verified INVOICING.INVOICE.PAID, then a fresh GET showing PAID or MARKED_AS_PAID with 0.00 due",
    screens: ["W-TR-01", "W-JG-01"],
    surfaces: ["console", "stage"],
    owners: ["WS-CONSOLE"],
    filmTime: "0:20–0:32",
    proves: "The season is funded only when PayPal confirms the invoice",
    terminal: ["funded"],
    exceptions: [],
    reducedMotion:
      "Colour changes only: the pool turns solid and Funded turns jade flush, with no arc travel",
    lowTier: "As full: one arc is cheap",
    assertion: "Funded lands only after the verified webhook and the GET",
  },
};

/** The phases a moment passes through on its happy path, in order. */
export function happyPath<M extends MomentId>(id: M): MomentPhase<M>[] {
  const exceptions = new Set<string>(MOMENT_INFO[id].exceptions);
  return (MOMENTS[id] as readonly MomentPhase<M>[]).filter((p) => !exceptions.has(p));
}

export function isPhase<M extends MomentId>(id: M, phase: string): phase is MomentPhase<M> {
  return (MOMENTS[id] as readonly string[]).includes(phase);
}

/** Resolves an alias (BEAT-PAID) or returns the ID unchanged. */
export function momentId(idOrAlias: string): MomentId | undefined {
  if (idOrAlias in MOMENTS) return idOrAlias as MomentId;
  return MOMENT_ALIASES[idOrAlias];
}
