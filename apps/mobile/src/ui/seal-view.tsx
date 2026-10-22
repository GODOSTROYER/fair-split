/**
 * The batch seal (design §5, S2.7): five hypotrochoid rings grown from the batch hash. Key 1 (the treasurer) owns
 * the inner three rings, key 2 (the Chair) the outer two. Unsigned bands are 1 px rule circles; a ring engraves
 * (600 ms linear, staggered 120 ms) when its key signs; low-tier phones and reduced motion fade the rings in.
 */
import { memo, useEffect, useMemo } from "react";
import { View } from "react-native";
import Animated, {
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, Path } from "react-native-svg";
import { type SealRing, seal, sealStroke } from "../_shims/seal";
import { springs, tweens } from "../_shims/tokens.native";
import { useFs } from "../theme/theme";

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
    const delay = (index % 3) * tweens.engrave.stagger;
    drawn.set(
      withDelay(
        delay,
        withTiming(1, {
          duration: animate === "engrave" ? tweens.engrave.duration : tweens.glideFallback.duration,
          easing: Easing.linear,
        }),
      ),
    );
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
  const rings = useMemo(() => seal(batchSha256, size), [batchSha256, size]);
  const stroke = sealStroke(size);
  const animate = !engrave ? "none" : motion.reduced || motion.low ? "fade" : "engrave";
  const landed = useSharedValue(1);
  useEffect(() => {
    if (keys === 2 && engrave && !motion.reduced) {
      landed.set(
        withDelay(
          tweens.engrave.duration + 2 * tweens.engrave.stagger,
          withSequence(withTiming(1.03, { duration: 0 }), withSpring(1, springs.land)),
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
      accessibilityLabel={`Seal, ${keys} of 2 keys`}
    >
      <Animated.View style={landStyle}>
        <Svg width={size} height={size}>
          {rings.map((r) =>
            r.owner > keys ? (
              <Circle
                key={`band-${r.bandRadius}`}
                cx={size / 2}
                cy={size / 2}
                r={r.bandRadius}
                fill="none"
                stroke={t.color.rule}
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
                color={t.color.ink}
                stroke={stroke}
              />
            ) : null,
          )}
        </Svg>
      </Animated.View>
    </View>
  );
});
