// Slab: a human commit (design §2.5, S2 §2.5, §2.7). A solid face with a 1 px inner top highlight and two
// parallelogram edges whose depth equals the consequence: d1 reversible, d2 changes a line, d3 moves money or
// signs. Pressing moves the face by (t, t) and collapses the edges, transform-only.
//
// Hold slabs (d3) arm on hold and act on release inside (S2 §2.7, WCAG 2.5.2): the face sinks in four ratchet
// steps over 1,600 ms (1,200 on the Chair's phone), clunks flush and reads "Release to sign"; releasing inside
// signs. Leaving the slab, blur, a cancelled pointer, scrolling or a hidden page disarms it, and nothing is
// signed. The route is chosen per event, never by detecting a screen reader: a pointer, touch, pen or Space
// hold drives the slab; Enter, a click with no pointer behind it or the visible link opens the dialog.
//
// One press at a time: the keyboard, or one pointer followed on the window until it lets go, so a release or a
// move off the slab is seen even when the browser will not capture the pointer. A second finger, or Space
// during a pointer hold, is not part of that press: it neither ends it nor signs it.
//
// Every way to commit (release, a signed hold, the dialog) passes one gate: a still frame, an unavailable slab
// and a bolted slab never commit, a committed slab never commits twice, and nothing commits while a commit is
// in flight. A commit may return a promise (S2 §2.7: `onCommit(): Promise<void>`). If it rejects, nothing was
// done: the face springs back, a hold slab says "Nothing was signed." and the slab can be pressed again.

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
  type HoldChange,
  type HoldProgress,
  holdQuarter,
  type SlabConfirm,
  type SlabProps,
  type SlabState,
} from "./contract.js";
import { feedback } from "./feedback.js";
import { Glyph, type GlyphName } from "./Glyph.js";
import { Seal } from "./Seal.js";

/** The dialog route on web: the body is any node (the amount, the recipient list, the consequence). */
export type WebSlabConfirm = SlabConfirm<ReactNode>;

/** What the caption says after a hold that did not sign. */
export type SlabNotice = "early" | "disarmed";

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
  /** "Hold until it clicks" after an early release; "Nothing was signed." after a disarm. */
  readonly notice?: SlabNotice;
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

/** Who is pressing: the keyboard, a screen reader's click, or one pointer by its id. */
type PressSource = "key" | "virtual" | number;

const STEP_TRAVEL = TIMING.holdStepTravel;

/**
 * Whether a client point is over the slab: the face at rest plus its edges, d px to the right and below. The
 * face sinks up to d px while held, so a press near its top or left edge must not count as leaving. jsdom
 * lays nothing out (a zero box), so there every point is inside.
 */
function withinFootprint(body: HTMLElement | null, d: number, x: number, y: number): boolean {
  if (!body) return true;
  const r = body.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return true;
  return x >= r.left && x <= r.right + d && y >= r.top && y <= r.bottom + d;
}

