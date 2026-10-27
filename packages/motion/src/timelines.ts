// Every number in the moments (S2 §2.9), as data. Times are ms from the act's trigger, and every act starts
// on a real event (an SSE RunEvent, an HTTP response, an accepted signature, or a person's own press).
// WS-CONSOLE and WS-APP render from these steps; poseAt() evaluates them for the G1 motion studies.
//
// A step either enters a phase, drives a visual target from → to with a motion reference, or fires
// feedback, or several at once. `reduced` and `low` replace the visual steps of an act; they must enter
// exactly the same phases at the same times as `full` (a test enforces it).

import type { FeedbackEvent } from "./feedback-map.js";
import type { MomentId, MomentPhase } from "./moments.js";
import { type EaseName, SPRINGS, type SpringName, TIMING, TWEENS, type TweenName } from "./presets.js";

export type MotionRef =
  | { readonly tween: TweenName }
  | { readonly spring: SpringName }
  | { readonly ms: number; readonly ease: EaseName }
  | { readonly instant: true };

export interface Step<M extends MomentId = MomentId> {
  readonly at: number;
  readonly phase?: MomentPhase<M>;
  readonly target?: string;
  readonly from?: number;
  readonly to?: number;
  readonly motion?: MotionRef;
  readonly feedback?: FeedbackEvent;
  readonly note?: string;
}

export interface Act<M extends MomentId = MomentId> {
  readonly id: string;
  /** The event that starts the act. */
  readonly trigger: string;
  readonly full: readonly Step<M>[];
  readonly reduced?: readonly Step<M>[];
  readonly low?: readonly Step<M>[];
}

export interface Timeline<M extends MomentId = MomentId> {
  /** Values of every target before the first act. */
  readonly initial: Readonly<Record<string, number>>;
  readonly acts: readonly Act<M>[];
}

export type MotionMode = "full" | "reduced" | "low";

const instant = { instant: true } as const;
const reducedFade = { tween: "reduced" } as const;
const crossfade200 = { ms: 200, ease: "out" } as const;
const settleMs = Math.round(SPRINGS.settle.settleMs);
const glideMs = Math.round(SPRINGS.glide.settleMs);
const engraveEnd = 2 * TIMING.engraveStagger + 600;

// -------------------------------------------------------------------------------------------------- MM-1

const mm1: Timeline<"MM-1"> = {
  initial: {
    "capsule.inset": 5,
    "flood.scale": 0,
    "flood.opacity": 0,
    "amount.solid": 0,
    "label.paid": 0,
    "invite.ring": 0,
  },
  acts: [
    {
      id: "paid",
      trigger: "item.updated → SUCCESS (rank 60) for M-014",
      full: [
        {
          at: 0,
          phase: "press",
          target: "capsule.inset",
          to: 0,
          motion: { tween: "press" },
          note: "PayPal's press",
        },
        { at: 90, phase: "flood", target: "flood.opacity", to: 1, motion: instant },
        {
          at: 90,
          target: "flood.scale",
          to: 1,
          motion: { tween: "flood" },
          note: "Jade from the bottom-right",
        },
        { at: 120, phase: "fill", target: "amount.solid", to: 1, motion: { tween: "fill" } },
        { at: 180, feedback: "item.paid.member", note: "Chime, two haptics 90 ms apart" },
        { at: 400, phase: "label", target: "label.paid", to: 1, motion: { tween: "crossfade" } },
        { at: 900, phase: "invite", target: "invite.ring", to: 1, motion: { tween: "invite" } },
        { at: 1300, phase: "done" },
      ],
      reduced: [
        { at: 0, phase: "press", target: "capsule.inset", to: 0, motion: instant },
        { at: 90, phase: "flood", target: "flood.scale", to: 1, motion: instant },
        { at: 90, target: "flood.opacity", to: 1, motion: reducedFade },
        { at: 120, phase: "fill", target: "amount.solid", to: 1, motion: reducedFade },
        { at: 180, feedback: "item.paid.member" },
        { at: 400, phase: "label", target: "label.paid", to: 1, motion: reducedFade },
        { at: 900, phase: "invite", target: "invite.ring", to: 1, motion: reducedFade },
        { at: 1300, phase: "done" },
      ],
      low: [
        { at: 0, phase: "press", target: "capsule.inset", to: 0, motion: { tween: "press" } },
        { at: 90, phase: "flood", target: "flood.scale", to: 1, motion: instant },
        { at: 90, target: "flood.opacity", to: 1, motion: { tween: "fill" } },
        { at: 120, phase: "fill", target: "amount.solid", to: 1, motion: instant },
        { at: 180, feedback: "item.paid.member" },
        { at: 400, phase: "label", target: "label.paid", to: 1, motion: { tween: "crossfade" } },
        { at: 900, phase: "invite", target: "invite.ring", to: 1, motion: { tween: "invite" } },
        { at: 1300, phase: "done" },
      ],
    },
  ],
};

