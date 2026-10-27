/**
 * AmountDisplay: the amount grammar (S2.2.1, IC-09), exposed as `data-amount-state`.
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
 * fill at font scale 1.3 or 2.0; the hero caps at 1.5× (S2.2.1). MM-1 passes `fill` (0 hollow → 1 landed) and the
 * solid layer fades in over the hollow one. The wrapper carries the full spoken label and hides the glyphs. A ₱ is
 * drawn in the platform face (S2.3: the amount face has no ₱), as `Txt` sets it in text.
 * Money text always arrives formatted by `format.*` (I1): this component never formats a number.
 */
import { type ReactNode, useState } from "react";
import { type LayoutChangeEvent, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import Svg, { Text as SvgText, TSpan } from "react-native-svg";
import type { AmountState } from "../_shims/contracts";
import { FIGURE_VARIANT, systemFont } from "../_shims/fonts";
import { radius, space } from "../_shims/tokens.native";
import { typeScale, useFs } from "../theme/theme";
import { pesoRuns } from "./figures";
import { Txt, useT } from "./text";

export type AmountSize = "hero" | "l" | "figure";

export interface AmountDisplayProps {
  /** Already formatted: "US$64.45", "₱7,990.00". */
  text: string;
  /** The full spoken amount: `format.amountSpoken(cents, rate)` or `format.cashSpoken(…)`. */
  srLabel: string;
  state: AmountState;
  size?: AmountSize;
  /** MM-1: 0 shows the hollow amount, 1 the landed one; animate it on the verified event only. */
  fill?: SharedValue<number>;
  testID?: string;
}

export function AmountDisplay({ text, srLabel, state, size = "hero", fill, testID }: AmountDisplayProps) {
  if (size === "figure") return <InlineAmount text={text} srLabel={srLabel} state={state} testID={testID} />;
  return <LargeAmount text={text} srLabel={srLabel} state={state} size={size} fill={fill} testID={testID} />;
}

function LargeAmount({
  text,
  srLabel,
  state,
  size,
  fill,
  testID,
}: AmountDisplayProps & { size: "hero" | "l" }) {
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

  const hollowLook = state === "hollow";
  const solidColour = state === "pencil" || state === "you" ? t.color.pencil : t.color.ink;
  // MM-1 cross-fades the two looks: the outline fades out exactly as the landed ink fades in.
  const solidOpacity = useAnimatedStyle(() => ({ opacity: fill ? fill.get() : hollowLook ? 0 : 1 }));
  const hollowOpacity = useAnimatedStyle(() => ({ opacity: fill ? 1 - fill.get() : hollowLook ? 1 : 0 }));
  // Digits sit on the baseline: half the line plus ~0.36 em (Mona Sans cap height ≈ 0.72 em).
  const common = {
    x: 2,
    y: lineHeight / 2 + fontSize * 0.36,
    fontSize,
    fontFamily: base.fontFamily,
    fontFeatureSettings: "'tnum' 1, 'ss08' 1",
  } as const;
  const glyphs = svgGlyphs(text);

  return (
    <View
      testID={testID}
      dataSet={{ amountState: state }}
      accessible
      accessibilityRole="text"
      accessibilityLabel={srLabel}
    >
      {/* Layout only: the same text at the same size, invisible; it sizes the SVG and wraps nothing. */}
      <Txt
        kind={role}
        onLayout={onLayout}
        allowFontScaling={false}
        style={{ color: "transparent", fontSize, lineHeight }}
        importantForAccessibility="no-hide-descendants"
        aria-hidden
      >
        {text}
      </Txt>
      {box.w > 0 ? (
        <>
          {hollowLook || fill ? (
            <Animated.View
              pointerEvents="none"
              style={[StyleSheet.absoluteFill, hollowOpacity]}
              importantForAccessibility="no-hide-descendants"
            >
              {/* Stroke under fill (paint-order: stroke): a 4 px stroke shows 2 px outside each glyph, and the
                  fill covers the strokes of overlapping contours, so "$", "4" and "8" draw no inner lines. */}
              <Svg width={box.w} height={box.h}>
                <SvgText {...common} fill="none" stroke={t.color.ink} strokeWidth={4} strokeLinejoin="round">
                  {glyphs}
                </SvgText>
                <SvgText {...common} fill={t.color.hollowFill}>
                  {glyphs}
                </SvgText>
              </Svg>
            </Animated.View>
          ) : null}
          <Animated.View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, solidOpacity]}
            importantForAccessibility="no-hide-descendants"
          >
            <Svg width={box.w} height={box.h}>
              <SvgText {...common} fill={solidColour}>
                {glyphs}
              </SvgText>
            </Svg>
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

/** The characters of one SVG amount: each ₱ as a span in the platform face, everything else in the amount face. */
function svgGlyphs(text: string): ReactNode {
  if (!text.includes("₱")) return text;
  let at = 0;
  return pesoRuns(text).map((r) => {
    const key = `run-${at}`;
    at += r.text.length;
    return r.peso ? (
      <TSpan key={key} fontFamily={systemFont}>
        {r.text}
      </TSpan>
    ) : (
      r.text
    );
  });
}

function InlineAmount({ text, srLabel, state, testID }: Omit<AmountDisplayProps, "size" | "fill">) {
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
  const body = (
    <Txt
      kind="figure"
      style={[
        { color: colour, fontVariant: [...FIGURE_VARIANT] },
        state === "hollow" ? { textDecorationLine: "underline", textDecorationStyle: "dashed" } : null,
      ]}
    >
      {text}
    </Txt>
  );
  return (
    <View
      testID={testID}
      dataSet={{ amountState: state }}
      accessible
      accessibilityLabel={srLabel}
      style={state === "you" ? [styles.you, { borderColor: t.color.canaryBorder }] : styles.inline}
    >
      {body}
      {state === "you" ? (
        <Txt kind="caption" color="canaryText">
          {tr("amount.you")}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  inline: { flexDirection: "row", alignItems: "center" },
  you: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    paddingHorizontal: space.s4,
    borderWidth: 1.5,
    borderRadius: radius.plate,
  },
});
