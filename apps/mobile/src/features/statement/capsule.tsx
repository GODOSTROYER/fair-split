/**
 * The status capsule on M-MB-01 and MM-1 "Bayad na" (design §7 M1, S2.9 timelines). PayPal, not the app, says she
 * is paid: the capsule takes PayPal's press only on a verified `item.updated` SUCCESS. Phases: pending → press (0)
 * → flood (90) → fill (120) → label (400) → invite (900) → done (1300). Reduced motion: a 150 ms colour and label
 * crossfade. Low tier: jade fades in over 120 ms and the amount fills instantly.
 */
import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import type { Lang } from "../../_shims/contracts";
import { MEMBER_STATUS_WORDS } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { radius, space, tweens } from "../../_shims/tokens.native";
import { CAPSULE_WORD, type CapsuleState, PENDING_RING_MAX_MS } from "../../lib/item-status";
import { feedback } from "../../platform/feedback";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Hatch } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import type { PaidSignal } from "./use-statement";

export type Mm1Phase = "pending" | "press" | "flood" | "fill" | "label" | "invite" | "done";

export interface Mm1 {
  phase: Mm1Phase;
  inset: SharedValue<number>;
  flood: SharedValue<number>;
  fill: SharedValue<number>;
  swap: SharedValue<number>;
  invite: SharedValue<number>;
}

const PRESS = Easing.bezier(0.23, 1, 0.32, 1);
const EASE_OUT = Easing.out(Easing.cubic);

export function useMoment1(capsule: CapsuleState | null, paid: PaidSignal | null): Mm1 {
  const { motion } = useFs();
  const isPaid = capsule === "paid";
  const inset = useSharedValue(isPaid ? 0 : 5);
  const flood = useSharedValue(isPaid ? 1 : 0);
  const fill = useSharedValue(isPaid ? 1 : 0);
  const swap = useSharedValue(isPaid ? 1 : 0);
  const invite = useSharedValue(0);
  const [phase, setPhase] = useState<Mm1Phase>(isPaid ? "done" : "pending");
  const played = useRef<string | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  useEffect(() => {
    const at = (ms: number, fn: () => void) => timers.current.push(setTimeout(fn, ms));
    if (!isPaid) {
      for (const x of timers.current) clearTimeout(x);
      timers.current = [];
      for (const v of [flood, fill, swap, invite]) cancelAnimation(v);
      inset.set(5);
      flood.set(0);
      fill.set(0);
      swap.set(0);
      invite.set(0);
      setPhase("pending");
      played.current = null;
      return;
    }
    // Paid without a fresh event in view (cold load, or a push older than 120 s): show the end state.
    const fresh = paid && paid.eventId !== played.current && Date.now() - paid.receivedAt < 120_000;
    if (!fresh || !paid) {
      inset.set(0);
      flood.set(1);
      fill.set(1);
      swap.set(1);
      setPhase("done");
      return;
    }
    played.current = paid.eventId;
    if (motion.reduced) {
      const fade = { duration: tweens.reduced.duration, easing: Easing.linear };
      inset.set(0);
      flood.set(withTiming(1, fade));
      fill.set(withTiming(1, fade));
      swap.set(withTiming(1, fade));
      setPhase("press");
      at(0, () => feedback.play("item.paid.member"));
      at(150, () => setPhase("done"));
      return;
    }
    setPhase("press");
    inset.set(withTiming(0, { duration: tweens.press.duration, easing: PRESS }));
    if (motion.low) {
      flood.set(withDelay(90, withTiming(1, { duration: 120, easing: Easing.linear })));
      at(120, () => fill.set(1));
    } else {
      flood.set(withDelay(90, withTiming(1, { duration: 140, easing: EASE_OUT })));
      fill.set(withDelay(120, withTiming(1, { duration: 120, easing: Easing.linear })));
    }
    swap.set(withDelay(400, withTiming(1, { duration: 200, easing: Easing.linear })));
    invite.set(
      withDelay(900, withSequence(withTiming(1, { duration: 120 }), withTiming(0, { duration: 280 }))),
    );
    at(90, () => setPhase("flood"));
    at(120, () => setPhase("fill"));
    at(180, () => feedback.play("item.paid.member"));
    at(400, () => setPhase("label"));
    at(900, () => setPhase("invite"));
    at(1300, () => setPhase("done"));
  }, [isPaid, paid, motion.reduced, motion.low, inset, flood, fill, swap, invite]);

  return { phase, inset, flood, fill, swap, invite };
}