// -------------------------------------------------------------------------------------------------- MM-2

/** Reduced motion and the low tier: no flight, a pencil outline and a connector, and the band jumps. */
const mm2NoFlight: readonly Step<"MM-2">[] = [
  { at: 0, phase: "band", target: "band.y", to: 1, motion: instant, note: "The band jumps" },
  { at: 220, phase: "lift", target: "crop.lift", to: 1, motion: instant, note: "2 px pencil outline" },
  { at: 340, phase: "flight", target: "crop.flight", to: 1, motion: instant, note: "1 px connector, 600 ms" },
  { at: 640, phase: "resolve", target: "digits.resolve", to: 1, motion: reducedFade },
  { at: 940, phase: "print", target: "row.print", to: 1, motion: reducedFade, feedback: "row.printed" },
  { at: 1120, phase: "ring", target: "row.ring", to: 1, motion: reducedFade },
  { at: 1360, phase: "landed" },
];

const mm2: Timeline<"MM-2"> = {
  initial: {
    "band.y": 0,
    "crop.lift": 0,
    "crop.flight": 0,
    "digits.resolve": 0,
    "row.print": 0,
    "row.ring": 0,
  },
  acts: [
    {
      id: "row",
      trigger: "extract.row (replayed from the recorded run)",
      full: [
        { at: 0, phase: "band", target: "band.y", to: 1, motion: { tween: "band" } },
        { at: 220, phase: "lift", target: "crop.lift", to: 1, motion: { tween: "lift" } },
        { at: 340, phase: "flight", target: "crop.flight", to: 1, motion: { tween: "flight" } },
        { at: 640, phase: "resolve", target: "digits.resolve", to: 1, motion: { ms: 300, ease: "linear" } },
        {
          at: 940,
          phase: "print",
          target: "row.print",
          to: 1,
          motion: { tween: "print" },
          feedback: "row.printed",
        },
        { at: 1120, phase: "ring", target: "row.ring", to: 1, motion: { tween: "ring" } },
        { at: 1360, phase: "landed" },
      ],
      reduced: mm2NoFlight,
      low: mm2NoFlight,
    },
    {
      id: "by-hand",
      trigger: "field.entered for slip 0462 (Enter, a d2 press)",
      full: [
        { at: 0, phase: "by-hand", feedback: "slab.d2.commit", note: "d2 press with a plunk" },
        { at: 90, phase: "entered", note: "The value prints in ink with the AS stamp" },
        { at: 270, phase: "done" },
      ],
    },
  ],
};

// -------------------------------------------------------------------------------------------------- MM-3

/** The matching field pairs on slip 0457's two copies, in the order they light (S2 §2.9). */
export const MM3_PAIRS = ["serial", "date", "member", "net-kg"] as const;
const pairsStart = 900;
const pairsDone = pairsStart + MM3_PAIRS.length * TIMING.pairStagger;

