/**
 * TEMPORARY: the app's Slab until @fairsplit/ui-native ships the shared primitive (S2.7 props kept).
 *
 * A human commit is a square slab whose depth matches its consequence (d1 3 px, d2 5 px, d3 8 px). The face
 * travels (t, t); the right and bottom edges are 45° parallelograms anchored to the far wall that collapse at t = d
 * (design §2.5). Hold slabs fill linearly, step at each quarter, and commit when they bottom out; every hold has a
 * dialog route (screen reader, "Can't hold?") because no action may depend on timing alone. Reduced motion: no
 * travel, a stepped bar with a percentage, colour changes only.
 */
import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { radius, slabDepth, space, springs, target, tweens } from "../_shims/tokens.native";
import { feedback } from "../platform/feedback";
import { useFs } from "../theme/theme";
import { Glyph, type GlyphName } from "./glyph";
import { Button, Hatch } from "./primitives";
import { Txt } from "./text";

export interface SlabConfirm {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
}

export interface SlabProps {
  label: string;
  depth: "d1" | "d2" | "d3";
  tone: "chalk" | "jade";
  /** Hold-to-commit duration (1600 console, 1200 phone). */
  hold?: number;
  bolted?: boolean;
  unavailableReason?: string;
  srLabel: string;
  onCommit(): void;
  testID: string;
  icon?: GlyphName;
  height?: number;
  /** Required for hold slabs: the dialog route. */
  confirm?: SlabConfirm;
  anotherWayLabel?: string;
  holdUntilLabel?: string;
  onHoldChange?(holding: boolean): void;
  /** Externally committed (e.g. the signature landed): stays flush. */
  committed?: boolean;
  disabled?: boolean;
}

type SlabState = "rest" | "pressed" | "holding" | "committed" | "unavailable" | "bolted";

const bez = (b: readonly number[] | null) =>
  b ? Easing.bezier(b[0] ?? 0, b[1] ?? 0, b[2] ?? 1, b[3] ?? 1) : Easing.linear;

