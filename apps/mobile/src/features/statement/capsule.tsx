/**
 * The status capsule and MM-1 "Bayad na" (design §7 M1, S2.9 timeline). PayPal, not the app, says she is paid:
 *
 * - While the item is with PayPal the capsule is a raised plate, 5 px of edge showing, with a pending ring (it stops
 *   after 60 s) and the time since it was sent: "Gipadala na, naghulat sa PayPal 0:14".
 * - A verified `item.updated` SUCCESS is PayPal's press: the plate sinks flush (press, 0 ms), jade floods it from the
 *   bottom-right corner (90), the hollow amount fills to ink (120), the chime and two taps play (180), the label
 *   crossfades to "Bayad na, 30 Okt" (400), and one 1 px ink ring pulses on Paminawa (900 → done at 1300). Until the
 *   crossfade the plate keeps the words she was reading, with the ring and the clock stopped where PayPal pressed
 *   it, and it keeps its height after they leave, so nothing below it moves.
 * - Reduced motion reaches the same phases with colour and label crossfades over 150 ms and no travel; the low tier
 *   fades the jade in over 120 ms and fills the amount at once. Sound and haptics stay in both.
 * - A cold load that is already paid, or a confirmation older than 120 s, shows the end state without playing.
 *
 * Every other state is flush: canary when a person decides (never an error), hatched for cash, red only when PayPal
 * failed, each with a glyph and a word.
 */