/** Each pair: a canary outline on both cells and a connector, then a tick. Only the first enters `pairs`. */
const pairs = (motion: MotionRef): Step<"MM-3">[] =>
  MM3_PAIRS.map((field, i) => ({
    at: pairsStart + i * TIMING.pairStagger,
    ...(i === 0 ? { phase: "pairs" as const, note: "A tick per pair" } : {}),
    target: `pair.${field}`,
    to: 1,
    motion,
    feedback: "row.printed" as const,
  }));

/** "4 of 4 fields match. Same slip." prints once the last pair is lit. */
const verdict = (motion: MotionRef): Step<"MM-3"> => ({
  at: pairsDone,
  phase: "ready",
  target: "verdict",
  to: 1,
  motion,
  note: "The count comes from the DTO's compared fields",
});

const mm3: Timeline<"MM-3"> = {
  initial: {
    "photos.x": 1,
    "photos.opacity": 1,
    "crops.x": 1,
    "crops.opacity": 1,
    ...Object.fromEntries(MM3_PAIRS.map((field) => [`pair.${field}`, 0])),
    verdict: 0,
    needle: 2.05,
    "needle.fade": 1,
    wave: 0,
    resolved: 0,
  },
  acts: [
    {
      id: "open",
      trigger: "H1 opened",
      full: [
        { at: 0, phase: "glide-in", target: "photos.x", to: 0, motion: { spring: "glide" } },
        { at: 450, phase: "converge", target: "crops.x", to: 0, motion: { tween: "converge" } },
        ...pairs({ tween: "pair" }),
        verdict({ tween: "print" }),
      ],
      reduced: [
        { at: 0, phase: "glide-in", target: "photos.x", to: 0, motion: instant },
        { at: 0, target: "photos.opacity", from: 0, to: 1, motion: crossfade200 },
        { at: 450, phase: "converge", target: "crops.x", to: 0, motion: instant },
        { at: 450, target: "crops.opacity", from: 0, to: 1, motion: crossfade200 },
        ...pairs(reducedFade),
        verdict(reducedFade),
      ],
      low: [
        { at: 0, phase: "glide-in", target: "photos.x", to: 0, motion: { spring: "glide" } },
        { at: 450, phase: "converge", target: "crops.x", to: 0, motion: instant, note: "Already converged" },
        ...pairs({ tween: "pair" }),
        verdict({ tween: "print" }),
      ],
    },
    {
      id: "count-once",
      trigger: "Count it once pressed (d2), then hold.resolved",
      full: [
        { at: 0, phase: "pressed", feedback: "slab.d2.commit" },
        {
          at: 60,
          phase: "needle",
          target: "needle",
          to: 1.62,
          motion: { spring: "needle" },
          note: "Ticks at 2.0",
        },
        { at: 200, phase: "wave", target: "wave", to: 1, motion: { ms: TIMING.waveCap, ease: "linear" } },
        {
          at: 200 + TIMING.waveCap,
          phase: "resolved",
          target: "resolved",
          to: 1,
          motion: { tween: "edgesFade" },
        },
      ],
      reduced: [
        { at: 0, phase: "pressed", feedback: "slab.d2.commit" },
        { at: 60, phase: "needle", target: "needle", to: 1.62, motion: instant, note: "The needle cuts" },
        { at: 60, target: "needle.fade", from: 0, to: 1, motion: crossfade200 },
        { at: 200, phase: "wave", target: "wave", to: 1, motion: instant, note: "600 ms pencil-wash" },
        { at: 200 + TIMING.waveCap, phase: "resolved", target: "resolved", to: 1, motion: reducedFade },
      ],
    },
  ],
};

// -------------------------------------------------------------------------------------------------- MM-4

