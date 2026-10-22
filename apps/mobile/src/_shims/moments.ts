/**
 * TEMPORARY SHIM: replace with @fairsplit/motion `moments.ts` (IC-10, frozen 27 Oct) after WS-DS merges.
 *
 * The phase names are test selectors (`data-moment-phase`), so they are copied from S2.9 exactly; the app only
 * renders MM-1, MM-5 (the phone's key) and MM-7, but the whole catalogue is kept so a typo cannot pass.
 */
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
  "MM-3": ["closed", "glide-in", "converge", "pairs", "ready", "pressed", "needle", "wave", "resolved"],
  "MM-4": ["idle", "refuse", "plate", "done"],
  "MM-5": [
    "blocked",
    "rising",
    "ready",
    "hold-1",
    "armed-1",
    "confirm-1",
    "signed-1",
    "waiting-2",
    "hold-2",
    "armed-2",
    "confirm-2",
    "signed-2",
    "sealed",
    "inked",
    "released-early",
    "disarmed",
    "declined",
    "expired",
    "mismatch",
  ],
  "MM-6": ["ready", "sent", "landing", "parked", "rerouted", "settled", "denied"],
  "MM-7": ["rest", "framed", "expanded", "zooming", "zoomed", "tiled", "returning"],
  /** The register's MM-S (INVOICE.PAID arc); S2.9 names it BEAT-PAID. Console only. */
  "BEAT-PAID": ["waiting", "arc", "funded"],
} as const;

export type MomentId = keyof typeof MOMENTS;
export type MomentPhase<M extends MomentId> = (typeof MOMENTS)[M][number];

export function isPhase<M extends MomentId>(id: M, phase: string): phase is MomentPhase<M> {
  return (MOMENTS[id] as readonly string[]).includes(phase);
}
