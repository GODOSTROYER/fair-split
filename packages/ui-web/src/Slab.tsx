// Slab: a human commit (design §2.5, S2 §2.5, §2.7). A solid face with a 1 px inner top highlight and two
// parallelogram edges whose depth equals the consequence: d1 reversible, d2 changes a line, d3 moves money or
// signs. Pressing moves the face by (t, t) and collapses the edges, transform-only. Hold slabs commit after
// 1,600 ms (or 1,200 on the Chair's phone) in four ratchet steps, and always offer a dialog route.
//
// Every way to commit (release, a finished hold, the dialog) passes one gate: a still frame, an unavailable
// slab and a bolted slab never commit, and a committed slab never commits twice (S2 §2.7).

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { DEPTH, TIMING } from "@fairsplit/motion/presets";
import { spring, tween } from "@fairsplit/motion/web";
import { animate, motion, useMotionValue, useTransform } from "motion/react";
import {
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useMotionMode, useT } from "./context.js";
import {
  edgeScale,
  type HoldProgress,
  holdQuarter,
  type SlabConfirm,
  type SlabProps,
  type SlabState,
} from "./contract.js";
import { feedback } from "./feedback.js";
import { Glyph, type GlyphName } from "./Glyph.js";

/** The dialog route on web: the body is any node (the amount, the recipient list, the consequence). */
export type WebSlabConfirm = SlabConfirm<ReactNode>;

/** A still frame for galleries and motion studies: no interaction, values set directly. */
export interface SlabFrame {
  readonly state: SlabState;
  /** Face travel in px, 0 to the slab's depth. */
  readonly travel?: number;
  /** Hold fill, 0 to 1. */
  readonly fill?: number;
  readonly edgeOpacity?: number;
  /** Reduced-motion stepped bar, 0 to 1 in quarters. */
  readonly step?: number;
  readonly showEarlyHint?: boolean;
}

/** Web presentation on top of the shared contract. */
export interface WebSlabOptions {
  /** 48 px (m) on the console, 64 px (l) for Approve, Paminawa and Pirmahi. */
  readonly size?: "m" | "l";
  readonly width?: number | string;
  readonly glyph?: GlyphName;
  /** Pressing a bolted slab refuses: called after the shake. */
  readonly onRefuse?: () => void;
  readonly onReasonClick?: () => void;
  /** A d2 commit leaves the face flush until the screen moves on. */
  readonly stayDown?: boolean;
  readonly frame?: SlabFrame;
  /** Below the hold slab: "Hold to approve". Set false to hide that caption; the dialog link always stays. */
  readonly hint?: boolean;
  readonly className?: string;
}

/** The contract with web nodes in the dialog. A hold slab without `confirm` does not type-check. */
export type WebSlabProps = SlabProps<ReactNode> & WebSlabOptions;

const STEP_TRAVEL = TIMING.holdStepTravel;