const mm4: Timeline<"MM-4"> = {
  initial: { shake: 0, "steel.bright": 0, plate: 0 },
  acts: [
    {
      id: "refuse",
      trigger: "Press on the bolted Add to Schedule A; the 409 RATE_CARD_RATIFIED arrives",
      full: [
        {
          at: 0,
          phase: "refuse",
          target: "shake",
          to: 1,
          motion: { tween: "shake" },
          feedback: "bolted.refuse",
        },
        { at: 120, phase: "plate", target: "plate", to: 1, motion: { tween: "print" } },
        { at: 300, phase: "done" },
      ],
      reduced: [
        {
          at: 0,
          phase: "refuse",
          target: "steel.bright",
          to: 1,
          motion: { tween: "brighten" },
          feedback: "bolted.refuse",
        },
        { at: 120, phase: "plate", target: "plate", to: 1, motion: reducedFade },
        { at: 300, phase: "done" },
      ],
    },
  ],
};

// -------------------------------------------------------------------------------------------------- MM-5

const ring = (i: number, at: number): Step<"MM-5">[] => [
  { at, target: `ring${i}.opacity`, to: 1, motion: instant },
  { at, target: `ring${i}`, to: 1, motion: { tween: "engrave" } },
];
const ringFade = (i: number, at: number, motion: MotionRef): Step<"MM-5">[] => [
  { at, target: `ring${i}`, to: 1, motion: instant },
  { at, target: `ring${i}.opacity`, to: 1, motion },
];
const quarters = (hold: number, prefix: "slab" | "phone"): Step<"MM-5">[] =>
  [1, 2, 3].map((q) => ({
    at: (hold * q) / 4,
    target: `${prefix}.travel`,
    to: TIMING.holdStepTravel * q,
    motion: { tween: "press60" } as const,
    feedback: "hold.quarter" as const,
  }));
const stepped = (hold: number, prefix: "slab" | "phone"): Step<"MM-5">[] =>
  [1, 2, 3].map((q) => ({
    at: (hold * q) / 4,
    target: `${prefix}.step`,
    to: q / 4,
    motion: instant,
    feedback: "hold.quarter" as const,
  }));

