// Sound and haptics (design §4, S2 §2.10). `feedback.play(event)` is the only way UI makes a sound or a
// haptic; this map says what each event means on each platform. Haptics only decorate and never carry
// meaning, and the web promises no haptics at all.

export const FEEDBACK_EVENTS = [
  "row.printed",
  "slip.captured",
  "slab.d1.press",
  "slab.d1.release",
  "slab.d2.commit",
  "duplicate.found",
  "hold.quarter",
  "hold.bottom",
  "bolted.refuse",
  "seal.complete",
  "item.paid.member",
  "item.paid.console",
  "invoice.paid",
  "paypal.failure",
  "seal.mismatch",
  "zoom.commit",
  "webhook.duplicate",
] as const;

export type FeedbackEvent = (typeof FEEDBACK_EVENTS)[number];

export type SoundName = "tick" | "plunk" | "plunk-low" | "clack" | "chime" | "scale" | "root" | "thud";

export type IosHaptic =
  | "impactLight"
  | "impactMedium"
  | "impactHeavy"
  | "impactRigid"
  | "selection"
  | "notificationSuccess"
  | "notificationWarning"
  | "notificationError";

/** Android `performAndroidHapticsAsync` constants, with the fallback used below API 30 (or 34). */
export type AndroidHaptic =
  | "Confirm"
  | "Reject"
  | "Virtual_Key"
  | "Virtual_Key_Release"
  | "Clock_Tick"
  | "Segment_Tick";

export interface HapticStep<T> {
  readonly type: T;
  /** Delay from the event in ms. */
  readonly at: number;
}

export interface FeedbackSpec {
  /** Sound, or null for silence. `repeat` plays it again `gap` ms later. */
  readonly sound: { readonly name: SoundName; readonly repeat?: number; readonly gap?: number } | null;
  /** At most one per this many ms (row ticks, scale notes). */
  readonly throttleMs?: number;
  readonly ios: readonly HapticStep<IosHaptic>[];
  readonly android: readonly HapticStep<AndroidHaptic>[];
  /** Android fallback when the primary constant needs a newer API level. */
  readonly androidFallback?: readonly HapticStep<
    AndroidHaptic | "impactMedium" | "impactHeavy" | "notificationError"
  >[];
  readonly meaning: string;
}

const none = [] as const;

export const FEEDBACK: Readonly<Record<FeedbackEvent, FeedbackSpec>> = {
  "row.printed": {
    sound: { name: "tick" },
    throttleMs: 120,
    ios: none,
    android: none,
    meaning: "A row printed on the console",
  },
  "slip.captured": {
    sound: null,
    ios: [{ type: "impactMedium", at: 0 }],
    android: [{ type: "Confirm", at: 0 }],
    androidFallback: [{ type: "impactMedium", at: 0 }],
    meaning: "The clerk captured a slip",
  },
  "slab.d1.press": {
    sound: null,
    ios: [{ type: "impactLight", at: 0 }],
    android: [{ type: "Virtual_Key", at: 0 }],
    meaning: "A d1 slab pressed",
  },
  "slab.d1.release": {
    sound: null,
    ios: [{ type: "impactLight", at: 0 }],
    android: [{ type: "Virtual_Key_Release", at: 0 }],
    meaning: "A d1 slab released",
  },
  "slab.d2.commit": {
    sound: { name: "plunk" },
    ios: [{ type: "impactRigid", at: 0 }],
    android: [{ type: "Virtual_Key", at: 0 }],
    meaning: "A person committing a decision that changes a line",
  },
  "duplicate.found": {
    sound: { name: "tick", repeat: 2, gap: 90 },
    ios: [
      { type: "impactRigid", at: 0 },
      { type: "impactRigid", at: 90 },
    ],
    android: [
      { type: "Clock_Tick", at: 0 },
      { type: "Clock_Tick", at: 90 },
    ],
    meaning: "The engine found the same slip twice",
  },
  "hold.quarter": {
    sound: { name: "tick" },
    ios: [{ type: "selection", at: 0 }],
    android: [{ type: "Segment_Tick", at: 0 }],
    androidFallback: [{ type: "Clock_Tick", at: 0 }],
    meaning: "A quarter of a hold-to-commit",
  },
  "hold.bottom": {
    sound: { name: "plunk" },
    ios: [
      { type: "impactHeavy", at: 0 },
      { type: "notificationSuccess", at: 110 },
    ],
    android: [{ type: "Confirm", at: 0 }],
    androidFallback: [{ type: "impactHeavy", at: 0 }],
    meaning: "A hold bottomed out",
  },
  "bolted.refuse": {
    sound: { name: "clack" },
    ios: [{ type: "notificationError", at: 0 }],
    android: [{ type: "Reject", at: 0 }],
    androidFallback: [{ type: "notificationError", at: 0 }],
    meaning: "A bolted item refused",
  },
  "seal.complete": {
    sound: { name: "plunk-low" },
    ios: [{ type: "notificationSuccess", at: 0 }],
    android: [{ type: "Confirm", at: 0 }],
    meaning: "The seal completed on both screens",
  },
  "item.paid.member": {
    sound: { name: "chime" },
    ios: [
      { type: "notificationSuccess", at: 0 },
      { type: "notificationSuccess", at: 90 },
    ],
    android: [
      { type: "Confirm", at: 0 },
      { type: "Confirm", at: 90 },
    ],
    meaning: "Money arrived on a member's phone",
  },
  "item.paid.console": {
    sound: { name: "scale" },
    throttleMs: 250,
    ios: none,
    android: none,
    meaning: "A payout landed on the console: the next note of the scale",
  },
  "invoice.paid": {
    sound: { name: "root" },
    ios: none,
    android: none,
    meaning: "INVOICING.INVOICE.PAID: the season's root note",
  },
  "paypal.failure": {
    sound: { name: "thud" },
    ios: [{ type: "notificationWarning", at: 0 }],
    android: [{ type: "Reject", at: 0 }],
    meaning: "A PayPal failure",
  },
  "seal.mismatch": {
    sound: { name: "clack" },
    ios: [{ type: "notificationError", at: 0 }],
    android: [{ type: "Reject", at: 0 }],
    androidFallback: [{ type: "notificationError", at: 0 }],
    meaning: "The seal on the Chair's phone does not match",
  },
  "zoom.commit": {
    sound: null,
    ios: [{ type: "impactRigid", at: 0 }],
    android: [{ type: "Segment_Tick", at: 0 }],
    androidFallback: [{ type: "Clock_Tick", at: 0 }],
    meaning: "Tap-a-peso zoom crossed 1.6×",
  },
  "webhook.duplicate": {
    sound: null,
    ios: none,
    android: none,
    meaning: "A duplicate webhook delivery: silence is the point",
  },
};

export interface FeedbackOptions {
  /** For item.paid.console: which scale note (0-based, wraps after 8). */
  readonly index?: number;
}