export function Slab(props: WebSlabProps) {
  const {
    label,
    depth,
    tone,
    hold,
    bolted = false,
    unavailableReason,
    srLabel,
    onCommit,
    testId,
    size = "m",
    width,
    glyph,
    confirm,
    onRefuse,
    onReasonClick,
    stayDown = depth !== "d1",
    frame,
    hint = true,
    className,
  } = props;
  const t = useT();
  const mode = useMotionMode();
  const reduced = mode === "reduced";
  const d = DEPTH[depth];
  const unavailable = unavailableReason !== undefined;
  const baseState: SlabState = unavailable ? "unavailable" : bolted ? "bolted" : "rest";
  // The types require `confirm` on a hold slab; an untyped caller still gets a route, built from the labels.
  const dialog: WebSlabConfirm | undefined = hold ? (confirm ?? { title: label, body: srLabel }) : undefined;

  const [liveState, setLiveStateNow] = useState<SlabState>(baseState);
  const [progress, setProgress] = useState<HoldProgress>(0);
  const [earlyHint, setEarlyHint] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const state = frame?.state ?? liveState;

  // The live state as of the latest change, so a second commit in the same tick sees the first.
  const liveRef = useRef<SlabState>(baseState);
  const setLiveState = useCallback((next: SlabState) => {
    liveRef.current = next;
    setLiveStateNow(next);
  }, []);
  // Hold timers and the dialog outlive the render that started them, so they read the slab's availability
  // and the caller's latest onCommit from here, synced before paint.
  const latest = useRef({ still: frame !== undefined, unavailable, bolted, onCommit });
  useLayoutEffect(() => {
    latest.current = { still: frame !== undefined, unavailable, bolted, onCommit };
  });

  const travel = useMotionValue(frame?.travel ?? (unavailable ? d : 0));
  const fill = useMotionValue(frame?.fill ?? 0);
  const edgeOpacity = useMotionValue(frame?.edgeOpacity ?? 1);
  const [stepValue, setStepValue] = useState(frame?.step ?? 0);
  const faceTransform = useTransform(travel, (v) => `translate(${v}px, ${v}px)`);
  const edgeR = useTransform(
    travel,
    (v) => `translate(${v}px, ${v}px) skewY(45deg) scaleX(${edgeScale(v, d)})`,
  );
  const edgeB = useTransform(
    travel,
    (v) => `translate(${v}px, ${v}px) skewX(45deg) scaleY(${edgeScale(v, d)})`,
  );
  const fillTransform = useTransform(fill, (v) => `scaleX(${v})`);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const holding = useRef(false);
  const hintId = useId();
  const reasonId = useId();

  // Still frames: follow the frame values exactly.
  useEffect(() => {
    if (!frame) return;
    travel.set(frame.travel ?? (frame.state === "unavailable" ? d : 0));
    fill.set(frame.fill ?? 0);
    edgeOpacity.set(frame.edgeOpacity ?? 1);
    setStepValue(frame.step ?? 0);
  }, [frame, travel, fill, edgeOpacity, d]);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const moveTo = useCallback(
    (to: number, how: "press" | "press60" | "rebound") => {
      if (reduced) {
        travel.set(0);
        return;
      }
      if (how === "rebound") animate(travel, to, spring("rebound"));
      else animate(travel, to, tween(how));
    },
    [reduced, travel],
  );

  /** S2 §2.7: never from a still frame, an unavailable or a bolted slab, and never twice. */
  const canCommit = useCallback(() => {
    const now = latest.current;
    return !now.still && !now.unavailable && !now.bolted && liveRef.current !== "committed";
  }, []);

  const commit = useCallback(() => {
    if (!canCommit()) return;
    latest.current.onCommit();
    if (stayDown) {
      setLiveState("committed");
      if (reduced) animate(edgeOpacity, 0, tween("edgesFade"));
    } else {
      setLiveState("rest");
      moveTo(0, "rebound");
    }
  }, [canCommit, stayDown, setLiveState, reduced, edgeOpacity, moveTo]);

  // ------------------------------------------------------------------- hold-to-commit (d3)
  const startHold = useCallback(() => {
    if (!hold || holding.current) return;
    holding.current = true;
    setLiveState("holding");
    setProgress(0);
    setStepValue(0);
    fill.set(0);
    animate(fill, 1, { duration: hold / 1000, ease: "linear" });
    for (const q of [1, 2, 3] as const) {
      timers.current.push(
        setTimeout(
          () => {
            setProgress(holdQuarter(q / 4));
            setStepValue(q / 4);
            moveTo(STEP_TRAVEL * q, "press60");
            feedback.play("hold.quarter");
          },
          (hold * q) / 4,
        ),
      );
    }
    timers.current.push(
      setTimeout(() => {
        holding.current = false;
        if (!canCommit()) return;
        setProgress(100);
        setStepValue(1);
        moveTo(d, "press60");
        feedback.play("hold.bottom");
        commit();
      }, hold),
    );
  }, [hold, setLiveState, fill, moveTo, canCommit, d, commit]);

  const cancelHold = useCallback(() => {
    if (!holding.current) return;
    holding.current = false;
    clearTimers();
    setProgress(0);
    setStepValue(0);
    setLiveState("rest");
    setEarlyHint(true);
    animate(fill, 0, reduced ? tween("reduced") : tween("retract200"));
    moveTo(0, "rebound");
  }, [clearTimers, setLiveState, fill, reduced, moveTo]);

  /** Drops pending steps and any hold in progress, silently: the slab's availability changed under it. */
  const abandonHold = useCallback(() => {
    clearTimers();
    if (!holding.current) return;
    holding.current = false;
    setProgress(0);
    setStepValue(0);
    fill.jump(0);
  }, [clearTimers, fill]);

  useEffect(() => {
    if (!hold) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") cancelHold();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [hold, cancelHold]);

  // Availability changes. A slab that becomes available rises on the settle spring (MM-5 "rising"); one that
  // becomes unavailable or bolted abandons a hold in progress and closes its dialog: neither may sign now.
  const previousBase = useRef(baseState);
  useEffect(() => {
    if (frame) return;
    const was = previousBase.current;
    previousBase.current = baseState;
    if (was === baseState) return;
    abandonHold();
    setDialogOpen(false);
    setLiveState(baseState);
    if (baseState === "unavailable") {
      travel.jump(d);
      return;
    }
    if (baseState === "bolted") {
      travel.jump(0);
      return;
    }
    if (was === "unavailable") {
      if (reduced) {
        travel.jump(0);
        edgeOpacity.set(0);
        animate(edgeOpacity, 1, tween("edgesFade"));
      } else {
        animate(travel, 0, spring("settle"));
      }
    }
  }, [baseState, frame, abandonHold, setLiveState, travel, edgeOpacity, reduced, d]);

  // ------------------------------------------------------------------- press (d1, d2) and refusal
  const pressed = useRef(false);

  const refuse = useCallback(() => {
    setLiveState("refusing");
    feedback.play("bolted.refuse");
    timers.current.push(
      setTimeout(() => {
        setLiveState("bolted");
        onRefuse?.();
      }, 140),
    );
  }, [setLiveState, onRefuse]);

  const pressStart = useCallback(() => {
    const now = liveRef.current;
    if (unavailable || now === "unavailable" || now === "committed") return;
    if (bolted) {
      refuse();
      return;
    }
    if (hold) {
      startHold();
      return;
    }
    pressed.current = true;
    setLiveState("pressed");
    moveTo(d, "press");
    if (depth === "d1") feedback.play("slab.d1.press");
  }, [unavailable, bolted, hold, refuse, startHold, setLiveState, moveTo, d, depth]);

  const pressEnd = useCallback(
    (inside: boolean) => {
      if (hold) {
        cancelHold();
        return;
      }
      if (!pressed.current) return;
      pressed.current = false;
      if (depth === "d1") feedback.play("slab.d1.release");
      if (!inside) {
        setLiveState("rest");
        moveTo(0, "rebound");
        return;
      }
      if (depth === "d2") feedback.play("slab.d2.commit");
      commit();
    },
    [hold, cancelHold, depth, setLiveState, moveTo, commit],
  );

  // ------------------------------------------------------------------- the dialog route (hold slabs)
  /** Opens only from rest. A bolted slab refuses instead; an unavailable or committed one does nothing. */
  const openDialog = useCallback(() => {
    if (!hold || frame) return;
    const now = liveRef.current;
    if (unavailable || now === "unavailable" || now === "committed") return;
    if (bolted) {
      refuse();
      return;
    }
    if (now !== "rest") return;
    setDialogOpen(true);
  }, [hold, frame, unavailable, bolted, refuse]);

  const confirmDialog = useCallback(() => {
    setDialogOpen(false);
    // The slab may have changed while the dialog was open: only a slab still at rest signs.
    if (liveRef.current !== "rest" || !canCommit()) return;
    travel.set(reduced ? 0 : d);
    fill.set(1);
    setStepValue(1);
    setProgress(100);
    feedback.play("hold.bottom");
    commit();
  }, [canCommit, travel, reduced, d, fill, commit]);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (frame || e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    pressStart();
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    if (frame) return;
    const r = e.currentTarget.getBoundingClientRect();
    const inside =
      r.width === 0 ||
      (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
    pressEnd(inside);
  };
  // A click with no pointer press behind it (detail 0) is a screen reader's activation: a hold slab takes the
  // dialog route (S2 §2.7) and a press slab commits as Enter would. Pointer presses are handled on pointerdown
  // and pointerup, and keyboard presses on keydown and keyup, which cancel the browser's own click.
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (frame || e.detail !== 0) return;
    if (hold) {
      openDialog();
      return;
    }
    pressStart();
    pressEnd(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (frame) return;
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.repeat) return;
      if (hold) {
        openDialog();
        return;
      }
      pressStart();
      pressEnd(true);
      return;
    }
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (!e.repeat) pressStart();
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (frame) return;
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      pressEnd(true);
    }
  };

  const shownStep = frame?.step ?? stepValue;
  const percent = Math.round(shownStep * 100);
  const holdProgress: HoldProgress = frame ? holdQuarter(frame.fill ?? frame.step ?? 0) : progress;
  // A hold slab that could still sign shows its route; the caption can be turned off, the link cannot.
  const signable =
    hold !== undefined &&
    !unavailable &&
    !bolted &&
    state !== "unavailable" &&
    state !== "committed" &&
    state !== "bolted" &&
    state !== "refusing";
  const showCaption = signable && hint;
  const describedBy = [signable ? hintId : null, unavailable ? reasonId : null].filter(Boolean).join(" ");

  return (
    <div
      className={["fs-slab", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state={state}
      data-depth={depth}
      data-tone={tone}
      data-size={size}
      data-bolted={bolted ? "" : undefined}
      data-motion={mode}
      data-hold-progress={hold ? holdProgress : undefined}
      data-full={width === "100%" ? "" : undefined}
      style={
        width !== undefined && width !== "100%"
          ? { ["--slab-w" as string]: typeof width === "number" ? `${width}px` : width }
          : undefined
      }
    >
      <div className="fs-slab__body">
        <motion.span
          className="fs-slab__edge fs-slab__edge--r"
          style={{ transform: edgeR, opacity: edgeOpacity }}
        />
        <motion.span
          className="fs-slab__edge fs-slab__edge--b"
          style={{ transform: edgeB, opacity: edgeOpacity }}
        />
        <motion.button
          type="button"
          className="fs-slab__face"
          style={{ transform: faceTransform }}
          aria-label={srLabel}
          aria-disabled={unavailable || state === "committed" ? true : undefined}
          aria-describedby={describedBy || undefined}
          data-testid={`${testId}.face`}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => pressEnd(false)}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => (hold ? cancelHold() : pressEnd(false))}
        >
          {hold && <motion.span className="fs-slab__fill" style={{ transform: fillTransform }} aria-hidden />}
          {bolted && (
            <>
              <span className="fs-slab__bolt fs-slab__bolt--l" aria-hidden />
              <span className="fs-slab__bolt fs-slab__bolt--r" aria-hidden />
            </>
          )}
          <span className="fs-slab__label">
            {glyph && <Glyph name={glyph} size={size === "l" ? 24 : 20} />}
            <span>{label}</span>
          </span>
        </motion.button>
      </div>
      {hold && (reduced || frame?.step !== undefined) && (state === "holding" || shownStep > 0) && (
        <div className="fs-slab__steps" data-testid={`${testId}.steps`}>
          <span className="fs-slab__steps-bar" aria-hidden>
            {[1, 2, 3, 4].map((q) => (
              <span key={q} data-on={shownStep * 4 >= q ? "" : undefined} />
            ))}
          </span>
          <span className="fs-slab__steps-text" aria-live="polite">
            {t("slab.progress", { percent })}
          </span>
        </div>
      )}
      {signable && (
        <p className="fs-slab__hint" id={hintId} data-testid={`${testId}.hint`}>
          {showCaption && (
            <>{earlyHint || frame?.showEarlyHint ? t("slab.holdUntilClick") : t("slab.holdHint")} </>
          )}
          {frame ? (
            // A still frame shows the link as it looks, without a control that does nothing.
            <span className="fs-link" data-testid={`${testId}.alt`}>
              {t("slab.altRoute")}
            </span>
          ) : (
            <button type="button" className="fs-link" data-testid={`${testId}.alt`} onClick={openDialog}>
              {t("slab.altRoute")}
            </button>
          )}
        </p>
      )}
      {unavailable && (
        <p className="fs-slab__reason" id={reasonId}>
          {onReasonClick ? (
            <button
              type="button"
              className="fs-link"
              onClick={onReasonClick}
              data-testid={`${testId}.reason`}
            >
              {unavailableReason}
            </button>
          ) : (
            <span data-testid={`${testId}.reason`}>{unavailableReason}</span>
          )}
        </p>
      )}
      {dialog && (
        <ConfirmDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          confirm={dialog}
          tone={tone}
          testId={`${testId}.dialog`}
          onConfirm={confirmDialog}
        />
      )}
    </div>
  );
}

