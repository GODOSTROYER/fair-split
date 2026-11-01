// The stage's own states (S1.6: queued, resetting, start-failed, autoplay, paused, circuit, balance-low, ai-off,
// paypal-off; and reset-failed and session-ended) as one
// strip under the top bar. Only one shows at a time, the most pressing first. Nothing here is an error
// colour: the stage pacing itself, a reset or a paused switch is information, not failure.

import type { ReplayReason } from "@fairsplit/api-client";
import { PAY_RUN_RANK } from "@fairsplit/contracts";
import { translate } from "@fairsplit/i18n";
import { Glyph, type GlyphName } from "@fairsplit/ui-web";
import { errorView } from "../data/errors.js";
import type { JudgeSessionApi } from "../data/hooks.js";
import { payoutReplayed } from "../data/payout-replay.js";
import type { RunView } from "../data/run-view.js";
import type { AutoplayState } from "../stage/context.js";
import { STAGE_NOTICE } from "./copy.js";

export type NoticeState =
  | "resetting"
  | "session-ended"
  | "reset-failed"
  | "start-failed"
  | "autoplay"
  | "paused"
  | "queued"
  | "circuit"
  | "balance-low"
  | "ai-off"
  | "paypal-off"
  | "replay";

export interface StageNoticeView {
  readonly state: NoticeState;
  readonly glyph: GlyphName;
  readonly text: string;
  readonly refs: readonly string[];
  readonly retry: boolean;
}

/** Seconds a judge waits per place in the live lane (S1.6's "about 40 s"). An estimate, and worded as one. */
export const QUEUE_SECONDS_PER_PLACE = 40;

export interface StageNoticeInput {
  readonly session: Pick<JudgeSessionApi, "status" | "session" | "error">;
  readonly view: RunView | undefined;
  readonly autoplay: AutoplayState;
  readonly inSession: boolean;
  /** Why the API replays PayPal steps for this session (GET /v1/judge/session `rail.reason`), if it does. */
  readonly replayReason?: ReplayReason | null;
  readonly replayLabel?: string | null;
}

/** The notice the stage shows, or null. Pure, so the stage's `data-state` follows it exactly. */
export function stageNoticeFor({
  session,
  view,
  autoplay,
  inSession,
  replayReason = null,
  replayLabel = null,
}: StageNoticeInput): StageNoticeView | null {
  const none: readonly string[] = [];
  const posted =
    view !== undefined &&
    ((PAY_RUN_RANK[view.state] >= PAY_RUN_RANK.POSTING && PAY_RUN_RANK[view.state] < 99) ||
      Object.keys(view.items ?? {}).length > 0);
  const replayed = payoutReplayed(view);
  const forecast =
    !posted && replayReason !== null
      ? `This run’s PayPal payouts will replay, labelled (simulated PayPal sandbox).${replayLabel ? ` ${replayLabel}` : ""}`
      : null;
  const replayText = replayed ? "Replayed (labelled): earlier simulated PayPal sandbox run" : forecast;
  const replaySuffix = inSession && replayText ? ` ${replayText}` : "";
  if (session.status === "resetting") {
    return {
      state: "resetting",
      glyph: "ms:restart-alt",
      text: STAGE_NOTICE.resetting,
      refs: none,
      retry: false,
    };
  }
  if (session.status === "ended") {
    // The server ended the session meanwhile: the stage is back at the first press, and says why.
    return {
      state: "session-ended",
      glyph: "ms:restart-alt",
      text: STAGE_NOTICE.ended,
      refs: none,
      retry: false,
    };
  }
  if (session.status === "active" && session.error) {
    // Reset did not go through: the server still holds the session, so the stage does not pretend otherwise.
    const failure = errorView(session.error);
    return {
      state: "reset-failed",
      glyph: "ms:restart-alt",
      text: `${STAGE_NOTICE.resetFailed} ${failure.title}`,
      refs: failure.refs,
      retry: true,
    };
  }
  if (session.status === "failed") {
    const failure = session.error ? errorView(session.error) : null;
    return {
      state: "start-failed",
      glyph: "ms:restart-alt",
      text: failure ? `${STAGE_NOTICE.startFailed} ${failure.title}` : STAGE_NOTICE.startFailed,
      refs: failure?.refs ?? none,
      retry: true,
    };
  }
  if (autoplay === "autoplay") {
    return {
      state: "autoplay",
      glyph: "ms:play-arrow",
      text: `${STAGE_NOTICE.autoplay}${replaySuffix}`,
      refs: none,
      retry: false,
    };
  }
  if (autoplay === "paused") {
    return {
      state: "paused",
      glyph: "ms:pause",
      text: `${STAGE_NOTICE.paused}${replaySuffix}`,
      refs: none,
      retry: false,
    };
  }
  const place = session.session?.queuePosition ?? null;
  if (inSession && place !== null && place > 0) {
    const seconds = place * QUEUE_SECONDS_PER_PLACE;
    return {
      state: "queued",
      glyph: "ms:schedule",
      text: translate("en", "W-JG-01.state.queued", { seconds }),
      refs: none,
      retry: false,
    };
  }
  // PayPal's sandbox said slow down (the 6-minute circuit), or its balance is too low to post: S1.6's states.
  if (inSession && !posted && replayReason === "circuit_open") {
    return { state: "circuit", glyph: "rail", text: STAGE_NOTICE.circuit, refs: none, retry: false };
  }
  if (inSession && !posted && replayReason === "balance_low") {
    return { state: "balance-low", glyph: "rail", text: STAGE_NOTICE.balanceLow, refs: none, retry: false };
  }
  if (inSession && replayText) {
    return {
      state: "replay",
      glyph: "rail",
      text: replayText,
      refs: none,
      retry: false,
    };
  }
  if (inSession && view?.flags.kill_ai_live) {
    return { state: "ai-off", glyph: "pencil", text: STAGE_NOTICE.aiOff, refs: none, retry: false };
  }
  if (inSession && (view?.flags.kill_paypal_live || view?.flags.kill_payouts)) {
    return {
      state: "paypal-off",
      glyph: "rail",
      text: view.flags.kill_paypal_live ? STAGE_NOTICE.paypalOff : STAGE_NOTICE.payoutsOff,
      refs: none,
      retry: false,
    };
  }
  return null;
}

export function StageNotice({
  notice,
  onRetry,
}: {
  readonly notice: StageNoticeView;
  readonly onRetry: () => void;
}) {
  return (
    <p className="fsc-notice" role="status" data-state={notice.state} data-testid="W-JG-01.notice.state">
      <Glyph name={notice.glyph} size={16} />
      <span className="fsc-notice__text">{notice.text}</span>
      {notice.refs.map((ref) => (
        <span key={ref} className="fsc-notice__ref fs-t-hash">
          {ref}
        </span>
      ))}
      {notice.retry && (
        <button
          type="button"
          className="fs-link fs-t-label"
          onClick={onRetry}
          data-testid="W-JG-01.notice.retry"
        >
          {notice.state === "reset-failed" ? STAGE_NOTICE.resetRetry : STAGE_NOTICE.startRetry}
        </button>
      )}
    </p>
  );
}
