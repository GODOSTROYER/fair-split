/**
 * AmountDisplay: the amount grammar (S2.2.1, IC-09), exposed as `data-amount-state` on every amount (S2.0 rule 3).
 *
 * | state    | large (≥28 px, member surface)                 | inline (<28 px)                                   |
 * | -------- | ---------------------------------------------- | ------------------------------------------------- |
 * | pencil   | solid pencil (read or computed, nobody signed) | pencil                                            |
 * | you      | –                                              | pencil-faint in a 1.5 px canary cell, "You" tag  |
 * | ink      | solid ink (a person entered or approved it)    | ink                                               |
 * | hollow   | hollow-fill with a 2 px ink stroke (in flight) | ink-2 with a 1.5 px dashed underline              |
 * | landed   | solid ink; its capsule is jade flush           | ink                                               |
 * | attested | solid ink, beside the clerk's stamp            | ink                                               |
 *
 * Large amounts are one react-native-svg text with fill and stroke together, so the outline cannot drift from the
 * fill at font scale 1.3 or 2.0; the hero caps at 1.5× (S2.2.1). The figure is always one line: when its column is
 * narrower than the figure (a 360 dp phone at 2.0×, 200% zoom on the web), the whole figure scales down to fit
 * (`ui/amount-fit.ts`). MM-1 passes `fill` (0 hollow → 1 landed) and the solid layer fades in over the hollow one.
 * The wrapper carries the full spoken label and hides the glyphs. FS Sans has its own ₱ (the grafted Noto peso).
 * Money text always arrives formatted by `format.*` (I1): this component never formats a number.
 */
import { useState } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Line, Text as SvgText } from "react-native-svg";
import type { AmountState } from "../_shims/contracts";
import { fontFamily } from "../_shims/fonts";
import { radius, space } from "../_shims/tokens.native";
import { typeScale, useFs } from "../theme/theme";
import {
  AMOUNT_PAD,
  AMOUNT_SCALE_CAP,
  amountType,
  CAP_HALF,
  fitAmount,
  fullWidth,
  roomFrom,
} from "./amount-fit";
import { Txt, useT } from "./text";

/** `hero` 48 sp and `l` 32 are large (one SVG figure); `m` 22 (a receipt's total) and `figure` 16 are inline. */
export type AmountSize = "hero" | "l" | "m" | "figure";

export interface AmountDisplayProps {
  /** Already formatted: "US$64.45", "₱7,990.00". */
  text: string;
  /**
   * The full spoken amount: `format.amountSpoken(cents, rate)` or `format.cashSpoken(…)`. Omit it only inside a
   * control whose own label already says the amount (a receipt row): the figure is then hidden from screen readers.
   */
  srLabel?: string;
  state: AmountState;
  size?: AmountSize;
  /** MM-1: 0 shows the hollow amount, 1 the landed one; animate it on the verified event only. */
  fill?: SharedValue<number>;
  testID?: string;
}

export function AmountDisplay({ text, srLabel, state, size = "hero", fill, testID }: AmountDisplayProps) {
  if (size === "figure" || size === "m") {
    return <InlineAmount text={text} srLabel={srLabel} state={state} size={size} testID={testID} />;
  }
  return <LargeAmount text={text} srLabel={srLabel} state={state} size={size} fill={fill} testID={testID} />;
}

/** Accessibility props of an amount's wrapper: one spoken element, or nothing when its control speaks for it. */
function spoken(srLabel: string | undefined) {
  return srLabel
    ? ({ accessible: true, role: "img", accessibilityRole: "text", accessibilityLabel: srLabel } as const)
    : ({
        accessible: false,
        importantForAccessibility: "no-hide-descendants",
        accessibilityElementsHidden: true,
        "aria-hidden": true,
      } as const);
}

