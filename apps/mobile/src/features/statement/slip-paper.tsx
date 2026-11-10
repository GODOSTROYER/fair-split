/**
 * A slip as paper (design §2.5 "Paper": only evidence casts a shadow, and it always carries "Synthetic sample").
 *
 * When the statement carries the reviewed crop (IC-11 `cropUrl`, cut by WS-MEDIA from the reviewed fixture, never
 * from a model's box) the photo shows. Until then this draws a labelled sample of the slip-v1 template: the printed
 * form in grey with the serial in red, and the clerk's entries in blue ballpoint capitals, each field set at its own
 * slight angle as a hand would. Every value comes from the statement: the date, her member number and name, the net
 * kilos, and Grade 1 when all her kilos were.
 *
 * UI gate round 3: no printed "Synthetic sample" caption (7 px on a thumbnail, illegible). Every sample carries the
 * synthetic legend glyph, a hatched square, on a white chip at 90% in its bottom-left corner, as the console's papers
 * do; its words stay in the paper's accessible name.
 */
import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";
import type { StatementSlip } from "../../_shims/api-client";
import { fontFamily } from "../../_shims/fonts";
import { radius, space } from "../../_shims/tokens.native";
import { handwrittenDate, slipFigures } from "../../lib/figures";
import { MARK_KIND } from "../../lib/honesty";
import { useFs } from "../../theme/theme";
import { MarkShape, useMarkColor } from "../../ui/honesty";
import { Txt } from "../../ui/text";
import { useT } from "./use-t";

/** The paper's aspect (A6 slip, landscape crop of the white original). */
export const SLIP_ASPECT = 0.64;
/** Below this width a slip is a thumbnail: serial and kilos only. */
const THUMB_MAX_W = 140;

/** A small, fixed tilt per field, so the entries sit as a hand set them (deterministic from the serial). */
function tilt(serial: string, field: number): string {
  const seed = [...serial].reduce((s, c) => s + c.charCodeAt(0), 0);
  return `${(((seed + field * 7) % 5) - 2) * 0.55 - 0.6}deg`;
}

export interface SlipOwner {
  memberNo: string;
  name: string;
  allGrade1: boolean;
  coop: string;
}