interface ConfirmDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly confirm: WebSlabConfirm;
  readonly tone: WebSlabProps["tone"];
  readonly onConfirm: () => void;
  readonly testId: string;
}

/**
 * The hold slab's dialog route (Base UI AlertDialog): it states the amount, the recipients and the
 * consequence before asking for the key, so no action depends on timing alone.
 */
export function ConfirmDialog({ open, onOpenChange, confirm, tone, onConfirm, testId }: ConfirmDialogProps) {
  const t = useT();
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fs-dialog__scrim" />
        <AlertDialog.Popup className="fs-dialog" data-testid={testId}>
          <AlertDialog.Title className="fs-dialog__title fs-t-title-2">{confirm.title}</AlertDialog.Title>
          <AlertDialog.Description className="fs-dialog__body fs-t-body" render={<div />}>
            {confirm.body}
          </AlertDialog.Description>
          <div className="fs-dialog__actions">
            <Slab
              label={confirm.confirmLabel ?? t("confirm.approve")}
              srLabel={confirm.confirmLabel ?? t("confirm.approve")}
              depth="d3"
              tone={tone}
              stayDown
              testId={`${testId}.confirm`}
              onCommit={onConfirm}
            />
            <AlertDialog.Close className="fs-flat" data-testid={`${testId}.cancel`}>
              {confirm.cancelLabel ?? t("confirm.cancel")}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