const mm5: Timeline<"MM-5"> = {
  initial: {
    "slab.edge": 0,
    "slab.edgeOpacity": 1,
    "slab.fill": 0,
    "slab.travel": 0,
    "slab.step": 0,
    "phone.fill": 0,
    "phone.travel": 0,
    "phone.step": 0,
    ring0: 0,
    ring1: 0,
    ring2: 0,
    ring3: 0,
    ring4: 0,
    "ring0.opacity": 0,
    "ring1.opacity": 0,
    "ring2.opacity": 0,
    "ring3.opacity": 0,
    "ring4.opacity": 0,
    "slab.released": 0,
    "phone.released": 0,
    dialog: 0,
    presence: 0,
    "seal.scale": 1,
    "label.approved": 0,
    inked: 0,
  },
  acts: [
    {
      id: "rise",
      trigger: "hold.resolved (the last BLOCKS_APPROVAL hold)",
      full: [
        { at: 0, phase: "rising", target: "slab.edge", to: 8, motion: { spring: "settle" } },
        { at: settleMs, phase: "ready" },
      ],
      reduced: [
        { at: 0, phase: "rising", target: "slab.edge", to: 8, motion: instant },
        { at: 0, target: "slab.edgeOpacity", from: 0, to: 1, motion: { tween: "edgesFade" } },
        { at: settleMs, phase: "ready" },
      ],
    },
    {
      id: "hold-1",
      trigger: "Treasurer's hold starts (pointer down, or Space)",
      full: [
        {
          at: 0,
          phase: "hold-1",
          target: "slab.fill",
          to: 1,
          motion: { ms: TIMING.holdConsole, ease: "linear" },
        },
        ...quarters(TIMING.holdConsole, "slab"),
        {
          at: TIMING.holdConsole,
          phase: "armed-1",
          target: "slab.travel",
          to: 8,
          motion: { tween: "press60" },
          feedback: "hold.bottom",
          note: "Clunks flush; the label reads Release to sign. Nothing is signed yet",
        },
      ],
      reduced: [
        {
          at: 0,
          phase: "hold-1",
          target: "slab.fill",
          to: 1,
          motion: { ms: TIMING.holdConsole, ease: "linear" },
        },
        ...stepped(TIMING.holdConsole, "slab"),
        {
          at: TIMING.holdConsole,
          phase: "armed-1",
          target: "slab.step",
          to: 1,
          motion: instant,
          feedback: "hold.bottom",
        },
      ],
    },
    {
      id: "release-1",
      trigger: "Release inside the armed slab: the browser signs (the phase moves on approval.signed)",
      full: [
        {
          at: 0,
          target: "slab.released",
          to: 1,
          motion: instant,
          note: "The face stays flush and the label returns",
        },
      ],
      reduced: [
        { at: 0, target: "slab.released", to: 1, motion: instant },
        { at: 0, target: "slab.edgeOpacity", to: 0, motion: { tween: "edgesFade" } },
      ],
    },
    {
      id: "disarm-1",
      trigger:
        "After armed-1 the pointer leaves, the window blurs, the press is cancelled or the page scrolls",
      full: [
        { at: 0, phase: "disarmed", target: "slab.travel", to: 0, motion: { spring: "rebound" } },
        { at: 0, target: "slab.fill", to: 0, motion: { tween: "retract200" }, note: "Nothing was signed." },
      ],
      reduced: [
        { at: 0, phase: "disarmed", target: "slab.step", to: 0, motion: instant },
        { at: 0, target: "slab.fill", to: 0, motion: reducedFade },
      ],
    },
    {
      id: "confirm-1",
      trigger: "Enter, a virtual click or the visible link: ConfirmDialog opens on the console",
      full: [{ at: 0, phase: "confirm-1", target: "dialog", to: 1, motion: { tween: "drawerIn" } }],
      reduced: [{ at: 0, phase: "confirm-1", target: "dialog", to: 1, motion: reducedFade }],
    },
    {
      id: "signed-1",
      trigger: "approval.signed (TREASURER)",
      full: [
        { at: 0, phase: "signed-1" },
        ...ring(0, 0),
        ...ring(1, TIMING.engraveStagger),
        ...ring(2, 2 * TIMING.engraveStagger),
        { at: engraveEnd, phase: "waiting-2", target: "presence", to: 1, motion: { spring: "glide" } },
      ],
      reduced: [
        { at: 0, phase: "signed-1" },
        ...ringFade(0, 0, reducedFade),
        ...ringFade(1, 0, reducedFade),
        ...ringFade(2, 0, reducedFade),
        { at: engraveEnd, phase: "waiting-2", target: "presence", to: 1, motion: reducedFade },
      ],
      low: [
        { at: 0, phase: "signed-1" },
        ...ringFade(0, 0, { tween: "lowFade" }),
        ...ringFade(1, 0, { tween: "lowFade" }),
        ...ringFade(2, 0, { tween: "lowFade" }),
        { at: engraveEnd, phase: "waiting-2", target: "presence", to: 1, motion: { spring: "glide" } },
      ],
    },
    {
      id: "hold-2",
      trigger: "The Chair's hold starts on the phone",
      full: [
        {
          at: 0,
          phase: "hold-2",
          target: "phone.fill",
          to: 1,
          motion: { ms: TIMING.holdPhone, ease: "linear" },
        },
        ...quarters(TIMING.holdPhone, "phone"),
        {
          at: TIMING.holdPhone,
          phase: "armed-2",
          target: "phone.travel",
          to: 8,
          motion: { tween: "press60" },
          feedback: "hold.bottom",
          note: "Bottom-out; the label reads Release to sign",
        },
      ],
      reduced: [
        {
          at: 0,
          phase: "hold-2",
          target: "phone.fill",
          to: 1,
          motion: { ms: TIMING.holdPhone, ease: "linear" },
        },
        ...stepped(TIMING.holdPhone, "phone"),
        {
          at: TIMING.holdPhone,
          phase: "armed-2",
          target: "phone.step",
          to: 1,
          motion: instant,
          feedback: "hold.bottom",
        },
      ],
    },
    {
      id: "release-2",
      trigger: "Release inside on the phone: the biometric, then Ed25519 (web export: the labelled demo key)",
      full: [{ at: 0, target: "phone.released", to: 1, motion: instant }],
    },
    {
      id: "confirm-2",
      trigger:
        "TalkBack, the link or Enter on the phone: the M3 dialog opens; Pirmahi asks for the biometric",
      full: [{ at: 0, phase: "confirm-2", target: "dialog", to: 1, motion: { tween: "drawerIn" } }],
      reduced: [{ at: 0, phase: "confirm-2", target: "dialog", to: 1, motion: reducedFade }],
    },
    {
      id: "signed-2",
      trigger: "approval.signed (CHAIR)",
      full: [
        { at: 0, phase: "signed-2", target: "presence", to: 0, motion: { tween: "crossfade" } },
        ...ring(3, 0),
        ...ring(4, TIMING.engraveStagger),
        { at: 720, phase: "sealed", target: "seal.scale", from: 1.03, to: 1, motion: { spring: "land" } },
        {
          at: 720,
          target: "label.approved",
          to: 1,
          motion: { tween: "crossfade" },
          feedback: "seal.complete",
        },
        { at: 960, phase: "inked", target: "inked", to: 1, motion: { tween: "ink" } },
      ],
      reduced: [
        { at: 0, phase: "signed-2", target: "presence", to: 0, motion: reducedFade },
        ...ringFade(3, 0, reducedFade),
        ...ringFade(4, 0, reducedFade),
        {
          at: 720,
          phase: "sealed",
          target: "label.approved",
          to: 1,
          motion: reducedFade,
          feedback: "seal.complete",
        },
        { at: 960, phase: "inked", target: "inked", to: 1, motion: reducedFade },
      ],
      low: [
        { at: 0, phase: "signed-2", target: "presence", to: 0, motion: { tween: "crossfade" } },
        ...ringFade(3, 0, { tween: "lowFade" }),
        ...ringFade(4, 0, { tween: "lowFade" }),
        { at: 720, phase: "sealed", target: "seal.scale", from: 1.03, to: 1, motion: { spring: "land" } },
        {
          at: 720,
          target: "label.approved",
          to: 1,
          motion: { tween: "crossfade" },
          feedback: "seal.complete",
        },
        { at: 960, phase: "inked", target: "inked", to: 1, motion: { tween: "ink" } },
      ],
    },
    {
      id: "released-early",
      trigger: "Pointer or Space released before the hold completes",
      full: [
        { at: 0, phase: "released-early", target: "slab.travel", to: 0, motion: { spring: "rebound" } },
        {
          at: 0,
          target: "slab.fill",
          to: 0,
          motion: { tween: "retract200" },
          note: "Hold until it clicks, once",
        },
      ],
      reduced: [
        { at: 0, phase: "released-early", target: "slab.step", to: 0, motion: instant },
        { at: 0, target: "slab.fill", to: 0, motion: reducedFade },
      ],
    },
    {
      id: "mismatch",
      trigger: "The batch hash differs from the one signed",
      full: [{ at: 0, phase: "mismatch", feedback: "seal.mismatch", note: "Nothing was signed or sent" }],
    },
    {
      id: "declined",
      trigger: "approval.declined (CHAIR)",
      full: [{ at: 0, phase: "declined", note: "His reason, in his ink" }],
    },
    {
      id: "expired",
      trigger: "The co-sign request expired",
      full: [{ at: 0, phase: "expired" }],
    },
  ],
};

