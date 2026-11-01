/**
 * M-BD-02 Sign, the phone's half of MM-5 "Two keys", as pure functions (S1.9, S2.7, S2.9):
 *
 *   ready → holding (1,200 ms, a tick each quarter) → armed ("Release to sign") → release inside → biometric
 *   (fingerprint or device PIN, then Ed25519) → signed (rings 3–4 engrave) → sealed (+720 ms) → inked (+960 ms)
 *
 * A release before the hold time, leaving the slab, a cancelled fingerprint, a hash mismatch, an expired request or a
 * dropped connection all end with nothing signed. `flowReducer` is the local flow (the slab and the signature);
 * `signPhase` joins it with the request's own status from M-BD-01, and the two maps turn a phase into the screen's
 * `data-state` and the MM-5 `data-moment-phase`, so tests can drive the whole flow without a device.
 */
import type { ApprovalPayloadDTO } from "../../_shims/api-client";
import type { ScreenStateOf } from "../../_shims/contracts";
import type { MomentPhase } from "../../_shims/moments";
import type { FeedbackEvent } from "../../_shims/motion";
import type { CosignFailure, CosignResult, ExpectedBatch, KeyVault } from "../../lib/signing";
import type { HoldState } from "../../ui/hold";
import type { CommitRefusal, FreshPayload, RequestStatus } from "./cosign-model";

/** The local flow: what the slab and the signature are doing. */
export type FlowPhase =
  | "idle"
  | "holding"
  | "armed"
  | "confirm"
  | "released-early"
  | "disarmed"
  | "biometric"
  | "signed"
  | "sealed"
  | "inked"
  | "stale"
  | Exclude<CosignFailure, "stale">;

export type FlowEvent =
  | { type: "hold"; state: HoldState }
  | { type: "commit" }
  | { type: "result"; ok: true }
  | { type: "result"; ok: false; state: CosignFailure }
  | { type: "sealed" }
  | { type: "inked" }
  | { type: "reset" }
  | { type: "remote-signed" };

/** The signature is under way or done: nothing on screen may start another. */
export const BUSY: ReadonlySet<FlowPhase> = new Set(["biometric", "signed", "sealed", "inked"]);

const HOLD_TO_FLOW: Readonly<Partial<Record<HoldState, FlowPhase>>> = {
  rest: "idle",
  holding: "holding",
  armed: "armed",
  confirm: "confirm",
  "released-early": "released-early",
  disarmed: "disarmed",
};

export function flowReducer(phase: FlowPhase, e: FlowEvent): FlowPhase {
  switch (e.type) {
    case "hold":
      // The slab's own "committed" is not a signature: only `commit` (a release inside, or the dialog) starts one.
      if (BUSY.has(phase)) return phase;
      return HOLD_TO_FLOW[e.state] ?? phase;
    case "commit":
      // I6: the key is asked for only after a full hold released inside the slab, or the dialog's confirm.
      return phase === "armed" || phase === "confirm" ? "biometric" : phase;
    case "result":
      if (phase !== "biometric") return phase;
      return e.ok ? "signed" : e.state;
    case "sealed":
      return phase === "signed" ? "sealed" : phase;
    case "inked":
      return phase === "sealed" ? "inked" : phase;
    case "reset":
      return BUSY.has(phase) ? phase : "idle";
    case "remote-signed":
      // Signed from elsewhere (the same key on a second visit): show the end state, never replay the moment.
      return phase === "biometric" ? phase : "inked";
  }
}

/** Everything the sign screen can show. */
export type SignPhase =
  | Exclude<FlowPhase, "idle" | "stale">
  | "loading"
  | "ready"
  | "waiting"
  | "expired"
  | "declined"
  | "closed";

/**
 * What the sign screen shows: the local flow while a signature is under way or done; otherwise the request's own
 * state first (changed batch, expired, offline, nothing to sign), then whether key 1 is in, then the slab.
 */
export function signPhase(request: RequestStatus, key1: boolean, flow: FlowPhase): SignPhase {
  if (BUSY.has(flow)) return flow as SignPhase;
  switch (request) {
    case "loading":
      return "loading";
    case "signed":
      return "inked";
    case "changed":
      return "mismatch";
    case "expired":
      return "expired";
    case "offline":
      return "offline";
    case "sent-back":
      return "declined";
    case "none":
    case "error":
      return "closed";
    default:
      break;
  }
  if (!key1) return "waiting";
  if (flow === "idle" || flow === "stale") return "ready";
  return flow as SignPhase;
}

/** `data-state` for each phase (S1.9 M-BD-02; IC-01 `SCREEN_STATES`). */
export const SIGN_SCREEN_STATE: Readonly<Record<SignPhase, ScreenStateOf<"M-BD-02">>> = {
  loading: "loading",
  waiting: "ready",
  ready: "ready",
  holding: "holding",
  armed: "armed",
  confirm: "confirm",
  "released-early": "released-early",
  disarmed: "disarmed",
  biometric: "biometric",
  signed: "signed",
  sealed: "signed",
  inked: "signed",
  cancelled: "cancelled",
  mismatch: "mismatch",
  expired: "expired",
  offline: "offline",
  "no-lock": "no-lock",
  invalidated: "invalidated",
  "locked-out": "error",
  error: "error",
  declined: "error",
  closed: "error",
};