export function SlipPaper({
  slip,
  owner,
  width,
  focusNet,
  testID,
}: {
  slip: StatementSlip;
  owner: SlipOwner;
  width: number;
  /** MM-7: the net kilos framed in 1 px ink, the figure she traced to. */
  focusNet?: boolean;
  testID?: string;
}) {
  const { t } = useFs();
  const tr = useT();
  const height = Math.round(width * SLIP_ASPECT);
  const thumb = width < THUMB_MAX_W;
  const f = slipFigures(slip, "en");
  const hand = {
    color: t.color.ballpoint,
    fontFamily: fontFamily.figure,
  };
  const printed = t.color.ink3;
  const label = `${tr("M-MB-02.slipLabel", { serial: slip.serial, date: f.date, kg: f.kg })}. ${tr("common.syntheticSample")}`;
  const mark = useMarkColor(MARK_KIND.syntheticSample);

  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      style={[
        styles.paper,
        { width, height, backgroundColor: t.color.copyWhite, boxShadow: t.shadowPaper } as object,
      ]}
    >
      {slip.cropUrl ? (
        <Image
          source={{ uri: slip.cropUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          transition={0}
          accessible={false}
        />
      ) : thumb ? (
        <View style={styles.thumb}>
          <Txt
            maxFontSizeMultiplier={1}
            // The printed serial at the id floor (12 px; round 3: no caption under 12 on the phone).
            style={{ color: t.color.red, fontFamily: fontFamily.figure, fontSize: 12, lineHeight: 14 }}
          >
            {tr("M-MB-02.formNo", { serial: slip.serial })}
          </Txt>
          <Txt
            maxFontSizeMultiplier={1}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={[
              hand,
              {
                fontSize: Math.round(width * 0.22),
                lineHeight: Math.round(width * 0.27),
                transform: [{ rotate: tilt(slip.serial, 3) }],
              },
            ]}
          >
            {f.written}
          </Txt>
        </View>
      ) : (
        <View style={[styles.form, { padding: Math.round(width * 0.045) }]}>
          <View style={styles.head}>
            <Txt
              maxFontSizeMultiplier={1}
              numberOfLines={1}
              style={{
                color: printed,
                fontFamily: fontFamily.strong,
                fontSize: width * 0.032,
                flexShrink: 1,
              }}
            >
              {owner.coop.toUpperCase()}
            </Txt>
            <Txt
              maxFontSizeMultiplier={1}
              style={{ color: t.color.red, fontFamily: fontFamily.figure, fontSize: width * 0.045 }}
            >
              {tr("M-MB-02.formNo", { serial: slip.serial })}
            </Txt>
          </View>
          <Txt
            maxFontSizeMultiplier={1}
            style={{
              color: printed,
              fontFamily: fontFamily.ui,
              fontSize: width * 0.03,
              marginBottom: width * 0.012,
            }}
          >
            {tr("M-MB-02.formTitle")}
          </Txt>
          {(
            [
              ["formDate", handwrittenDate(slip.deliveredOn), 0.052],
              ["formMember", owner.memberNo, 0.052],
              ["formName", owner.name.toUpperCase(), 0.046],
              ["formNet", f.written, 0.085],
              ["formGrade", owner.allGrade1 ? "G1" : "", 0.052],
            ] as const
          ).map(([key, value, size], i) => {
            const net = key === "formNet";
            return (
              <View
                key={key}
                style={[
                  styles.field,
                  { borderBottomColor: t.color.rule, minHeight: width * (net ? 0.11 : 0.075) },
                  net && focusNet ? { borderColor: t.color.ink, borderWidth: 1, marginHorizontal: -2 } : null,
                ]}
              >
                <Txt
                  maxFontSizeMultiplier={1}
                  style={{
                    color: printed,
                    fontFamily: fontFamily.ui,
                    fontSize: width * 0.03,
                    width: width * 0.25,
                  }}
                >
                  {tr(`M-MB-02.${key}`)}
                </Txt>
                <Txt
                  maxFontSizeMultiplier={1}
                  numberOfLines={1}
                  style={[
                    hand,
                    {
                      fontSize: width * size,
                      lineHeight: width * size * 1.2,
                      flexShrink: 1,
                      letterSpacing: width * 0.002,
                      transform: [{ rotate: tilt(slip.serial, i) }],
                    },
                  ]}
                >
                  {value}
                </Txt>
              </View>
            );
          })}
        </View>
      )}
      {/* Every sample says so, in its corner: the synthetic glyph on a white chip (its words are the label). */}
      <View style={thumb ? styles.markThumb : styles.mark} pointerEvents="none">
        <View style={[styles.chip, { backgroundColor: t.color.plate }]} />
        <MarkShape kind={MARK_KIND.syntheticSample} size={thumb ? 10 : 12} color={mark} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { borderRadius: radius.none, overflow: "hidden" },
  thumb: { flex: 1, paddingHorizontal: space.s4, paddingTop: space.s4, justifyContent: "space-between" },
  form: { flex: 1 },
  head: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.s8 },
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.s8,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
    paddingBottom: 1,
    paddingHorizontal: 2,
  },
  /** The synthetic glyph's chip: white at 90%, bottom left. */
  // Separate objects rather than overriding a side with undefined: react-native-web drops undefined values.
  mark: { position: "absolute", left: space.s8, bottom: space.s8, padding: 3 },
  chip: { ...StyleSheet.absoluteFill, borderRadius: radius.cell, opacity: 0.9 },
  // A thumbnail's kilos fill its lower half: its mark takes the empty top-right corner instead.
  markThumb: { position: "absolute", right: space.s4, top: space.s4, padding: 2 },
});