export function Slab(props: SlabProps) {
  const {
    label,
    depth,
    tone,
    hold,
    bolted,
    unavailableReason,
    srLabel,
    onCommit,
    testID,
    icon,
    height = target.primary,
    confirm,
    anotherWayLabel,
    holdUntilLabel,
    onHoldChange,
    committed,
    disabled,
  } = props;
  const { t, motion } = useFs();
  const d = slabDepth[depth];
  const face = t.slab[tone];
  const [width, setWidth] = useState(0);
  const [state, setState] = useState<SlabState>(
    bolted ? "bolted" : unavailableReason ? "unavailable" : committed ? "committed" : "rest",
  );
  const [pct, setPct] = useState(0);
  const [early, setEarly] = useState(false);
  const [dialog, setDialog] = useState(false);
  const travel = useSharedValue(unavailableReason || committed ? d : 0);
  const progress = useSharedValue(0);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const done = useRef(false);

  const reduced = motion.reduced;
  const flush = !!unavailableReason || !!bolted;

  useEffect(() => {
    if (bolted) setState("bolted");
    else if (unavailableReason) setState("unavailable");
    else if (committed) setState("committed");
    else if (!done.current) setState("rest");
    travel.set(unavailableReason || committed ? d : 0);
  }, [bolted, unavailableReason, committed, d, travel]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const clearTimers = () => {
    for (const x of timers.current) clearTimeout(x);
    timers.current = [];
  };

  const moveTo = (to: number, kind: "press" | "press60" | "rebound") => {
    if (reduced) return; // reduced motion: slabs change colour without moving
    if (kind === "rebound") travel.set(withSpring(to, springs.rebound));
    else travel.set(withTiming(to, { duration: tweens[kind].duration, easing: bez(tweens[kind].bezier) }));
  };

  const commit = () => {
    if (done.current) return;
    done.current = true;
    clearTimers();
    moveTo(d, "press60");
    setState("committed");
    setPct(100);
    feedback.play(depth === "d1" ? "slab.d1.press" : hold ? "hold.bottom" : "slab.d2.commit");
    onCommit();
  };

  const startHold = () => {
    if (!hold || flush || disabled || done.current) return;
    setState("holding");
    setEarly(false);
    onHoldChange?.(true);
    progress.set(0);
    progress.set(withTiming(1, { duration: hold, easing: Easing.linear }));
    for (const q of [1, 2, 3]) {
      timers.current.push(
        setTimeout(
          () => {
            setPct(q * 25);
            moveTo(Math.min(d - 1, 2 * q), "press60");
            feedback.play("hold.quarter");
          },
          (hold * q) / 4,
        ),
      );
    }
    timers.current.push(setTimeout(commit, hold));
  };

  const cancelHold = () => {
    if (!hold || done.current || state !== "holding") return;
    clearTimers();
    cancelAnimation(progress);
    progress.set(withTiming(0, { duration: tweens.retract.duration }));
    moveTo(0, "rebound");
    setPct(0);
    setState("rest");
    setEarly(true);
    onHoldChange?.(false);
  };

  const onPressIn = () => {
    if (flush || disabled || done.current) return;
    if (hold) {
      if (motion.screenReader) return; // TalkBack users get the dialog on activation instead
      startHold();
      return;
    }
    setState("pressed");
    moveTo(d, "press");
    if (depth === "d1") feedback.play("slab.d1.press");
  };

  const onPressOut = () => {
    if (hold) {
      cancelHold();
      return;
    }
    if (flush || disabled || done.current) return;
    moveTo(0, "rebound");
    setState("rest");
    if (depth === "d1") feedback.play("slab.d1.release");
  };

  const onPress = () => {
    if (flush || disabled) return;
    if (hold) {
      if (motion.screenReader && confirm) setDialog(true);
      return;
    }
    // Reversible slabs commit on release; they can be pressed again.
    feedback.play(depth === "d1" ? "slab.d1.release" : "slab.d2.commit");
    onCommit();
  };

  const faceStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: travel.get() }, { translateY: travel.get() }],
  }));
  const rightEdge = useAnimatedStyle(() => ({
    transform: [
      { translateX: travel.get() },
      { translateY: travel.get() },
      { skewY: "45deg" },
      { scaleX: Math.max(0, (d - travel.get()) / d) },
    ],
  }));
  const bottomEdge = useAnimatedStyle(() => ({
    transform: [
      { translateX: travel.get() },
      { translateY: travel.get() },
      { skewX: "45deg" },
      { scaleY: Math.max(0, (d - travel.get()) / d) },
    ],
  }));
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: progress.get() }] }));

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.max(0, e.nativeEvent.layout.width - d));
  const faceColor = flush ? t.color.plate2 : face.face;
  const labelColor = flush ? t.color.ink2 : face.label;
  const showEdges = !flush && !reduced;

  return (
    <View>
      <Pressable
        testID={testID}
        dataSet={{ state, holdProgress: String(pct) }}
        accessibilityRole="button"
        accessibilityLabel={srLabel}
        accessibilityState={{ disabled: flush || !!disabled }}
        accessibilityHint={unavailableReason}
        disabled={disabled}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        onPress={onPress}
        onLayout={onLayout}
        style={{ paddingRight: d, paddingBottom: d }}
      >
        {width > 0 && showEdges ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.edge,
                { left: width, top: 0, width: d, height, backgroundColor: face.edgeRight },
                rightEdge,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.edge,
                { left: 0, top: height, width, height: d, backgroundColor: face.edgeBottom },
                bottomEdge,
              ]}
            />
          </>
        ) : null}
        <Animated.View
          style={[
            styles.face,
            { height, backgroundColor: faceColor, borderColor: flush ? t.color.rule : faceColor },
            flush ? null : faceStyle,
          ]}
        >
          {flush ? <Hatch /> : null}
          {hold && !reduced ? (
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                { backgroundColor: tone === "jade" ? "rgba(28,21,17,0.14)" : "rgba(255,255,255,0.16)" },
                styles.fillOrigin,
                fill,
              ]}
            />
          ) : null}
          {!flush ? <View pointerEvents="none" style={styles.highlight} /> : null}
          <View style={styles.content} pointerEvents="none">
            {bolted ? <Glyph name="bolt" size={20} color={labelColor} /> : null}
            {icon ? <Glyph name={icon} size={24} color={labelColor} /> : null}
            <Txt kind="slab" style={{ color: labelColor }}>
              {label}
            </Txt>
          </View>
        </Animated.View>
      </Pressable>
      {hold && reduced && state === "holding" ? (
        <View style={[styles.stepped, { borderColor: t.color.rule }]} accessibilityLiveRegion="polite">
          {[25, 50, 75, 100].map((q) => (
            <View
              key={q}
              style={[styles.step, { backgroundColor: pct >= q ? t.color.ink : t.color.plate2 }]}
            />
          ))}
          <Txt kind="figureS" color="ink2" style={{ marginLeft: space.s8 }}>
            {`${pct}%`}
          </Txt>
        </View>
      ) : null}
      {early && holdUntilLabel ? (
        <Txt kind="caption" color="ink2" style={{ marginTop: space.s4 }} accessibilityLiveRegion="polite">
          {holdUntilLabel}
        </Txt>
      ) : null}
      {unavailableReason ? (
        <Txt kind="caption" color="ink2" style={{ marginTop: space.s4 }} accessible>
          {unavailableReason}
        </Txt>
      ) : null}
      {hold && confirm && anotherWayLabel && !flush && state !== "committed" ? (
        <Button
          variant="text"
          label={anotherWayLabel}
          onPress={() => setDialog(true)}
          testID={`${testID}.another-way`}
          style={{ alignSelf: "flex-start", marginTop: space.s4 }}
        />
      ) : null}
      {confirm ? (
        <ConfirmDialog
          visible={dialog}
          {...confirm}
          onCancel={() => setDialog(false)}
          onConfirm={() => {
            setDialog(false);
            commit();
          }}
        />
      ) : null}
    </View>
  );
}

