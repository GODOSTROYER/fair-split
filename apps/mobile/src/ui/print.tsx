/**
 * Print (S2.7, design §2.5): what a machine says. Claude's readings and the engine's figures print flat in pencil,
 * with no container and no button, and carry a provenance footer ("Read by Claude (claude-opus-5-5)", "Computed by
 * engine v1, rate card 7f3a 91c2"). A person's entry prints in ink. The value reveals with a 180 ms linear wipe (a
 * plate-coloured cover slides off to the right); reduced motion fades it in instead.
 */
import { useEffect, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import type { AmountState } from "../_shims/contracts";
import { space } from "../_shims/tokens.native";
import { useFs } from "../theme/theme";
import { Glyph } from "./glyph";
import { reducedFade, tween } from "./motion";
import { Txt, type TxtProps } from "./text";

export interface PrintProps {
  value: string;
  provenance: "claude" | "engine" | "person";
  /** pencil (machine, unsigned), you (a person must enter it), ink (a person entered or approved it). */
  state: Extract<AmountState, "pencil" | "you" | "ink">;
  /** "Read by Claude (claude-opus-5-5)": already worded and formatted by the caller. */
  footer?: string;
  kind?: TxtProps["kind"];
  /** Print it in (MM-2's `print` phase); off for a value that is already on the page. */
  reveal?: boolean;
  testID?: string;
}

export function Print({
  value,
  provenance,
  state,
  footer,
  kind = "figure",
  reveal = false,
  testID,
}: PrintProps) {
  const { t, motion } = useFs();
  const [w, setW] = useState(0);
  const cover = useSharedValue(reveal ? 0 : 1);
  const opacity = useSharedValue(reveal && motion.reduced ? 0 : 1);
  useEffect(() => {
    if (!reveal) return;
    if (motion.reduced) opacity.set(withTiming(1, reducedFade()));
    else cover.set(withTiming(1, tween("print")));
  }, [reveal, motion.reduced, cover, opacity]);
  const coverStyle = useAnimatedStyle(() => ({ transform: [{ translateX: cover.get() * (w + 4) }] }));
  const fade = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  const colour = state === "ink" ? "ink" : state === "you" ? "pencilFaint" : "pencil";
  return (
    <Animated.View
      testID={testID}
      dataSet={{ amountState: state, provenance }}
      style={[styles.root, fade]}
      onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)}
    >
      <View style={styles.row}>
        {provenance === "claude" ? <Glyph name="pencil" size={16} color={t.color.pencil} /> : null}
        <Txt kind={kind} color={colour} selectable>
          {value}
        </Txt>
      </View>
      {footer ? (
        <Txt kind="caption" color="ink3">
          {footer}
        </Txt>
      ) : null}
      {reveal && !motion.reduced ? (
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, { backgroundColor: t.color.plate }, coverStyle]}
        />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: "hidden", gap: space.s2 },
  row: { flexDirection: "row", alignItems: "center", gap: space.s4 },
});
