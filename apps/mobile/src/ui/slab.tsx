/**
 * TEMPORARY: the app's Slab until @fairsplit/ui-native ships the shared primitive (S2.7 props kept).
 *
 * A person's commit, drawn as the one flat primary button (UI gate round 2, the same as the console's): an indigo
 * face, radius 12, 48 dp, no lip, no glow, and never green (jade is only money the simulated PayPal confirmed).
 * Depth still names the consequence: d1 (reversible), d2 (changes a line), d3 plus a hold (moves money or signs);
 * the face shows a quarter of its travel. A screen has at most two slabs and at most one d3; navigation, filters,
 * rows and status never get one.
 *
 * Hold slabs follow S2.7 exactly: arm on hold, act on release inside (WCAG 2.5.2). The fill runs linearly, the face
 * sinks 2 px at each quarter, the face clunks flush at the hold time ("Release to sign"), and only a release inside
 * acts; leaving, a cancel, blur or backgrounding disarms ("Nothing was signed."). Enter, a virtual click, the visible
 * "Can't hold?" link, or TalkBack on the phone open the ConfirmDialog instead, so no action depends on timing alone.
 * Reduced motion: no travel, a stepped bar with a percentage, colour only.
 *
 * A hold slab that turns unavailable while it is held or its dialog is open (the batch changed, the request closed)
 * disarms, closes the dialog and acts on nothing it receives afterwards (I4, I6). An owner that refuses the commit
 * (`onCommit` returns or resolves to `false`, or throws) gets the slab back at rest, ready to be held again. The focus
 * ring shows for keyboard focus only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AppState,
  type GestureResponderEvent,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type ViewInstance,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { SlabState } from "../_shims/contracts";
import { radius, slabDepth, space, target } from "../_shims/tokens.native";
import { feedback } from "../platform/feedback";
import { useFs } from "../theme/theme";
import { focusRingVisible, focusVisibleOf, type InputModality, trackInputModality } from "./focus-ring";
import { Glyph, type GlyphName } from "./glyph";
import {
  type CommitOutcome,
  commitKept,
  commits,
  guardUnavailable,
  type HoldEvent,
  type HoldState,
  holdReducer,
  isCancelEvent,
  isInside,
  pageRect,
  releasePoint,
  routeFor,
  settleUnavailable,
  slabStateFor,
} from "./hold";
import { spring, tween } from "./motion";
import { ConfirmDialog, type ConfirmSpec } from "./overlay";
import { Button, Hatch } from "./primitives";
import { Txt, useT } from "./text";

export type { ConfirmSpec } from "./overlay";

export interface SlabProps {
  label: string;
  depth: "d1" | "d2" | "d3";
  tone: "chalk" | "jade";
  /** Hold-to-commit duration: `HOLD_MS.phone` (1,200 ms) for the Chair's Pirmahi. Requires `confirm`. */
  hold?: number;
  bolted?: boolean;
  /** Unavailable: flush with a hatched face, the label kept, and this reason beneath (never greyed out). */
  unavailableReason?: string;
  /** The full spoken label: what it does and, for money, how much. */
  srLabel: string;
  /**
   * The commit. A hold slab treats a return (or resolution) of `false`, or a throw, as "nothing was committed" (a
   * refused signature) and springs back to rest so it can be held again; anything else keeps it committed.
   */
  onCommit(): CommitOutcome;
  testID: string;
  icon?: GlyphName;
  /** Face height: 56 dp primary (default); `target.hero` (64) for Paminawa and Pirmahi. */
  height?: number;
  /** The dialog route of a hold slab (S2.7 ConfirmSpec). */
  confirm?: ConfirmSpec;
  /** Defaults come from the shell catalog: "Can't hold? Approve another way", "Release to sign"… */
  anotherWayLabel?: string;
  armedLabel?: string;
  holdUntilLabel?: string;
  disarmedLabel?: string;
  /** Every hold-machine transition, for a moment's phases (the board maps it with `mm5Phase`). */
  onHoldState?(state: HoldState): void;
  /** Externally committed (the signature landed): the slab stays flush. */
  committed?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
}

const PRESS_WINDOW_MS = 600;

export function Slab(props: SlabProps) {
  return props.hold ? <HoldSlab {...props} hold={props.hold} /> : <PressSlab {...props} />;
}