// -------------------------------------------------------------------------------------------------- MM-6

const mm6: Timeline<"MM-6"> = {
  initial: { threads: 0, "thread.complete": 0, "stub.inset": 3, "stub.flood": 0, "rhea.cash": 0 },
  acts: [
    {
      id: "posted",
      trigger: "201 from the typed Payouts POST",
      full: [
        {
          at: 0,
          phase: "sent",
          target: "threads",
          to: 0.7,
          motion: { tween: "thread" },
          note: "Stagger 40 ms",
        },
      ],
      reduced: [{ at: 0, phase: "sent", target: "threads", to: 0.7, motion: instant }],
    },
    {
      id: "item-success",
      trigger: "item.updated → SUCCESS (rank-forward, deduplicated)",
      full: [
        { at: 0, phase: "landing", target: "thread.complete", to: 1, motion: { tween: "threadComplete" } },
        { at: 300, target: "stub.inset", to: 0, motion: { spring: "land" }, feedback: "item.paid.console" },
        { at: 300, target: "stub.flood", to: 1, motion: { tween: "flood" } },
      ],
      reduced: [
        { at: 0, phase: "landing", target: "thread.complete", to: 1, motion: instant },
        { at: 300, target: "stub.inset", to: 0, motion: instant, feedback: "item.paid.console" },
        { at: 300, target: "stub.flood", to: 1, motion: reducedFade },
      ],
    },
    {
      id: "item-parked",
      trigger: "item.updated → UNCLAIMED or ONHOLD (canary cap, Parked) or FAILED/BLOCKED (red cap)",
      full: [
        { at: 0, phase: "parked", feedback: "paypal.failure", note: "Thread stays at 70%; 6 px end cap" },
      ],
    },
    {
      id: "to-cash",
      trigger: "Pay in cash at the bodega (d2), our cancel, then RETURNED",
      full: [
        { at: 0, phase: "rerouted", target: "rhea.cash", to: 1, motion: { ms: 300, ease: "out" } },
        { at: 0, feedback: "slab.d2.commit" },
      ],
      reduced: [
        { at: 0, phase: "rerouted", target: "rhea.cash", to: 1, motion: instant },
        { at: 0, feedback: "slab.d2.commit" },
      ],
    },
    {
      id: "settled",
      trigger: "All items terminal",
      full: [{ at: 0, phase: "settled", note: "The run card prints its summary; no celebration" }],
    },
    {
      id: "denied",
      trigger: "PAYMENT.PAYOUTSBATCH.DENIED",
      full: [{ at: 0, phase: "denied", feedback: "paypal.failure", note: "No money moved" }],
    },
  ],
};

