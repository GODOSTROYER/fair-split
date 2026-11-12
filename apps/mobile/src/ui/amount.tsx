/**
 * AmountDisplay: the amount grammar (S2.2.1, IC-09), exposed as `data-amount-state` on every amount (S2.0 rule 3).
 *
 * | state    | large (≥28 px, member surface)                 | inline (<28 px)                                   |
 * | -------- | ---------------------------------------------- | ------------------------------------------------- |
 * | pencil   | solid ink (round 2: one hero numeral)          | pencil                                            |
 * | you      | –                                              | pencil-faint in a 1.5 px canary cell, "You" tag  |
 * | ink      | solid ink (a person entered or approved it)    | ink                                               |
 * | hollow   | solid ink (round 2: no outline; the capsule)   | statement ink 2 beside a hollow dot (round 3)     |
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
import Svg, { Text as SvgText, TSpan } from "react-native-svg";
import type { AmountState } from "../_shims/contracts";
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

/** `hero` 48 sp and `l` 24 are large (one SVG figure); `m` 24 (a receipt's total) and `figure` 15 are inline. */
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

/**
 * The hero amount's "US$" small and raised, as the console's `.fs-cur` (0.42 em, docs/DESIGN.md §1); the text and its
 * spoken label stay whole.
 */
const CUR = { size: 0.42, rise: 0.38 } as const;

/** "US$64.45" → ["US$", "64.45"]; text with no dollar prefix comes back whole. */
export function currencyParts(text: string): readonly [prefix: string, figure: string] {
  const m = /^(US\$)/.exec(text);
  return m ? [m[1] ?? "", text.slice(m[0].length)] : ["", text];
}

/** The figure as SVG spans: the prefix small and raised on the hero, the digits at full size. */
function FigureSpans({
  text,
  fontSize,
  raise,
  prefixFill,
}: {
  text: string;
  fontSize: number;
  raise: boolean;
  /** Round 2: the "US$" is quieter than the digits (statement ink 2, 9.8:1), as on the console. */
  prefixFill?: string;
}) {
  const [prefix, figure] = currencyParts(text);
  if (!raise || !prefix) return <>{text}</>;
  const rise = fontSize * CUR.rise;
  return (
    <>
      <TSpan fontSize={fontSize * CUR.size} dy={-rise} fill={prefixFill}>
        {prefix}
      </TSpan>
      <TSpan fontSize={fontSize} dy={rise} dx={fontSize * 0.04}>
        {figure}
      </TSpan>
    </>
  );
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
  // One hero numeral (UI gate round 2): every large amount is solid ink, whatever its state.
  const solidColour = t.color.ink;
  // MM-1 cross-fades the two looks: the outline fades out exactly as the landed ink fades in.
  const solidOpacity = useAnimatedStyle(() => ({ opacity: fill ? fill.get() : hollowLook ? 0 : 1 }));
  const hollowOpacity = useAnimatedStyle(() => ({ opacity: fill ? 1 - fill.get() : hollowLook ? 1 : 0 }));
  // Digits sit centred on the line: half the line plus half the cap height.
  const common = {
    x: AMOUNT_PAD / 2,
    y: box.lineHeight / 2 + box.fontSize * CAP_HALF,
    fontSize: box.fontSize,
    // The role's face (round 2: the figure cut, 87.5/500), so the drawn figure is the measured one.
    fontFamily: typeScale[role].fontFamily,
    // Round 3: one money style, tabular lining figures everywhere (docs/DESIGN.md §1).
    fontFeatureSettings: "'tnum' 1, 'lnum' 1",
  } as const;
  const raise = size === "hero";
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
              {/* UI gate round 2: no outline face. The in-flight layer is the same solid ink figure, so MM-1's
                  cross-fade changes nothing a member reads; the capsule beside it says where the money is. */}
              <Svg width={box.width} height={box.height}>
                <SvgText {...common} fill={t.color.ink}>
                  <FigureSpans
                    text={text}
                    fontSize={box.fontSize}
                    raise={raise}
                    prefixFill={t.color.statementInk2}
                  />
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
                <FigureSpans
                  text={text}
                  fontSize={box.fontSize}
                  raise={raise}
                  prefixFill={t.color.statementInk2}
                />
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
          ? t.color.statementInk2
          : t.color.ink;
  return (
    <View
      testID={testID}
      dataSet={{ amountState: state }}
      style={state === "you" ? [styles.you, { borderColor: t.color.canaryBorder }] : styles.inline}
      {...spoken(srLabel)}
    >
      {/* Round 3: a pending amount is a neutral figure beside a hollow dot; dashed lines mean simulated only. */}
      {state === "hollow" ? <View style={[styles.pendingDot, { borderColor: colour }]} /> : null}
      <Txt kind={size === "m" ? "amountM" : "figure"} style={{ color: colour }}>
        {text}
      </Txt>
      {state === "you" ? (
        <Txt kind="caption" color="canaryText">
          {tr("amount.you")}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  large: { maxWidth: "100%", overflow: "hidden" },
  measure: { position: "absolute", left: 0, top: 0, width: 0, height: 0, overflow: "hidden" },
  measureLine: { width: 1024, alignItems: "flex-start" },
  layer: { position: "absolute", left: 0, top: 0 },
  inline: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  pendingDot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  you: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    paddingHorizontal: space.s4,
    borderWidth: 1.5,
    borderRadius: radius.plate,
  },
});