function PendingRing({ color, since }: { color: string; since: number }) {
  const { motion } = useFs();
  const spin = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced) return;
    const remaining = PENDING_RING_MAX_MS - (Date.now() - since);
    if (remaining <= 0) return;
    spin.set(withRepeat(withTiming(1, { duration: 1200, easing: Easing.linear }), -1, false));
    const stop = setTimeout(() => {
      cancelAnimation(spin);
      spin.set(0);
    }, remaining);
    return () => {
      clearTimeout(stop);
      cancelAnimation(spin);
    };
  }, [since, motion.reduced, spin]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${spin.get() * 360}deg` }] }));
  return (
    <Animated.View style={style}>
      <Svg width={18} height={18} viewBox="0 0 18 18">
        <Path d="M9 2a7 7 0 1 1-7 7" stroke={color} strokeWidth={2} fill="none" strokeLinecap="square" />
      </Svg>
    </Animated.View>
  );
}

function useElapsed(since: number | null): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (since === null) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [since]);
  return since === null ? null : format.elapsed(now - since);
}

export function StatusCapsule({
  state,
  lang,
  mm1,
  sentAt,
  paidAt,
  cashDay,
}: {
  state: CapsuleState;
  lang: Lang;
  mm1: Mm1;
  sentAt: string | null;
  paidAt: string | null;
  cashDay: string | null;
}) {
  const { t } = useFs();
  const word = MEMBER_STATUS_WORDS[CAPSULE_WORD[state]][lang];
  const sinceMs = sentAt ? Date.parse(sentAt) : null;
  const elapsed = useElapsed(state === "sent" ? sinceMs : null);

  const faceStyle = useAnimatedStyle(() => ({
    top: mm1.inset.get(),
    left: mm1.inset.get(),
    right: mm1.inset.get(),
    bottom: mm1.inset.get(),
  }));
  const floodStyle = useAnimatedStyle(() => ({ transform: [{ scale: mm1.flood.get() }] }));
  const beforeStyle = useAnimatedStyle(() => ({ opacity: 1 - mm1.swap.get() }));
  const afterStyle = useAnimatedStyle(() => ({ opacity: mm1.swap.get() }));

  if (state === "sent" || state === "paid") {
    const paidWord = MEMBER_STATUS_WORDS.PAID[lang];
    const paidLabel = paidAt ? `${paidWord}, ${format.dayMonth(paidAt, lang)}` : paidWord;
    const sentWord = MEMBER_STATUS_WORDS.PAYPAL_PENDING[lang];
    return (
      <View
        testID="M-MB-01.capsule"
        dataSet={{ state }}
        accessible
        accessibilityLiveRegion="polite"
        accessibilityLabel={state === "paid" ? paidLabel : `${sentWord} ${elapsed ?? ""}`}
        style={[styles.capsule, { borderColor: state === "paid" ? t.color.jadeFlushBorder : t.color.rule }]}
      >
        <Animated.View style={[styles.face, { backgroundColor: t.color.plate2 }, faceStyle]} />
        <Animated.View style={[styles.flood, { backgroundColor: t.color.jade }, floodStyle]} />
        <Animated.View style={[styles.row, beforeStyle]} importantForAccessibility="no-hide-descendants">
          {sinceMs ? <PendingRing color={t.color.ink} since={sinceMs} /> : null}
          <Txt kind="bodyStrong" style={{ flexShrink: 1 }}>
            {sentWord}
          </Txt>
          {elapsed ? (
            <Txt kind="figure" color="ink2">
              {elapsed}
            </Txt>
          ) : null}
        </Animated.View>
        <Animated.View
          style={[styles.row, styles.overlay, afterStyle]}
          importantForAccessibility="no-hide-descendants"
        >
          <Glyph name="check" size={20} color={t.color.onJade} />
          <Txt kind="bodyStrong" style={{ color: t.color.onJade }}>
            {paidLabel}
          </Txt>
        </Animated.View>
      </View>
    );
  }

  const decide =
    state === "checking" || state === "held-line" || state === "unclaimed" || state === "paypal-held";
  const failure = state === "needs-action" || state === "reversed";
  const cash = state === "cash-due";
  const received = state === "cash-received";
  const label = (cash || received) && cashDay && cash ? `${word}, ${format.dayMonth(cashDay, lang)}` : word;
  const bg = decide
    ? t.color.canaryWash
    : failure
      ? t.color.redWash
      : received
        ? t.color.plate2
        : t.color.plate;
  const border = decide ? t.color.canaryBorder : failure ? t.color.red : t.color.rule;
  const fg = failure ? t.color.red : t.color.ink;
  const icon = decide ? "clock" : failure ? "info" : cash ? "cash" : received ? "check" : "info";
  return (
    <View
      testID="M-MB-01.capsule"
      dataSet={{ state }}
      accessible
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
      style={[styles.capsule, { borderColor: border, backgroundColor: bg }]}
    >
      {cash ? <Hatch /> : null}
      <View style={styles.row} importantForAccessibility="no-hide-descendants">
        <Glyph name={icon} size={20} color={fg} />
        <Txt kind="bodyStrong" style={{ color: fg, flexShrink: 1 }}>
          {label}
        </Txt>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  capsule: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: radius.plate,
    justifyContent: "center",
    overflow: "hidden",
    alignSelf: "stretch",
  },
  face: { position: "absolute" },
  flood: { ...StyleSheet.absoluteFill, transformOrigin: "right bottom" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s8,
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
  },
  overlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
});