/** The phone's MM-5 phases (S2.9): the second key, from rest to inked. */
export const SIGN_MOMENT_PHASE: Readonly<Record<SignPhase, MomentPhase<"MM-5">>> = {
  loading: "ready",
  waiting: "blocked",
  ready: "ready",
  holding: "hold-2",
  armed: "armed-2",
  confirm: "confirm-2",
  "released-early": "released-early",
  disarmed: "disarmed",
  // Release inside: "Native: biometric, then Ed25519. Web export: the labelled demo key" stays armed-2 (S2.9).
  biometric: "armed-2",
  signed: "signed-2",
  sealed: "sealed",
  inked: "inked",
  cancelled: "disarmed",
  mismatch: "mismatch",
  expired: "expired",
  offline: "ready",
  "no-lock": "ready",
  invalidated: "ready",
  "locked-out": "ready",
  error: "ready",
  declined: "declined",
  closed: "ready",
};

/** The slab can be held only from these phases; elsewhere it is flush with a reason, or gone. */
export function slabLive(phase: SignPhase): boolean {
  return (
    phase === "ready" ||
    phase === "holding" ||
    phase === "armed" ||
    phase === "confirm" ||
    phase === "released-early" ||
    phase === "disarmed" ||
    phase === "cancelled" ||
    phase === "error" ||
    phase === "locked-out"
  );
}

/** Amount grammar on the sign screen (S2.2.1): pencil until both keys are in, ink once the seal has landed. */
export function amountStateFor(phase: SignPhase): "pencil" | "ink" {
  return phase === "inked" ? "ink" : "pencil";
}

/** Seal rings shown: 0 to 2 keys (key 1 owns rings 0–2, key 2 rings 3–4). */
export function sealKeys(phase: SignPhase, key1: boolean): 0 | 1 | 2 {
  if (phase === "signed" || phase === "sealed" || phase === "inked") return 2;
  return key1 ? 1 : 0;
}

/* ------------------------------------------------------------------ the release, as one guarded step (I4) */

/** A refusal at the gate, as the sheet says it: a changed batch clacks, no signal waits, a closed request just ends. */
export function refusalFailure(r: CommitRefusal | null): CosignFailure | null {
  if (r === "mismatch") return "mismatch";
  if (r === "offline") return "offline";
  return r === "closed" ? "error" : null;
}

/**
 * A signature belongs to the pairing it was started under (`pairingId`): once the phone is paired again (as anyone,
 * the same officer included) or unpaired, the step stops with nothing signed, registered or sent, because anything
 * that left the phone then would go under the new pairing's bearer. `current` reads the pairing as it is now.
 */
export function pairingRefusal(startedUnder: string, current: () => string | null): CosignFailure | null {
  return current() === startedUnder ? null : "error";
}

/** Live device keys need the separate native enrollment protocol before any presence prompt or signature. */
export function nativeVaultRefusal(demo: boolean, vaultKind: KeyVault["kind"]): CosignFailure | null {
  return !demo && vaultKind !== "demo" ? "error" : null;
}

/**
 * The sound and haptic a failed signature makes (S2.9 MM-5 "Mismatch: a clack, the Error haptic"): only a batch hash
 * or lines digest the phone refused clacks; a cancelled fingerprint or a dropped connection is quiet.
 */
export function failureCue(state: CosignFailure): FeedbackEvent | null {
  return state === "mismatch" ? "seal.mismatch" : null;
}

export interface CommitSteps {
  /** Why the key may not be asked for at this instant, read from the latest state (not the last render), or null. */
  refusal(): CosignFailure | null;
  /** A payload for the batch the Chair opened (the provider's `freshPayload`). */
  payload(): Promise<FreshPayload>;
  /**
   * `cosign()` with the phone's deps bound, given the approval-payload answer (items and lines included, so it
   * recomputes both digests once more); `recheck` runs before the presence step and before anything is sent.
   */
  sign(
    approval: ApprovalPayloadDTO,
    expected: ExpectedBatch,
    recheck: () => CosignFailure | null,
  ): Promise<CosignResult>;
}

/**
 * A release inside the slab, or the dialog's confirm. Refused before anything is fetched when the request is no
 * longer the batch the Chair opened (the batch changed during the hold, or with the dialog open); refused again if it
 * changed while the payload was fetched; and `cosign` drops a signature made while it changed under the fingerprint
 * prompt. Every refusal ends with nothing signed and nothing sent.
 */
export async function commitSignature(steps: CommitSteps): Promise<CosignResult> {
  const before = steps.refusal();
  if (before) return { ok: false, state: before, detail: "refused" };
  const fresh = await steps.payload();
  if (!fresh.ok) return { ok: false, state: fresh.reason, detail: "payload" };
  const during = steps.refusal();
  if (during) return { ok: false, state: during, detail: "changed" };
  return steps.sign(fresh.approval, fresh.expected, steps.refusal);
}
