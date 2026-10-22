/**
 * AmountDisplay (design §2.5 "Hollow", S2.3 "Money"). An approved amount that is not yet in the member's hands is
 * drawn as an outline; it fills when PayPal confirms (MM-1) or the cash is received. Both layers are SVG text at the
 * same coordinates so the fill lands exactly on the outline; a transparent React Native Text underneath carries the
 * layout, font scaling (capped at 1.5× for the 48 sp hero) and the full spoken label.
 */
import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Text as SvgText } from "react-native-svg";
import { typeScale, useFs } from "../theme/theme";
import { Txt } from "./text";

export function AmountDisplay({
  text,
  srLabel,
  solid,
  fill,
  size = "hero",
  testID,
}: {
  text: string;
  srLabel: string;
  /** Static solid/hollow when no animation drives it. */
  solid: boolean;
  /** 0 = hollow, 1 = solid; drives the MM-1 fill when given. */
  fill?: SharedValue<number>;
  size?: "hero" | "large";
  testID?: string;
}) {
  const { t } = useFs();
  const { fontScale } = useWindowDimensions();
  const role = size === "hero" ? "amountHero" : "amountL";
  const base = typeScale[role];
  const scale = Math.min(fontScale || 1, size === "hero" ? 1.5 : 2);
  const fontSize = base.fontSize * scale;
  const lineHeight = base.lineHeight * scale;
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = (e: LayoutChangeEvent) =>
    setBox({ w: Math.ceil(e.nativeEvent.layout.width) + 4, h: Math.ceil(e.nativeEvent.layout.height) });

  const solidStyle = useAnimatedStyle(() => ({ opacity: fill ? fill.get() : solid ? 1 : 0 }));
  // Digits sit on the baseline: half the line plus ~0.36 em (Mona Sans cap height ≈ 0.72 em).
  const baseline = lineHeight / 2 + fontSize * 0.36;
  const common = {
    x: 1,
    y: baseline,
    fontSize,
    fontFamily: base.fontFamily,
    fontFeatureSettings: "'tnum' 1, 'ss08' 1",
  } as const;

  return (
    <View testID={testID} dataSet={{ state: solid ? "solid" : "hollow" }}>
      <Txt kind={role} onLayout={onLayout} accessibilityLabel={srLabel} style={{ color: "transparent" }}>
        {text}
      </Txt>
      {box.w > 0 ? (
        <>
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <Svg width={box.w} height={box.h}>
              <SvgText {...common} fill="none" stroke={t.color.ink} strokeWidth={1.25}>
                {text}
              </SvgText>
            </Svg>
          </View>
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, solidStyle]}>
            <Svg width={box.w} height={box.h}>
              <SvgText {...common} fill={t.color.ink}>
                {text}
              </SvgText>
            </Svg>
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}