import { useEffect, useRef, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  type SharedValue,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { scheduleOnRN } from "react-native-worklets";
import { radius, slabDepth, space } from "../../_shims/tokens.native";
import type { CapsuleState } from "../../lib/item-status";
import { STATUS_GLYPH } from "../../lib/item-status";
import { feedback } from "../../platform/feedback";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { MomentMarker, type MomentPhase, useMoment } from "../../ui/moment";
import { reducedFade, TIMELINE, tween } from "../../ui/motion";
import { Hatch } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { capsuleText, elapsedClock, type LineView, msOf } from "./line-view";
import type { PaidSignal } from "./statement-store";

/** The capsule's raised edge before PayPal presses it (design §7 M1: "its 5 px inset closes to 0"). */
const EDGE = slabDepth.d2;
/** The capsule's least height: one line of the status word with its padding, above the 48 dp target. */
const FACE_MIN = 52;
const T = TIMELINE["MM-1"];
/** Confirmations already played on this phone: a remount never replays one (motion is evidence, MM-6). */
const PLAYED = new Set<string>();

export interface Mm1 {
  phase: MomentPhase<"MM-1">;
  rootProps: { testID: string; dataSet: { moment: string; momentPhase: string } };
  /** 0 raised, 1 flush. */
  press: SharedValue<number>;
  flood: SharedValue<number>;
  /** The hero amount: 0 hollow, 1 landed (AmountDisplay's `fill`). */
  fill: SharedValue<number>;
  /** 0 "Gipadala na…", 1 "Bayad na, 30 Okt". */
  swap: SharedValue<number>;
  /**
   * `swap` has reached 1 on screen: "Bayad na" fully covers the old words. Read from the animation itself, not from
   * the moment's clock, so a slow frame never leaves the plate without words.
   */
  swapped: boolean;
  /** The one ring on Paminawa: 0 → 1 once. */
  invite: SharedValue<number>;
}

function fresh(paid: PaidSignal | null): paid is PaidSignal {
  if (!paid || PLAYED.has(paid.eventId)) return false;
  const now = Date.now();
  const age = now - Date.parse(paid.at);
  return now - paid.receivedAt < T.freshForMs && !(age > T.freshForMs);
}

/**
 * MM-1's phases and values. `focused`: the statement is the screen she is looking at; a confirmation that lands
 * while she is on another tab (or listening) plays when she comes back, if that is within 120 s.
 */
export function useBayadNa(capsule: CapsuleState, paid: PaidSignal | null, focused = true): Mm1 {
  const { motion } = useFs();
  const isPaid = capsule === "paid";
  // Opened already paid, it rests at the end. A confirmation still fresh enough to play starts from the plate as it
  // was before PayPal's press, so the moment has somewhere to travel from.
  const [settled] = useState(() => isPaid && !fresh(paid));
  const mm1 = useMoment("MM-1", settled ? "done" : "pending");
  const press = useSharedValue(settled ? 1 : 0);
  const flood = useSharedValue(settled ? 1 : 0);
  const fill = useSharedValue(settled ? 1 : 0);
  const swap = useSharedValue(settled ? 1 : 0);
  const invite = useSharedValue(0);
  const [swapped, setSwapped] = useState(settled);
  useAnimatedReaction(
    () => swap.get() >= 1,
    (full, was) => {
      if (full !== was) scheduleOnRN(setSwapped, full);
    },
  );
  const playing = useRef(false);
  const { set, start, rest, timers } = mm1;

  useEffect(() => {
    const all = [press, flood, fill, swap, invite];
    if (!isPaid) {
      playing.current = false;
      for (const v of all) {
        cancelAnimation(v);
        v.set(0);
      }
      rest("pending");
      return;
    }
    if (fresh(paid) && !focused && !playing.current) return;
    if (fresh(paid) && start(paid.eventId, "press")) {
      PLAYED.add(paid.eventId);
      playing.current = true;
      if (motion.reduced) {
        // No travel: the plate is flush at once; colour, amount and label crossfade over 150 ms.
        press.set(1);
        flood.set(withTiming(1, reducedFade()));
        fill.set(withTiming(1, reducedFade()));
        swap.set(withTiming(1, reducedFade()));
      } else {
        press.set(withTiming(1, tween("press")));
        if (motion.low) {
          flood.set(withDelay(T.flood, withTiming(1, tween("fill"))));
          timers.at(T.fill, () => fill.set(1));
        } else {
          flood.set(withDelay(T.flood, withTiming(1, tween("flood"))));
          fill.set(withDelay(T.fill, withTiming(1, tween("fill"))));
        }
        swap.set(withDelay(T.label, withTiming(1, tween("crossfade"))));
        invite.set(withDelay(T.invite, withTiming(1, tween("invite"))));
      }
      timers.at(T.flood, () => set("flood"));
      timers.at(T.fill, () => set("fill"));
      timers.at(T.chime, () => feedback.play("item.paid.member"));
      timers.at(T.label, () => set("label"));
      timers.at(T.invite, () => set("invite"));
      timers.at(T.done, () => {
        playing.current = false;
        set("done");
      });
      return;
    }
    if (playing.current) return;
    // Already paid when it opened (or confirmed too long ago): the end state, without playing anything.
    for (const v of [press, flood, fill, swap]) {
      cancelAnimation(v);
      v.set(1);
    }
    invite.set(0);
    rest("done");
  }, [
    isPaid,
    paid,
    focused,
    motion.reduced,
    motion.low,
    press,
    flood,
    fill,
    swap,
    invite,
    set,
    start,
    rest,
    timers,
  ]);

  return { phase: mm1.phase, rootProps: mm1.rootProps, press, flood, fill, swap, swapped, invite };
}

/**
 * Two opposed arcs, turning half a turn per cycle (so the loop is seamless), for at most 60 s. PayPal's press stops
 * them where they are (`spinning` false), like the clock beside them.
 */
function PendingRing({ color, since, spinning }: { color: string; since: number; spinning: boolean }) {
  const { motion } = useFs();
  const spin = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced || !spinning) return;
    const left = TIMELINE.pendingRing.maxAnimateMs - (Date.now() - since);
    if (left <= 0) return;
    spin.set(withRepeat(withTiming(1, tween("engrave")), -1, false));
    const stop = setTimeout(() => {
      cancelAnimation(spin);
      spin.set(0);
    }, left);
    return () => {
      clearTimeout(stop);
      cancelAnimation(spin);
    };
  }, [since, spinning, motion.reduced, spin]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get() * 180}deg` }] }));
  return (
    <Animated.View style={style}>
      <Svg width={18} height={18} viewBox="0 0 18 18">
        <Path
          d="M9 2a7 7 0 0 1 6.06 3.5 M9 16a7 7 0 0 1-6.06-3.5"
          stroke={color}
          strokeWidth={2}
          fill="none"
          strokeLinecap="square"
        />
      </Svg>
    </Animated.View>
  );
}

/**
 * The capsule's clock. It counts while the item waits for PayPal and stops where PayPal pressed it (it simply stops
 * ticking, so the figure she was reading never jumps); a plate first drawn after the press reads the time PayPal took.
 */
function useCapsuleClock(view: LineView): string | null {
  const since = msOf(view.sentAt);
  const ticking = view.capsule === "sent" && since !== null;
  const [now, setNow] = useState(() => (ticking ? Date.now() : msOf(view.paidAt)));
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  return elapsedClock(since, now);
}

export function StatusCapsule({ view, mm1, testID }: { view: LineView; mm1: Mm1; testID: string }) {
  const { t, motion } = useFs();
  const sentMs = msOf(view.sentAt);
  const inFlight = view.sentWord !== null;
  const clock = useCapsuleClock(view);
  const text = capsuleText(view, { phase: mm1.phase, swapped: mm1.swapped }, clock);
  const carrying = text.before !== null;
  const [box, setBox] = useState({ w: 0, h: 0 });
  // The height the plate had while it carried the words PayPal pressed: it keeps it once they leave.
  const [held, setHeld] = useState(0);
  const onFace = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ w: Math.ceil(width), h: Math.ceil(height) });
    if (carrying) setHeld(height);
  };
  const reduced = motion.reduced;

  // PayPal's press: the face travels (5, 5) and the edges collapse into it. Reduced motion: the face is set flush
  // without travel and the edges fade as the jade comes in.
  const travel = useAnimatedStyle(() => {
    const d = EDGE * mm1.press.get();
    return { transform: [{ translateX: d }, { translateY: d }] };
  });
  const right = useAnimatedStyle(() => {
    const p = mm1.press.get();
    return reduced
      ? { opacity: 1 - mm1.flood.get(), transform: [{ skewY: "45deg" }] }
      : {
          opacity: 1,
          transform: [
            { translateX: EDGE * p },
            { translateY: EDGE * p },
            { skewY: "45deg" },
            { scaleX: 1 - p },
          ],
        };
  });
  const bottom = useAnimatedStyle(() => {
    const p = mm1.press.get();
    return reduced
      ? { opacity: 1 - mm1.flood.get(), transform: [{ skewX: "45deg" }] }
      : {
          opacity: 1,
          transform: [
            { translateX: EDGE * p },
            { translateY: EDGE * p },
            { skewX: "45deg" },
            { scaleY: 1 - p },
          ],
        };
  });
  const scaleFlood = !reduced && !motion.low;
  const flood = useAnimatedStyle(() =>
    scaleFlood
      ? { opacity: 1, transform: [{ scale: mm1.flood.get() }] }
      : { opacity: mm1.flood.get(), transform: [{ scale: 1 }] },
  );
  const before = useAnimatedStyle(() => ({ opacity: 1 - mm1.swap.get() }));
  const after = useAnimatedStyle(() => ({ opacity: mm1.swap.get() }));

  if (inFlight) {
    return (
      <View
        testID={testID}
        dataSet={{ state: view.capsule, tone: view.tone }}
        accessible
        accessibilityRole="text"
        accessibilityLiveRegion="polite"
        // The status word only: a label that changed every second would be read out every second.
        accessibilityLabel={view.word}
        style={styles.slot}
      >
        <MomentMarker id="MM-1" phase={mm1.phase} />
        {box.w > 0 ? (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.edge,
                { left: box.w, top: 0, width: EDGE, height: box.h, backgroundColor: t.color.rule },
                right,
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.edge,
                { left: 0, top: box.h, width: box.w, height: EDGE, backgroundColor: t.color.hatch },
                bottom,
              ]}
            />
          </>
        ) : null}
        <Animated.View
          onLayout={onFace}
          style={[
            styles.face,
            {
              minHeight: carrying ? FACE_MIN : Math.max(FACE_MIN, held),
              backgroundColor: t.color.plate2,
              borderColor: t.color.rule,
            },
            travel,
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[
              styles.flood,
              { backgroundColor: t.color.jade, borderColor: t.color.jadeFlushBorder },
              flood,
            ]}
          />
          {/* Before the press, and through it until the label crossfades: the words she was reading. */}
          {text.before ? (
            <Animated.View
              testID={`${testID}.before`}
              style={[styles.row, before]}
              importantForAccessibility="no-hide-descendants"
            >
              {sentMs !== null ? (
                <PendingRing color={t.color.ink} since={sentMs} spinning={view.capsule === "sent"} />
              ) : null}
              <Txt kind="bodyStrong" style={styles.word}>
                {text.before.word}
              </Txt>
              {text.before.clock ? (
                <Txt kind="figure" color="ink2" style={styles.elapsed}>
                  {text.before.clock}
                </Txt>
              ) : null}
            </Animated.View>
          ) : null}
          {/* After: over the old words while they fade, then on its own. */}
          <Animated.View
            testID={`${testID}.after`}
            style={[styles.row, carrying ? styles.overlay : null, after]}
            importantForAccessibility="no-hide-descendants"
            pointerEvents="none"
          >
            {text.after ? (
              <>
                <Glyph name="check" size={20} color={t.color.onJade} />
                <Txt kind="bodyStrong" style={[styles.word, { color: t.color.onJade }]}>
                  {text.after}
                </Txt>
              </>
            ) : null}
          </Animated.View>
        </Animated.View>
      </View>
    );
  }

  const look =
    view.tone === "decide" || view.tone === "failure" || view.tone === "cash" ? view.tone : "neutral";
  const bg =
    look === "decide"
      ? t.color.canaryWash
      : look === "failure"
        ? t.color.redWash
        : look === "cash"
          ? t.color.plate
          : t.color.plate2;
  const border = look === "decide" ? t.color.canaryBorder : look === "failure" ? t.color.red : t.color.rule;
  const fg = look === "failure" ? t.color.red : t.color.ink;
  return (
    <View
      testID={testID}
      dataSet={{ state: view.capsule, tone: view.tone }}
      accessible
      accessibilityRole="text"
      accessibilityLiveRegion="polite"
      accessibilityLabel={view.word}
      style={[styles.flat, { borderColor: border, backgroundColor: bg }]}
    >
      {look === "cash" ? <Hatch /> : null}
      <View style={styles.row} importantForAccessibility="no-hide-descendants">
        {/* On the hatch, the glyph and the word sit on small plates so the lines never cross them (design §2.5). */}
        <View style={look === "cash" ? [styles.plate, { backgroundColor: bg }] : null}>
          <Glyph name={STATUS_GLYPH[view.status]} size={20} color={fg} />
        </View>
        <View style={look === "cash" ? [styles.plate, styles.word, { backgroundColor: bg }] : styles.word}>
          <Txt kind="bodyStrong" style={{ color: fg }}>
            {view.word}
          </Txt>
        </View>
      </View>
    </View>
  );
}

/** The 1 px ink ring that pulses once around Paminawa at MM-1's `invite` (400 ms, then gone). */
export function InviteRing({ mm1 }: { mm1: Mm1 }) {
  const { t } = useFs();
  const style = useAnimatedStyle(() => {
    const k = mm1.invite.get();
    const out = 2 + 6 * k;
    return {
      opacity: k <= 0 || k >= 1 ? 0 : Math.sin(Math.PI * k),
      top: -out,
      left: -out,
      right: -out + slabDepth.d1,
      bottom: -out + slabDepth.d1,
    };
  });
  return <Animated.View pointerEvents="none" style={[styles.invite, { borderColor: t.color.ink }, style]} />;
}

const styles = StyleSheet.create({
  slot: { paddingRight: EDGE, paddingBottom: EDGE, alignSelf: "stretch" },
  edge: { position: "absolute", transformOrigin: "left top" },
  face: {
    borderWidth: 1,
    borderRadius: radius.none,
    justifyContent: "center",
    overflow: "hidden",
  },
  flood: { ...StyleSheet.absoluteFill, transformOrigin: "right bottom", borderWidth: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
  },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  elapsed: { marginLeft: "auto" },
  flat: {
    minHeight: FACE_MIN,
    borderWidth: 1,
    borderRadius: radius.none,
    justifyContent: "center",
    overflow: "hidden",
    alignSelf: "stretch",
  },
  plate: { paddingHorizontal: space.s4, paddingVertical: space.s2 },
  word: { flexShrink: 1 },
  invite: { position: "absolute", borderWidth: 1 },
});
