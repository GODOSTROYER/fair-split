/**
 * One capture's ring (design K1 "a progress ring per slip"; the clerk's peak: "the upload rings close when signal
 * returns"). It is a measurement, not decoration, and it always sits beside the capture's words:
 *
 *   waiting   dashed graphite: safe on the phone, not yet sent
 *   sending   an ink arc filling clockwise from twelve with the real upload progress
 *   sent      the ring closes, then a check draws: the co-op has it
 *   read      a solid ink disc with the check reversed out: the co-op has read its rows
 *   retrying  dashed, with the retry arrow: it will try again on its own
 *   refused   a canary disc: a person must decide (never red; red is only ever PayPal's failure)
 *
 * The arc moves like a machine (linear `print` tween, no bounce). Reduced motion: no travel, the new state appears.
 * Hidden from screen readers: the words beside it carry the state.
 */
import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { ms, tween } from "../../ui/motion";
import type { RingTone } from "./capture-view";

const AnimatedPath = Animated.createAnimatedComponent(Path);

/** A circle as a path that starts at twelve o'clock and runs clockwise, so dash offsets fill from the top. */
function circlePath(cx: number, cy: number, r: number): string {
  return `M ${cx} ${cy - r} a ${r} ${r} 0 1 1 0 ${2 * r} a ${r} ${r} 0 1 1 0 ${-2 * r}`;
}

export const CaptureRing = memo(function CaptureRing({
  tone,
  progress,
  size = 36,
}: {
  tone: RingTone;
  progress: number;
  size?: number;
}) {
  const { t, motion } = useFs();
  const stroke = size >= 32 ? 3 : 2;
  const r = (size - stroke) / 2 - 0.5;
  const c = size / 2;
  const len = 2 * Math.PI * r;
  const closed = tone === "sent" || tone === "read";
  const target = closed ? 1 : tone === "sending" ? Math.max(0.06, Math.min(1, progress)) : 0;

  const arc = useSharedValue(target);
  const tick = useSharedValue(closed ? 1 : 0);
  useEffect(() => {
    if (motion.reduced) {
      arc.set(target);
      tick.set(closed ? 1 : 0);
      return;
    }
    arc.set(withTiming(target, tween("print")));
    tick.set(closed ? withDelay(ms("print"), withTiming(1, tween("print"))) : 0);
  }, [target, closed, motion.reduced, arc, tick]);

  const tickLen = size * 0.6;
  const arcProps = useAnimatedProps(() => ({ strokeDashoffset: len * (1 - arc.get()) }));
  const tickProps = useAnimatedProps(() => ({ strokeDashoffset: tickLen * (1 - tick.get()) }));
  const dash = [len / 18, len / 18] as const;
  const check = `M ${size * 0.3} ${size * 0.52} L ${size * 0.44} ${size * 0.66} L ${size * 0.7} ${size * 0.36}`;

  return (
    <View
      style={{ width: size, height: size }}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      dataSet={{ ring: tone }}
    >
      <Svg width={size} height={size}>
        {tone === "read" ? <Circle cx={c} cy={c} r={r + stroke / 2} fill={t.color.ink} /> : null}
        {tone === "refused" ? (
          <Circle
            cx={c}
            cy={c}
            r={r}
            fill={t.color.canary}
            stroke={t.color.canaryBorder}
            strokeWidth={stroke - 1}
          />
        ) : null}
        {tone === "waiting" || tone === "retrying" ? (
          <Path
            d={circlePath(c, c, r)}
            fill="none"
            stroke={tone === "waiting" ? t.color.ink3 : t.color.ink2}
            strokeWidth={stroke - 0.5}
            strokeDasharray={dash}
          />
        ) : null}
        {tone === "sending" ? (
          <Path d={circlePath(c, c, r)} fill="none" stroke={t.color.rule} strokeWidth={stroke} />
        ) : null}
        {tone === "sending" || tone === "sent" ? (
          <AnimatedPath
            d={circlePath(c, c, r)}
            fill="none"
            stroke={t.color.ink}
            strokeWidth={stroke}
            strokeDasharray={[len, len]}
            animatedProps={arcProps}
          />
        ) : null}
        {closed ? (
          <AnimatedPath
            d={check}
            fill="none"
            stroke={tone === "read" ? t.color.plate : t.color.ink}
            strokeWidth={size >= 32 ? 2.75 : 2.25}
            strokeLinecap="square"
            strokeLinejoin="miter"
            strokeDasharray={[tickLen, tickLen]}
            animatedProps={tickProps}
          />
        ) : null}
        {tone === "refused" && size >= 20 ? (
          <Path
            d={`M ${c} ${c - r * 0.45} V ${c + r * 0.12} M ${c} ${c + r * 0.36} v ${r * 0.1}`}
            stroke={t.color.onCanary}
            strokeWidth={size >= 32 ? 2.75 : 2}
            strokeLinecap="square"
          />
        ) : null}
      </Svg>
      {tone === "retrying" && size >= 28 ? (
        <View style={[StyleSheet.absoluteFill, styles.center]}>
          <Glyph name="refresh" size={Math.round(size * 0.5)} color={t.color.ink2} />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({ center: { alignItems: "center", justifyContent: "center" } });