function LargeAmount({
  text,
  srLabel,
  state,
  size,
  fill,
  testID,
}: Omit<AmountDisplayProps, "size"> & { size: "hero" | "l" }) {
  const { t } = useFs();
  const { fontScale } = useWindowDimensions();
  const role = size === "hero" ? "amountHero" : "amountL";
  const type = amountType(typeScale[role], fontScale, AMOUNT_SCALE_CAP[size]);
  /** The figure's width on one line at `type` (no pad). */
  const [natural, setNatural] = useState(0);
  /** The box's last layout and the full figure it held then. */
  const [last, setLast] = useState<{ width: number; full: number } | null>(null);
  const full = fullWidth(natural);
  const box = fitAmount(type, natural, roomFrom(last, full));

  const hollowLook = state === "hollow";
  const solidColour = state === "pencil" || state === "you" ? t.color.pencil : t.color.ink;
  // MM-1 cross-fades the two looks: the outline fades out exactly as the landed ink fades in.
  const solidOpacity = useAnimatedStyle(() => ({ opacity: fill ? fill.get() : hollowLook ? 0 : 1 }));
  const hollowOpacity = useAnimatedStyle(() => ({ opacity: fill ? 1 - fill.get() : hollowLook ? 1 : 0 }));
  // Digits sit centred on the line: half the line plus half the cap height.
  const common = {
    x: AMOUNT_PAD / 2,
    y: box.lineHeight / 2 + box.fontSize * CAP_HALF,
    fontSize: box.fontSize,
    fontFamily: fontFamily.amount,
    fontFeatureSettings: "'tnum' 1",
  } as const;
  const layer = { width: box.width, height: box.height };

  return (
    <View testID={testID} dataSet={{ amountState: state }} style={styles.large} {...spoken(srLabel)}>
      {/* The figure on one line at full size, measured where it takes no room and is never seen. */}
      <View
        style={styles.measure}
        pointerEvents="none"
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        <View style={styles.measureLine}>
          <Txt
            kind={role}
            allowFontScaling={false}
            numberOfLines={1}
            style={{ fontSize: type.fontSize, lineHeight: type.lineHeight }}
            onLayout={(e) => setNatural(e.nativeEvent.layout.width)}
          >
            {text}
          </Txt>
        </View>
      </View>
      {/* The box: as wide as the full figure unless the parent holds it narrower (`maxWidth`). It is keyed by the
          figure, so each layout reports which figure it held: a narrower box means a parent, never a stale figure. */}
      <View key={full} onLayout={(e) => setLast({ width: e.nativeEvent.layout.width, full })}>
        <View style={{ width: full, height: box.height }} />
      </View>
      {box.ready ? (
        <>
          {hollowLook || fill ? (
            <Animated.View
              pointerEvents="none"
              style={[styles.layer, layer, hollowOpacity]}
              importantForAccessibility="no-hide-descendants"
            >
              {/* Stroke under fill (paint-order: stroke): a 4 px stroke shows 2 px outside each glyph, and the
                  fill covers the strokes of overlapping contours, so "$", "4" and "8" draw no inner lines. */}
              <Svg width={box.width} height={box.height}>
                <SvgText {...common} fill="none" stroke={t.color.ink} strokeWidth={4} strokeLinejoin="round">
                  {text}
                </SvgText>
                <SvgText {...common} fill={t.color.hollowFill}>
                  {text}
                </SvgText>
              </Svg>
            </Animated.View>
          ) : null}
          <Animated.View
            pointerEvents="none"
            style={[styles.layer, layer, solidOpacity]}
            importantForAccessibility="no-hide-descendants"
          >
            <Svg width={box.width} height={box.height}>
              <SvgText {...common} fill={solidColour}>
                {text}
              </SvgText>
            </Svg>
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

function InlineAmount({
  text,
  srLabel,
  state,
  size,
  testID,
}: Omit<AmountDisplayProps, "size" | "fill"> & { size: "m" | "figure" }) {
  const { t } = useFs();
  const tr = useT();
  const colour =
    state === "pencil"
      ? t.color.pencil
      : state === "you"
        ? t.color.pencilFaint
        : state === "hollow"
          ? t.color.ink2
          : t.color.ink;
  return (
    <View
      testID={testID}
      dataSet={{ amountState: state }}
      style={state === "you" ? [styles.you, { borderColor: t.color.canaryBorder }] : styles.inline}
      {...spoken(srLabel)}
    >
      <View>
        <Txt kind={size === "m" ? "amountM" : "figure"} style={{ color: colour }}>
          {text}
        </Txt>
        {state === "hollow" ? <DashRule color={t.color.ink2} /> : null}
      </View>
      {state === "you" ? (
        <Txt kind="caption" color="canaryText">
          {tr("amount.you")}
        </Txt>
      ) : null}
    </View>
  );
}

/** Inline hollow's 1.5 px dashed underline (S2.2.1), drawn: Android cannot dash a text underline. */
function DashRule({ color }: { color: string }) {
  return (
    <View style={styles.dash} pointerEvents="none">
      <Svg width="100%" height={2}>
        <Line x1="0" y1="1" x2="100%" y2="1" stroke={color} strokeWidth={1.5} strokeDasharray="4 3" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  large: { maxWidth: "100%", overflow: "hidden" },
  measure: { position: "absolute", left: 0, top: 0, width: 0, height: 0, overflow: "hidden" },
  measureLine: { width: 1024, alignItems: "flex-start" },
  layer: { position: "absolute", left: 0, top: 0 },
  inline: { flexDirection: "row", alignItems: "center" },
  dash: { position: "absolute", left: 0, right: 0, bottom: 1, height: 2 },
  you: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    paddingHorizontal: space.s4,
    borderWidth: 1.5,
    borderRadius: radius.plate,
  },
});