/* ------------------------------------------------------------------ the face (shared by both kinds) */

function SlabFace({
  depth: _depth,
  tone,
  height,
  travel,
  progress,
  flush,
  showFill,
  focused,
  label,
  icon,
  bolted,
}: {
  depth: SlabProps["depth"];
  tone: SlabProps["tone"];
  height: number;
  travel: SharedValue<number>;
  progress: SharedValue<number> | null;
  flush: boolean;
  showFill: boolean;
  focused: boolean;
  label: string;
  icon?: GlyphName;
  bolted?: boolean;
}) {
  const { t, motion } = useFs();
  const face = t.slab[tone];
  // UI gate round 2: one flat primary everywhere, the phone included. No lip, no glow, no highlight; one height
  // (48) and the control radius (12). The travel keeps its depth's values; the face shows a quarter of it.
  const faceHeight = Math.min(height, target.min);
  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: travel.get() * FACE_TRAVEL }],
  }));
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress ? progress.get() : 0 }] }));
  const faceColor = flush ? t.color.plate2 : face.face;
  const labelColor = flush ? t.color.ink2 : face.label;
  return (
    <View pointerEvents="none">
      <Animated.View
        style={[
          styles.face,
          { height: faceHeight, backgroundColor: faceColor, borderColor: flush ? t.color.rule : faceColor },
          flush || motion.reduced ? null : faceStyle,
          focused
            ? { outlineColor: t.color.pod, outlineWidth: 2, outlineOffset: 2, outlineStyle: "solid" }
            : null,
        ]}
      >
        {flush ? <Hatch /> : null}
        {showFill && progress ? (
          <Animated.View
            style={[
              StyleSheet.absoluteFill,
              styles.fillOrigin,
              // The d3 hold fills the face left to right in the lip's shade.
              { backgroundColor: face.edgeRight },
              fill,
            ]}
          />
        ) : null}
        <View style={styles.content}>
          {bolted ? <Glyph name="bolt" size={20} color={labelColor} /> : null}
          {icon ? <Glyph name={icon} size={24} color={labelColor} /> : null}
          <Txt kind="slab" style={{ color: labelColor }} numberOfLines={2}>
            {label}
          </Txt>
        </View>
      </Animated.View>
    </View>
  );
}

/** How much of the travel the flat face shows: d3's 8 px reads as a 2 px press (UI gate round 2). */
const FACE_TRAVEL = 0.25;

/** Web-only press styles (S2.7): no text selection, no browser gesture, no callout over the slab. */
const WEB_PRESS: ViewStyle =
  Platform.OS === "web"
    ? ({
        userSelect: "none",
        touchAction: "none",
        WebkitTouchCallout: "none",
        cursor: "pointer",
      } as ViewStyle)
    : {};

/** The page's last input (keys or pointers), tracked from the first slab on; null off the web. */
let readModality: (() => InputModality | null) | null = null;
function lastInput(): InputModality | null {
  if (Platform.OS !== "web" || typeof window === "undefined") return null;
  readModality ??= trackInputModality(window);
  return readModality();
}

/** The web focus ring, for keyboard focus only (`:focus-visible`, else the last input): a click or tap never rings. */
function useFocus() {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    lastInput(); // start listening before the first press, so a mouse focus is known as one
  }, []);
  return {
    focused,
    onFocus: (e?: { currentTarget?: unknown; target?: unknown }) =>
      setFocused(
        focusRingVisible({
          web: Platform.OS === "web",
          focusVisible: focusVisibleOf(e?.currentTarget ?? e?.target),
          lastInput: lastInput(),
        }),
      ),
    onBlur: () => setFocused(false),
  };
}

/* ------------------------------------------------------------------ d1 / d2: complete on release */