/** A commit that answers later: anything with a `then`. */
function isPending(outcome: unknown): outcome is PromiseLike<unknown> {
  return typeof (outcome as { then?: unknown } | null | undefined)?.then === "function";
}

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
    onHoldChange,
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
  const [notice, setNotice] = useState<SlabNotice | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  /** Counts the dialog's openings, so each one offers a fresh confirm slab. */
  const [opening, setOpening] = useState(0);
  const [busy, setBusyNow] = useState(false);
  const state = frame?.state ?? liveState;

  // The live state as of the latest change, so a second commit in the same tick sees the first.
  const liveRef = useRef<SlabState>(baseState);
  const setLiveState = useCallback((next: SlabState) => {
    liveRef.current = next;
    setLiveStateNow(next);
  }, []);
  /** A commit is in flight: the slab takes no press, and no route commits, until it settles. */
  const busyRef = useRef(false);
  const setBusy = useCallback((next: boolean) => {
    busyRef.current = next;
    setBusyNow(next);
  }, []);
  /** Numbers the commits, so an answer that arrives after unmount changes nothing. */
  const attempt = useRef(0);
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );
  // Hold timers, window listeners, the dialog and a commit's answer outlive the render that started them, so
  // they read the slab's availability and the caller's latest callbacks from here, synced before paint.
  const latest = useRef({ still: frame !== undefined, unavailable, bolted, onCommit, onHoldChange });
  useLayoutEffect(() => {
    latest.current = { still: frame !== undefined, unavailable, bolted, onCommit, onHoldChange };
  });
  const report = useCallback((change: HoldChange) => latest.current.onHoldChange?.(change), []);

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
  /** A hold is in progress (pointer, touch, pen or Space down). */
  const holding = useRef(false);
  /** The hold reached its time: releasing inside signs. */
  const armed = useRef(false);
  /** A d1 or d2 press is in progress. */
  const pressed = useRef(false);
  /** Who is pressing now, if anyone: one press at a time. */
  const source = useRef<PressSource | null>(null);
  /** Stops following the pressing pointer on the window. */
  const unfollow = useRef<(() => void) | null>(null);
  const faceRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const altRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const reasonId = useId();

  // Still frames: follow the frame values exactly. When a frame goes (a HoldCard leaves "resolving"), the live
  // slab takes back the travel, fill and edges of its own state.
  const framed = useRef(frame !== undefined);
  useEffect(() => {
    if (frame) {
      framed.current = true;
      travel.set(frame.travel ?? (frame.state === "unavailable" ? d : 0));
      fill.set(frame.fill ?? 0);
      edgeOpacity.set(frame.edgeOpacity ?? 1);
      setStepValue(frame.step ?? 0);
      return;
    }
    if (!framed.current) return;
    framed.current = false;
    const now = liveRef.current;
    const committed = now === "committed";
    travel.jump(now === "unavailable" || (committed && !reduced) ? d : 0);
    fill.jump(committed && hold ? 1 : 0);
    edgeOpacity.jump(committed && reduced ? 0 : 1);
    setStepValue(committed && hold ? 1 : 0);
  }, [frame, travel, fill, edgeOpacity, d, reduced, hold]);

  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  /** The press is over, however it ended: nobody is pressing, and its pointer is no longer followed. */
  const clearPress = useCallback(() => {
    source.current = null;
    unfollow.current?.();
    unfollow.current = null;
  }, []);
  useEffect(() => clearPress, [clearPress]);

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

  /**
   * S2 §2.7: never from a still frame, an unavailable or a bolted slab, never while a commit is in flight, and
   * never twice.
   */
  const canCommit = useCallback(() => {
    const now = latest.current;
    return (
      !now.still && !now.unavailable && !now.bolted && !busyRef.current && liveRef.current !== "committed"
    );
  }, []);

  /**
   * The commit did not go through (its promise rejected, or it threw), so nothing was done. A slab still where
   * its commit left it springs back and can be pressed again, and a hold slab says "Nothing was signed."; one
   * that became unavailable or bolted in the meantime keeps that state.
   */
  const unsign = useCallback(
    (id: number) => {
      if (id !== attempt.current) return;
      setBusy(false);
      const now = liveRef.current;
      if (now !== "committed" && now !== "rest") return;
      setLiveState("rest");
      setProgress(0);
      setStepValue(0);
      if (hold) setNotice("disarmed");
      // A still frame owns the motion values; the live ones come back when it goes.
      if (latest.current.still) return;
      if (hold) animate(fill, 0, reduced ? tween("reduced") : tween("retract200"));
      moveTo(0, "rebound");
      if (edgeOpacity.get() < 1) animate(edgeOpacity, 1, tween("edgesFade"));
    },
    [setBusy, setLiveState, hold, fill, reduced, moveTo, edgeOpacity],
  );
  // A commit's answer arrives after the render that sent it: it settles through the latest `unsign`.
  const unsignLatest = useRef(unsign);
  useLayoutEffect(() => {
    unsignLatest.current = unsign;
  });

  const commit = useCallback(() => {
    if (!canCommit()) return;
    const id = ++attempt.current;
    if (stayDown) {
      setLiveState("committed");
      if (reduced) animate(edgeOpacity, 0, tween("edgesFade"));
    } else {
      setLiveState("rest");
      moveTo(0, "rebound");
    }
    let outcome: unknown;
    try {
      outcome = latest.current.onCommit();
    } catch (error) {
      // A commit that throws did nothing: say so, then let the error surface as any handler's would.
      unsign(id);
      throw error;
    }
    if (!isPending(outcome)) return;
    setBusy(true);
    outcome.then(
      () => {
        if (id === attempt.current) setBusy(false);
      },
      () => unsignLatest.current(id),
    );
  }, [canCommit, stayDown, setLiveState, reduced, edgeOpacity, moveTo, unsign, setBusy]);

  // ------------------------------------------------------------------- hold: arm on hold, act on release
  /** The hold time is reached: the face clunks flush and the slab waits for a release inside. */
  const arm = useCallback(() => {
    if (!holding.current) return;
    if (!canCommit()) return;
    armed.current = true;
    setLiveState("armed");
    setProgress(100);
    setStepValue(1);
    fill.set(1);
    moveTo(d, "press60");
    feedback.play("hold.bottom");
    report("armed");
  }, [canCommit, setLiveState, fill, moveTo, d, report]);

  const startHold = useCallback(() => {
    if (!hold || holding.current) return;
    holding.current = true;
    armed.current = false;
    setNotice(null);
    setLiveState("holding");
    setProgress(0);
    setStepValue(0);
    fill.set(0);
    animate(fill, 1, { duration: hold / 1000, ease: "linear" });
    report("holding");
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
    timers.current.push(setTimeout(arm, hold));
  }, [hold, setLiveState, fill, report, moveTo, arm]);

  /**
   * Ends a hold without signing: before the hold time it was released early ("Hold until it clicks"); once
   * armed it is disarmed ("Nothing was signed."). The face springs back and the fill retracts.
   */
  const cancelHold = useCallback(() => {
    if (!holding.current) return;
    const wasArmed = armed.current;
    holding.current = false;
    armed.current = false;
    clearPress();
    clearTimers();
    setProgress(0);
    setStepValue(0);
    setLiveState("rest");
    setNotice(wasArmed ? "disarmed" : "early");
    animate(fill, 0, reduced ? tween("reduced") : tween("retract200"));
    moveTo(0, "rebound");
    report(wasArmed ? "disarmed" : "released-early");
  }, [clearPress, clearTimers, setLiveState, fill, reduced, moveTo, report]);

  /** A release inside the slab: an armed slab signs; anything earlier was let go too soon. */
  const releaseInside = useCallback(() => {
    if (!holding.current) return;
    if (!armed.current) {
      cancelHold();
      return;
    }
    holding.current = false;
    armed.current = false;
    clearPress();
    clearTimers();
    commit();
  }, [cancelHold, clearPress, clearTimers, commit]);

  /** Drops any press or hold in progress, silently: the slab's availability changed under it. */
  const abandonPress = useCallback(() => {
    clearTimers();
    clearPress();
    pressed.current = false;
    if (!holding.current) return;
    holding.current = false;
    armed.current = false;
    setProgress(0);
    setStepValue(0);
    fill.jump(0);
  }, [clearTimers, clearPress, fill]);

  // A hidden page, the window losing focus, or a scroll that moves the slab ends a hold in progress. A scroll
  // elsewhere (a log filling up beside it) does not.
  useEffect(() => {
    if (!hold) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") cancelHold();
    };
    const onBlur = () => cancelHold();
    const onScroll = (e: Event) => {
      const target = e.target;
      const face = faceRef.current;
      // The page scrolling arrives from the window (not a Node; jsdom's window is not even `=== window`) or
      // from the document, which contains the slab; an element scrolling moves the slab only if it contains it.
      const movesSlab = !(target instanceof Node) || (face !== null && target.contains(face));
      if (movesSlab) cancelHold();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("blur", onBlur);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("scroll", onScroll, { capture: true });
    };
  }, [hold, cancelHold]);

  // Availability changes. A slab that becomes available rises on the settle spring (MM-5 "rising"); one that
  // becomes unavailable or bolted abandons a press in progress and closes its dialog: neither may sign now.
  const previousBase = useRef(baseState);
  useEffect(() => {
    if (frame) return;
    const was = previousBase.current;
    previousBase.current = baseState;
    if (was === baseState) return;
    abandonPress();
    setDialogOpen(false);
    setNotice(null);
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
  }, [baseState, frame, abandonPress, setLiveState, travel, edgeOpacity, reduced, d]);

  // ------------------------------------------------------------------- press (d1, d2) and refusal
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

  /** Starts a press by `who`. False when there is none: another press is under way, or the slab takes none. */
  const pressStart = useCallback(
    (who: PressSource): boolean => {
      const now = liveRef.current;
      if (source.current !== null || unavailable || now === "unavailable" || now === "committed")
        return false;
      if (bolted) {
        refuse();
        return false;
      }
      if (busyRef.current) return false;
      source.current = who;
      if (hold) {
        startHold();
        return true;
      }
      pressed.current = true;
      setLiveState("pressed");
      moveTo(d, "press");
      if (depth === "d1") feedback.play("slab.d1.press");
      return true;
    },
    [unavailable, bolted, hold, refuse, startHold, setLiveState, moveTo, d, depth],
  );

  /** The press in progress ends: released inside, it commits (a hold slab once armed); otherwise it springs back. */
  const pressEnd = useCallback(
    (inside: boolean) => {
      if (source.current === null) return;
      if (hold) {
        if (!holding.current) clearPress();
        else if (inside) releaseInside();
        else cancelHold();
        return;
      }
      clearPress();
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
    [hold, clearPress, releaseInside, cancelHold, depth, setLiveState, moveTo, commit],
  );

  // The window follows the pressing pointer through the latest callbacks: its listeners outlive renders.
  const onWindow = useRef({ move: (_x: number, _y: number) => {}, release: (_inside: boolean) => {} });
  useLayoutEffect(() => {
    onWindow.current = {
      // Leaving the slab ends a hold: it is released early, or disarmed once armed (S2 §2.7).
      move: (x, y) => {
        if (hold && holding.current && !withinFootprint(bodyRef.current, d, x, y)) cancelHold();
      },
      release: (inside) => pressEnd(inside),
    };
  });

  /**
   * Follows one pointer on the window until the press ends. Capture usually keeps the moves and the release on
   * the face, but a browser may refuse capture or lose it; followed here, a release or a move off the slab is
   * still seen, so a hold never outlives its pointer.
   */
  const follow = useCallback(
    (pointerId: number, view: Window) => {
      unfollow.current?.();
      const ours = (e: globalThis.PointerEvent) => e.pointerId === pointerId && source.current === pointerId;
      const onMove = (e: globalThis.PointerEvent) => {
        if (ours(e)) onWindow.current.move(e.clientX, e.clientY);
      };
      const onUp = (e: globalThis.PointerEvent) => {
        if (ours(e)) onWindow.current.release(withinFootprint(bodyRef.current, d, e.clientX, e.clientY));
      };
      const onCancel = (e: globalThis.PointerEvent) => {
        if (ours(e)) onWindow.current.release(false);
      };
      view.addEventListener("pointermove", onMove, true);
      view.addEventListener("pointerup", onUp, true);
      view.addEventListener("pointercancel", onCancel, true);
      unfollow.current = () => {
        view.removeEventListener("pointermove", onMove, true);
        view.removeEventListener("pointerup", onUp, true);
        view.removeEventListener("pointercancel", onCancel, true);
      };
    },
    [d],
  );

  // ------------------------------------------------------------------- the dialog route (hold slabs)
  /** Opens only from rest. A bolted slab refuses instead; an unavailable, committed or busy one does nothing. */
  const openDialog = useCallback(() => {
    if (!hold || frame) return;
    const now = liveRef.current;
    if (unavailable || now === "unavailable" || now === "committed") return;
    if (bolted) {
      refuse();
      return;
    }
    if (now !== "rest" || busyRef.current || source.current !== null) return;
    setNotice(null);
    setOpening((n) => n + 1);
    setDialogOpen(true);
    report("dialog");
  }, [hold, frame, unavailable, bolted, refuse, report]);

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

  /**
   * Where focus goes as the dialog closes: back to whatever opened it, unless that is gone. Signing removes
   * the "Approve another way" link, so focus lands on the face instead of falling to the page (G5).
   */
  const dialogFinalFocus = useCallback(
    () => (altRef.current?.isConnected ? true : (faceRef.current ?? true)),
    [],
  );

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    if (frame || e.button !== 0) return;
    const id = e.pointerId;
    if (source.current !== null) {
      // A press is under way. A second finger, or a pointer during a Space press, is not part of it. The same
      // pointer pressing again means its release never reached the page (it was let go outside the window):
      // that press is over, and this one starts afresh.
      if (source.current !== id) return;
      pressEnd(false);
    }
    if (!pressStart(id)) return;
    // Capture keeps the moves and the release on the face. A pointer the browser no longer tracks throws here;
    // the press still counts, and the window follows it either way.
    try {
      e.currentTarget.setPointerCapture?.(id);
    } catch {
      // Followed on the window below.
    }
    follow(id, e.currentTarget.ownerDocument.defaultView ?? window);
  };
  // Keyboard presses act on keydown and keyup and cancel the browser's own click. Should a browser send that
  // click anyway (detail 0, straight after the key), it is the same press, not a screen reader's activation.
  const keyClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const markKeyPress = () => {
    if (keyClick.current) clearTimeout(keyClick.current);
    keyClick.current = setTimeout(() => {
      keyClick.current = null;
    }, 0);
  };
  useEffect(
    () => () => {
      if (keyClick.current) clearTimeout(keyClick.current);
    },
    [],
  );
  // A click with no pointer press behind it (detail 0) is a screen reader's activation: a hold slab takes the
  // dialog route (S2 §2.7) and a press slab commits as Enter would. Pointer presses are handled on pointerdown
  // and on the window.
  const onClick = (e: MouseEvent<HTMLButtonElement>) => {
    if (frame || e.detail !== 0 || keyClick.current) return;
    if (hold) {
      openDialog();
      return;
    }
    if (pressStart("virtual")) pressEnd(true);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (frame) return;
    if (e.key === "Enter") {
      e.preventDefault();
      markKeyPress();
      if (e.repeat) return;
      if (hold) {
        openDialog();
        return;
      }
      if (pressStart("key")) pressEnd(true);
      return;
    }
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (!e.repeat) pressStart("key");
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (frame) return;
    if (e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      markKeyPress();
      // Only the key's own press ends here: Space never signs a hold a pointer is making.
      if (source.current === "key") pressEnd(true);
    }
  };

  const shownStep = frame?.step ?? stepValue;
  const percent = Math.round(shownStep * 100);
  const holdProgress: HoldProgress = frame
    ? frame.state === "armed"
      ? 100
      : holdQuarter(frame.fill ?? frame.step ?? 0)
    : progress;
  const shownNotice = frame ? frame.notice : notice;
  const shownBusy = !frame && busy;
  // A hold slab that could still sign shows its route; the caption can be turned off, the link cannot.
  const signable =
    hold !== undefined &&
    !unavailable &&
    !bolted &&
    !shownBusy &&
    state !== "unavailable" &&
    state !== "committed" &&
    state !== "bolted" &&
    state !== "refusing";
  const caption =
    shownNotice === "disarmed"
      ? t("slab.nothingSigned")
      : shownNotice === "early"
        ? t("slab.holdUntilClick")
        : t("slab.holdHint");
  // The outcome of a hold that did not sign is said even when the standing caption is turned off.
  const showCaption = signable && (hint || Boolean(shownNotice));
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
      data-busy={shownBusy ? "" : undefined}
      data-motion={mode}
      data-hold-progress={hold ? holdProgress : undefined}
      data-full={width === "100%" ? "" : undefined}
      style={
        width !== undefined && width !== "100%"
          ? { ["--slab-w" as string]: typeof width === "number" ? `${width}px` : width }
          : undefined
      }
    >
      <div className="fs-slab__body" ref={bodyRef}>
        <motion.span
          className="fs-slab__edge fs-slab__edge--r"
          style={{ transform: edgeR, opacity: edgeOpacity }}
        />
        <motion.span
          className="fs-slab__edge fs-slab__edge--b"
          style={{ transform: edgeB, opacity: edgeOpacity }}
        />
        <motion.button
          ref={faceRef}
          type="button"
          className="fs-slab__face"
          style={{ transform: faceTransform }}
          aria-label={srLabel}
          aria-disabled={unavailable || state === "committed" || shownBusy ? true : undefined}
          aria-busy={shownBusy || undefined}
          aria-describedby={describedBy || undefined}
          data-testid={`${testId}.face`}
          onPointerDown={onPointerDown}
          onClick={onClick}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={() => pressEnd(false)}
          onContextMenu={hold ? (e) => e.preventDefault() : undefined}
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
            <span>{state === "armed" ? t("slab.release") : label}</span>
          </span>
        </motion.button>
      </div>
      {hold &&
        (reduced || frame?.step !== undefined) &&
        (state === "holding" || state === "armed" || shownStep > 0) && (
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
            <span className="fs-slab__caption" aria-live="polite" data-notice={shownNotice ?? undefined}>
              {caption}{" "}
            </span>
          )}
          {frame ? (
            // A still frame shows the link as it looks, without a control that does nothing.
            <span className="fs-link" data-testid={`${testId}.alt`}>
              {t("slab.altRoute")}
            </span>
          ) : (
            <button
              ref={altRef}
              type="button"
              className="fs-link"
              data-testid={`${testId}.alt`}
              onClick={openDialog}
            >
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
          onOpenChange={(open) => {
            setDialogOpen(open);
            // "Not now", Escape or a press outside: back to rest, nothing signed (MM-5 leaves confirm-1/2).
            if (!open) report("dismissed");
          }}
          confirm={dialog}
          tone={tone}
          testId={`${testId}.dialog`}
          onConfirm={confirmDialog}
          finalFocus={dialogFinalFocus}
          opening={opening}
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
  /** Where focus goes as the dialog closes (Base UI `finalFocus`); by default, back to what opened it. */
  readonly finalFocus?: () => HTMLElement | boolean | null;
  /** Changes with each opening, so each opening offers a fresh confirm slab, even one reopened mid-exit. */
  readonly opening?: number;
}

/**
 * The hold slab's dialog route (Base UI AlertDialog): it states the amount, the recipients and the
 * consequence, and shows the batch's seal at 96 px with its hash in groups of four, before asking for the key,
 * so no action depends on timing alone. Focus opens on "Not now", the least destructive control, so a second
 * Enter after the one that opened the dialog never signs by accident.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  confirm,
  tone,
  onConfirm,
  testId,
  finalFocus,
  opening = 0,
}: ConfirmDialogProps) {
  const t = useT();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fs-dialog__scrim" />
        <AlertDialog.Popup
          className="fs-dialog"
          data-testid={testId}
          initialFocus={cancelRef}
          finalFocus={finalFocus}
        >
          <AlertDialog.Title className="fs-dialog__title fs-t-title-2">{confirm.title}</AlertDialog.Title>
          <div className="fs-dialog__content" data-sealed={confirm.seal ? "" : undefined}>
            <AlertDialog.Description className="fs-dialog__body fs-t-body" render={<div />}>
              {confirm.body}
            </AlertDialog.Description>
            {confirm.seal && (
              <Seal
                batchSha256={confirm.seal.batchSha256}
                size={96}
                keys={confirm.seal.keys}
                showHash
                className="fs-dialog__seal"
                testId={`${testId}.seal`}
              />
            )}
          </div>
          <div className="fs-dialog__actions">
            <Slab
              key={opening}
              label={confirm.confirmLabel ?? t("confirm.approve")}
              srLabel={confirm.confirmLabel ?? t("confirm.approve")}
              depth="d3"
              tone={tone}
              stayDown
              testId={`${testId}.confirm`}
              onCommit={onConfirm}
            />
            <AlertDialog.Close ref={cancelRef} className="fs-flat" data-testid={`${testId}.cancel`}>
              {confirm.cancelLabel ?? t("confirm.cancel")}
            </AlertDialog.Close>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