// -------------------------------------------------------------------------------------------------- MM-7

/** Reduced motion and the low tier: a 200 ms crossfade straight to the crop at its final scale. */
const mm7TapCrossfade: readonly Step<"MM-7">[] = [
  { at: 0, phase: "framed", target: "frame", to: 1, motion: instant },
  { at: 90, phase: "expanded", target: "expand", to: 1, motion: crossfade200 },
];
const mm7ZoomCrossfade: readonly Step<"MM-7">[] = [
  { at: 0, phase: "zooming", target: "zoom", to: 2.4, motion: instant },
  { at: 0, target: "dim", to: 0.8, motion: crossfade200 },
  { at: glideMs, phase: "zoomed", feedback: "zoom.commit" },
  { at: glideMs, phase: "tiled", target: "tiles", to: 1, motion: crossfade200 },
];
const mm7BackCrossfade: readonly Step<"MM-7">[] = [
  { at: 0, phase: "returning", target: "zoom", to: 1, motion: instant },
  { at: 0, target: "dim", to: 0, motion: crossfade200 },
  { at: glideMs, phase: "rest" },
];

const mm7: Timeline<"MM-7"> = {
  initial: { frame: 0, expand: 0, zoom: 1, dim: 0, tiles: 0 },
  acts: [
    {
      id: "tap",
      trigger: "Tap on US$43.69 (the member's own action)",
      full: [
        { at: 0, phase: "framed", target: "frame", to: 1, motion: { tween: "press" } },
        { at: 90, phase: "expanded", target: "expand", to: 1, motion: { spring: "glide" } },
      ],
      reduced: mm7TapCrossfade,
      low: mm7TapCrossfade,
    },
    {
      id: "zoom",
      trigger: "Tap on slip chip 0403",
      full: [
        { at: 0, phase: "zooming", target: "zoom", to: 2.4, motion: { spring: "glide" } },
        { at: 0, target: "dim", to: 0.8, motion: { spring: "glide" } },
        { at: glideMs, phase: "zoomed", feedback: "zoom.commit", note: "Haptic fires on crossing 1.6×" },
        { at: glideMs, phase: "tiled", target: "tiles", to: 1, motion: { spring: "settle" } },
      ],
      reduced: mm7ZoomCrossfade,
      low: mm7ZoomCrossfade,
    },
    {
      id: "back",
      trigger: "Back (Predictive Back plays the zoom in reverse)",
      full: [
        { at: 0, phase: "returning", target: "zoom", to: 1, motion: { spring: "glide" } },
        { at: 0, target: "dim", to: 0, motion: { spring: "glide" } },
        { at: glideMs, phase: "rest" },
      ],
      reduced: mm7BackCrossfade,
      low: mm7BackCrossfade,
    },
  ],
};