function PressSlab(p: SlabProps) {
  const { motion } = useFs();
  const d = slabDepth[p.depth];
  const flush = !!p.unavailableReason || !!p.bolted || !!p.committed;
  const travel = useSharedValue(p.unavailableReason || p.committed ? d : 0);
  const [state, setState] = useState<SlabState>(
    p.bolted ? "bolted" : p.unavailableReason ? "unavailable" : p.committed ? "committed" : "rest",
  );
  const focus = useFocus();

  useEffect(() => {
    setState(p.bolted ? "bolted" : p.unavailableReason ? "unavailable" : p.committed ? "committed" : "rest");
    travel.set(p.unavailableReason || p.committed ? d : 0);
  }, [p.bolted, p.unavailableReason, p.committed, d, travel]);

  const move = (to: number, how: "press" | "rebound") => {
    if (motion.reduced) return; // reduced motion: slabs change colour without moving
    travel.set(how === "press" ? withTiming(to, tween("press")) : withSpring(to, spring("rebound")));
  };

  const refuse = () => {
    setState("refusing");
    feedback.play("bolted.refuse");
    setTimeout(() => setState("bolted"), PRESS_WINDOW_MS);
  };

  return (
    <View style={p.style}>
      <Pressable
        testID={p.testID}
        dataSet={{ state }}
        accessibilityRole="button"
        accessibilityLabel={p.srLabel}
        accessibilityHint={p.unavailableReason}
        accessibilityState={{ disabled: flush || !!p.disabled }}
        disabled={p.disabled || (!!p.unavailableReason && !p.bolted)}
        onPressIn={() => {
          if (flush || p.disabled) return;
          setState("pressed");
          move(d, "press");
          if (p.depth === "d1") feedback.play("slab.d1.press");
        }}
        onPressOut={() => {
          if (flush || p.disabled) return;
          setState("rest");
          move(0, "rebound");
          if (p.depth === "d1") feedback.play("slab.d1.release");
        }}
        onPress={() => {
          if (p.bolted) return refuse();
          if (flush || p.disabled) return;
          if (p.depth !== "d1") feedback.play("slab.d2.commit");
          void p.onCommit();
        }}
        onFocus={focus.onFocus}
        onBlur={focus.onBlur}
        style={WEB_PRESS}
      >
        <SlabFace
          depth={p.depth}
          tone={p.tone}
          height={p.height ?? target.primary}
          travel={travel}
          progress={null}
          flush={flush}
          showFill={false}
          focused={focus.focused}
          label={p.label}
          icon={p.icon}
          bolted={p.bolted}
        />
      </Pressable>
      {p.unavailableReason ? (
        <Txt kind="caption" color="ink2" style={styles.below} accessible>
          {p.unavailableReason}
        </Txt>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ d3: hold, arm, release inside */

function HoldSlab(p: SlabProps & { hold: number }) {
  const { motion } = useFs();
  const tr = useT();
  const d = slabDepth[p.depth];
  const flush = !!p.unavailableReason || !!p.bolted;
  const travel = useSharedValue(p.committed ? d : 0);
  const progress = useSharedValue(p.committed ? 1 : 0);
  const [hs, setHs] = useState<HoldState>(p.committed ? "committed" : "rest");
  const [pct, setPct] = useState(p.committed ? 100 : 0);
  const hsRef = useRef<HoldState>(hs);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const acted = useRef(false);
  const handledAt = useRef(0);
  const pressedViaKey = useRef<string | null>(null);
  const node = useRef<ViewInstance>(null);
  const focus = useFocus();
  const { onCommit, onHoldState, hold } = p;
  /** Read by `dispatch` at event time, so a hold that outlives the change from live to unavailable acts on nothing. */
  const flushRef = useRef(flush);
  flushRef.current = flush;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clearTimers = useCallback(() => {
    for (const x of timers.current) clearTimeout(x);
    timers.current = [];
  }, []);

  const move = useCallback(
    (to: number, how: "press60" | "rebound") => {
      if (motion.reduced) return;
      travel.set(how === "press60" ? withTiming(to, tween("press60")) : withSpring(to, spring("rebound")));
    },
    [motion.reduced, travel],
  );

  const dispatch = useCallback(
    (event: HoldEvent) => {
      // Unavailable (I4, I6): a release or a reached hold time disarms, a dialog confirm cancels, a press does nothing.
      const e = flushRef.current ? guardUnavailable(event) : event;
      if (!e) return;
      const before = hsRef.current;
      const after = holdReducer(before, e);
      if (after === before) return;
      hsRef.current = after;
      setHs(after);
      onHoldState?.(after);
      if (after === "holding") {
        progress.set(0);
        if (!motion.reduced) progress.set(withTiming(1, { duration: hold, easing: Easing.linear }));
        setPct(0);
        for (const q of [1, 2, 3] as const) {
          timers.current.push(
            setTimeout(
              () => {
                setPct(q * 25);
                move(Math.min(d - 1, 2 * q), "press60");
                feedback.play("hold.quarter");
              },
              (hold * q) / 4,
            ),
          );
        }
        timers.current.push(setTimeout(() => dispatchRef.current({ type: "complete" }), hold));
      } else if (after === "armed") {
        clearTimers();
        setPct(100);
        move(d, "press60");
        feedback.play("hold.bottom");
      } else if (after === "committed") {
        clearTimers();
        setPct(100);
        progress.set(1);
        travel.set(motion.reduced ? 0 : d);
      } else if (after === "released-early" || after === "disarmed" || after === "rest") {
        clearTimers();
        setPct(0);
        cancelAnimation(progress);
        progress.set(motion.reduced ? 0 : withTiming(0, tween("retract")));
        move(0, "rebound");
      }
      if (commits(before, after)) {
        void commitKept(onCommit).then((kept) => {
          // The owner refused (nothing was signed): spring back to rest, ready to be held again.
          if (!kept && mounted.current && hsRef.current === "committed") {
            dispatchRef.current({ type: "reset" });
          }
        });
      }
    },
    [clearTimers, d, hold, motion.reduced, move, onCommit, onHoldState, progress, travel],
  );
  const dispatchRef = useRef(dispatch);
  dispatchRef.current = dispatch;

  useEffect(() => () => clearTimers(), [clearTimers]);

  // Turning unavailable mid-hold ends the hold and closes the dialog: nothing in progress may still act.
  useEffect(() => {
    if (!flush) return;
    const settle = settleUnavailable(hsRef.current);
    if (settle) dispatchRef.current(settle);
  }, [flush]);

  useEffect(() => {
    if (p.committed && hsRef.current !== "committed") {
      hsRef.current = "committed";
      setHs("committed");
      setPct(100);
      progress.set(1);
      travel.set(motion.reduced ? 0 : d);
    }
  }, [p.committed, d, motion.reduced, progress, travel]);

  // Backgrounding the app, or the page losing focus or visibility, disarms a hold in progress.
  useEffect(() => {
    const cancel = () => dispatchRef.current({ type: "cancel" });
    const sub = AppState.addEventListener("change", (s) => s !== "active" && cancel());
    if (Platform.OS !== "web" || typeof window === "undefined") return () => sub.remove();
    const onVisibility = () => document.visibilityState === "hidden" && cancel();
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      sub.remove();
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const native = Platform.OS !== "web";

  const onPressIn = (e: GestureResponderEvent) => {
    if (flush || p.disabled || hsRef.current === "committed") return;
    acted.current = false;
    if (native) {
      if (motion.screenReader) return; // TalkBack users get the dialog on activation
      dispatch({ type: "press" });
      return;
    }
    const key = (e.nativeEvent as unknown as { key?: string }).key;
    pressedViaKey.current = key ?? null;
    if (key !== undefined && routeFor("keyboard", key) === "dialog") return; // Enter: the dialog, on activation
    dispatch({ type: "press" });
  };

  const onPressOut = (e: GestureResponderEvent) => {
    if (native) {
      // RN calls onPressOut then, only for a release inside, onPress in the same tick.
      queueMicrotask(() => {
        if (!acted.current) dispatch({ type: "cancel" });
      });
      return;
    }
    const ev = e.nativeEvent as unknown;
    if (pressedViaKey.current !== null) {
      // Space released: focus never left the slab, so this is a release inside.
      if (hsRef.current === "holding" || hsRef.current === "armed") {
        handledAt.current = Date.now();
        dispatch({ type: "release", inside: true });
      }
      return;
    }
    if (isCancelEvent(ev)) {
      dispatch({ type: "cancel" });
      return;
    }
    const el = node.current as unknown as { getBoundingClientRect?: () => DOMRect } | null;
    const rect = el?.getBoundingClientRect?.();
    const scroll = { x: window.scrollX || 0, y: window.scrollY || 0 };
    const inside = isInside(releasePoint(ev), rect ? pageRect(rect, scroll) : null);
    handledAt.current = Date.now();
    dispatch({ type: "release", inside });
  };

  const onPress = () => {
    if (flush || p.disabled) return;
    if (native) {
      acted.current = true;
      if (motion.screenReader) return dispatch({ type: "activate" });
      dispatch({ type: "release", inside: true });
      return;
    }
    // A pointer or Space release was already handled from its own event; the browser's click that follows is not
    // a second activation. Anything else (Enter, a screen reader's virtual click) takes the dialog route.
    if (Date.now() - handledAt.current < PRESS_WINDOW_MS) return;
    dispatch({ type: "activate" });
  };

  const label = hs === "armed" ? (p.armedLabel ?? tr("slab.release")) : p.label;
  const state: SlabState = flush ? (p.bolted ? "bolted" : "unavailable") : slabStateFor(hs);

  return (
    <View style={p.style}>
      <Pressable
        ref={node}
        testID={p.testID}
        dataSet={{ state, holdProgress: String(pct) }}
        accessibilityRole="button"
        accessibilityLabel={p.srLabel}
        accessibilityHint={p.unavailableReason}
        accessibilityState={{ disabled: flush || !!p.disabled, busy: hs === "holding" }}
        disabled={p.disabled || flush}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={onPress}
        onFocus={focus.onFocus}
        onBlur={() => {
          focus.onBlur();
          if (!native) dispatch({ type: "cancel" });
        }}
        onContextMenu={(e: { preventDefault(): void }) => e.preventDefault()}
        style={WEB_PRESS}
      >
        <SlabFace
          depth={p.depth}
          tone={p.tone}
          height={p.height ?? target.hero}
          travel={travel}
          progress={progress}
          flush={flush}
          showFill={!motion.reduced}
          focused={focus.focused}
          label={label}
          icon={p.icon}
          bolted={p.bolted}
        />
      </Pressable>
      {motion.reduced && (hs === "holding" || hs === "armed") ? (
        <View style={styles.stepped} accessibilityLiveRegion="polite" testID={`${p.testID}.steps`}>
          {[25, 50, 75, 100].map((q) => (
            <SteppedCell key={q} on={pct >= q} />
          ))}
          <Txt kind="figureS" color="ink2" style={{ marginLeft: space.s8 }}>
            {tr("slab.progress", { pct })}
          </Txt>
        </View>
      ) : null}
      {hs === "released-early" && !flush ? (
        <Txt kind="caption" color="ink2" style={styles.below} accessibilityLiveRegion="polite">
          {p.holdUntilLabel ?? tr("slab.holdUntil")}
        </Txt>
      ) : null}
      {hs === "disarmed" ? (
        <Txt kind="caption" color="ink2" style={styles.below} accessibilityLiveRegion="polite">
          {p.disarmedLabel ?? tr("slab.disarmed")}
        </Txt>
      ) : null}
      {p.unavailableReason ? (
        <Txt kind="caption" color="ink2" style={styles.below} accessible>
          {p.unavailableReason}
        </Txt>
      ) : null}
      {p.confirm && !flush && hs !== "committed" ? (
        <Button
          variant="text"
          label={p.anotherWayLabel ?? tr("slab.another")}
          onPress={() => dispatch({ type: "activate" })}
          testID={`${p.testID}.another-way`}
          style={styles.another}
        />
      ) : null}
      {p.confirm ? (
        <ConfirmDialog
          visible={hs === "confirm"}
          spec={p.confirm}
          testID={`${p.testID}.confirm`}
          onCancel={() => dispatch({ type: "dialog-cancel" })}
          onConfirm={() => dispatch({ type: "dialog-confirm" })}
        />
      ) : null}
    </View>
  );
}

function SteppedCell({ on }: { on: boolean }) {
  const { t } = useFs();
  return (
    <View
      style={[styles.step, { backgroundColor: on ? t.color.ink : t.color.plate2, borderColor: t.color.rule }]}
    />
  );
}

const styles = StyleSheet.create({
  face: { borderRadius: radius.control, borderWidth: 1, overflow: "hidden", justifyContent: "center" },
  fillOrigin: { transformOrigin: "left center" },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s12,
    paddingHorizontal: space.s16,
  },
  stepped: { flexDirection: "row", alignItems: "center", gap: space.s4, marginTop: space.s8 },
  step: { flex: 1, height: 8, borderWidth: 1 },
  below: { marginTop: space.s4 },
  another: { alignSelf: "flex-start", marginTop: space.s4 },
});