/** Material dialog route for hold-to-commit (S2.7 "Hold alternative"). */
export function ConfirmDialog(p: SlabConfirm & { visible: boolean; onConfirm(): void; onCancel(): void }) {
  const { t } = useFs();
  return (
    <Modal
      transparent
      visible={p.visible}
      animationType="fade"
      onRequestClose={p.onCancel}
      statusBarTranslucent
    >
      <View style={[styles.scrim, { backgroundColor: t.color.scrim }]}>
        <View
          accessibilityViewIsModal
          style={[styles.dialog, { backgroundColor: t.color.plate2, borderColor: t.color.rule }]}
        >
          <Txt kind="title2" accessibilityRole="header">
            {p.title}
          </Txt>
          <Txt kind="body" color="ink2">
            {p.body}
          </Txt>
          <View style={styles.dialogActions}>
            <Button variant="text" label={p.cancelLabel} onPress={p.onCancel} testID="confirm.cancel" />
            <Button label={p.confirmLabel} onPress={p.onConfirm} testID="confirm.ok" />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  edge: { position: "absolute", transformOrigin: "left top" },
  face: { borderRadius: radius.none, borderWidth: 1, overflow: "hidden", justifyContent: "center" },
  fillOrigin: { transformOrigin: "left center" },
  highlight: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s12,
    paddingHorizontal: space.s16,
  },
  stepped: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    marginTop: space.s8,
    paddingVertical: space.s4,
  },
  step: { flex: 1, height: 8 },
  scrim: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.s24 },
  dialog: {
    width: "100%",
    maxWidth: 420,
    gap: space.s16,
    padding: space.s24,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: space.s8 },
});