// -------------------------------------------------------------------------------------------------- MM-S

const mmS: Timeline<"MM-S"> = {
  initial: { arc: 0, "pool.solid": 0, "funded.inset": 3, "funded.flood": 0 },
  acts: [
    {
      id: "paid",
      trigger: "Verified INVOICING.INVOICE.PAID, then a GET showing PAID or MARKED_AS_PAID, 0.00 due",
      full: [
        { at: 0, phase: "arc", target: "arc", to: 1, motion: { tween: "arc" } },
        { at: 600, target: "pool.solid", to: 1, motion: { ms: 150, ease: "out" } },
        { at: 750, phase: "funded", target: "funded.inset", to: 0, motion: { spring: "land" } },
        { at: 750, target: "funded.flood", to: 1, motion: { tween: "flood" }, feedback: "invoice.paid" },
      ],
      reduced: [
        { at: 0, phase: "arc", target: "arc", to: 1, motion: instant },
        { at: 600, target: "pool.solid", to: 1, motion: reducedFade },
        { at: 750, phase: "funded", target: "funded.inset", to: 0, motion: instant },
        { at: 750, target: "funded.flood", to: 1, motion: reducedFade, feedback: "invoice.paid" },
      ],
    },
  ],
};

export const TIMELINES: { readonly [M in MomentId]: Timeline<M> } = {
  "MM-1": mm1,
  "MM-2": mm2,
  "MM-3": mm3,
  "MM-4": mm4,
  "MM-5": mm5,
  "MM-6": mm6,
  "MM-7": mm7,
  "MM-S": mmS,
};

/** The steps an act runs in a motion mode. An act with no steps of its own for a mode runs `full`. */
export function stepsFor<M extends MomentId>(act: Act<M>, mode: MotionMode): readonly Step<M>[] {
  if (mode === "reduced") return act.reduced ?? act.full;
  if (mode === "low") return act.low ?? act.full;
  return act.full;
}

/** Duration of a motion reference in ms (springs use their settle time). */
export function motionMs(motion: MotionRef | undefined): number {
  if (!motion || "instant" in motion) return 0;
  if ("spring" in motion) return SPRINGS[motion.spring].settleMs;
  if ("tween" in motion) return TWEEN_MS[motion.tween];
  return motion.ms;
}

const TWEEN_MS = Object.fromEntries(Object.entries(TWEENS).map(([k, v]) => [k, v.ms])) as Record<
  TweenName,
  number
>;
