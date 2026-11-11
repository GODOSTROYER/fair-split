/**
 * The batch seal (design §5, S2.7): five hypotrochoid rings grown from the batch hash. Key 1 (the treasurer) owns
 * the inner three rings, key 2 (the Chair) the outer two. A ring engraves (600 ms linear, staggered 120 ms) when its
 * key signs; low-tier phones and reduced motion fade the rings in.
 *
 * UI gate round 3 (docs/DESIGN.md §4 "Seal"), the same state in the same colours as the console's `Seal`: an unsigned
 * ring is its band's 1 px circle in neutral 400 (`--fs-unsigned`, steel line, 3:1 on white), and each key fills its
 * half in indigo (a person's hand): key 1 the inner three rings, key 2 the outer two. Nothing else colours the seal.
 */
import { memo, useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { ENGRAVE_STAGGER_MS, TIMELINE } from "../_shims/motion";
import type { SealRing } from "../_shims/seal";
import { useFs } from "../theme/theme";
import { ms, spring, tween } from "./motion";
import { sealLayout } from "./seal-layout";
import { useT } from "./text";

const AnimatedPath = Animated.createAnimatedComponent(Path);

function Ring({
  ring,
  index,
  signed,
  animate,
  color,
  stroke,
}: {
  ring: SealRing;
  index: number;
  signed: boolean;
  animate: "engrave" | "fade" | "none";
  color: string;
  stroke: number;
}) {
  const drawn = useSharedValue(signed && animate === "none" ? 1 : 0);
  useEffect(() => {
    if (!signed) {
      drawn.set(0);
      return;
    }
    if (animate === "none") {
      drawn.set(1);
      return;
    }
    const delay = (index % 3) * ENGRAVE_STAGGER_MS;
    drawn.set(withDelay(delay, withTiming(1, animate === "engrave" ? tween("engrave") : tween("sealFade"))));
  }, [signed, animate, index, drawn]);
  const props = useAnimatedProps(() =>
    animate === "engrave"
      ? { strokeDashoffset: ring.length * (1 - drawn.get()), opacity: drawn.get() > 0 ? 1 : 0 }
      : { strokeDashoffset: 0, opacity: drawn.get() },
  );
  return (
    <AnimatedPath
      d={ring.d}
      fill="none"
      stroke={color}
      strokeWidth={stroke}
      strokeDasharray={animate === "engrave" ? [ring.length, ring.length] : undefined}
      animatedProps={props}
    />
  );
}

export const SealView = memo(function SealView({
  batchSha256,
  size,
  keys,
  engrave = true,
  testID,
}: {
  batchSha256: string;
  size: number;
  keys: 0 | 1 | 2;
  engrave?: boolean;
  testID?: string;
}) {
  const { t, motion } = useFs();
  const tr = useT();
  const geometry = useMemo(() => sealLayout(batchSha256, size), [batchSha256, size]);
  const { rings, stroke } = geometry;
  const animate = !engrave ? "none" : motion.reduced || motion.low ? "fade" : "engrave";
  const landed = useSharedValue(1);
  useEffect(() => {
    if (keys === 2 && engrave && !motion.reduced) {
      landed.set(
        withDelay(
          ms("engrave") + 2 * ENGRAVE_STAGGER_MS,
          withSequence(
            withTiming(TIMELINE["MM-5"].sealOvershoot, { duration: 0 }),
            withSpring(1, spring("land")),
          ),
        ),
      );
    }
  }, [keys, engrave, motion.reduced, landed]);
  const landStyle = useAnimatedStyle(() => ({ transform: [{ scale: landed.get() }] }));
  return (
    <View
      testID={testID}
      dataSet={{ keys }}
      accessible
      accessibilityRole="image"
      accessibilityLabel={tr("seal.label", { keys })}
    >
      <Animated.View style={landStyle}>
        <Svg width={geometry.size} height={geometry.size}>
          {/* An unsigned band is a 1 px neutral circle, as on the console; it gives way to its ring when signed. */}
          {rings.map((r) =>
            r.owner > keys ? (
              <Circle
                key={`band-${r.bandRadius}`}
                cx={geometry.size / 2}
                cy={geometry.size / 2}
                r={r.bandRadius}
                fill="none"
                stroke={t.color.steelLine}
                strokeWidth={1}
              />
            ) : null,
          )}
          {rings.map((r, i) =>
            r.owner <= keys ? (
              <Ring
                key={`ring-${r.bandRadius}`}
                ring={r}
                index={i}
                signed
                animate={animate}
                color={t.color.pod}
                stroke={stroke}
              />
            ) : null,
          )}
        </Svg>
      </Animated.View>
    </View>
  );
});
