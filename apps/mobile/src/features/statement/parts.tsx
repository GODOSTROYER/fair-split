/**
 * Small pieces the member screens share (MEMBER slice only; nothing here is shell API):
 * - `LangBar`: Cebuano, Filipino, English one tap away on every member surface (design §8), and the English gloss
 *   switch (the "machine-translated, pending native review" chip is the chrome's, on every screen: `SurfaceLabels`);
 * - `GlossedSentence`: a statement sentence with its English gloss underneath when the gloss is on (IC-12 `gloss`);
 * - `HistoryMark`: the 8 px state dot beside a history row (ink for people's steps, jade only for PayPal's
 *   confirmation).
 */
import { Pressable, StyleSheet, View } from "react-native";
import type { Lang } from "../../_shims/contracts";
import { radius, space, target } from "../../_shims/tokens.native";
import type { GlossPair } from "../../lib/statement";
import { useApp } from "../../state/app";
import { type TypeRole, useFs } from "../../theme/theme";
import { LanguagePicker } from "../../ui/language-picker";
import { StatusDot } from "../../ui/primitives";
import { Sentence } from "../../ui/sentence";
import { Txt } from "../../ui/text";
import type { HistoryMark as Mark } from "./line-view";
import { useStatement } from "./statement-store";
import { useT } from "./use-t";

/**
 * The member's column: full width on a phone, and a readable measure (about 70 characters of statement prose) when
 * the link or a stage frame opens on something wider.
 */
export const COLUMN = { width: "100%", maxWidth: 640, alignSelf: "center" } as const;

/**
 * The member's language row, and the English gloss switch on the screens that show statement sentences
 * (`glossable`) when the language is not English. Round 2: one row that wraps, the switch a pill the height of the
 * language control beside it.
 */
export function LangBar({ testID, glossable = true }: { testID: string; glossable?: boolean }) {
  const { lang } = useApp();
  const { t } = useFs();
  const tr = useT();
  // Never reads a statement of its own: outside the member area (the board's Pangutana) it only keeps the choice.
  const { gloss, glossForced, setGloss } = useStatement({ enabled: false });
  return (
    <View style={styles.bar}>
      <LanguagePicker testID={`${testID}.lang`} />
      {lang !== "en" && glossable && !glossForced ? (
        <View style={styles.row}>
          <Pressable
            testID={`${testID}.gloss`}
            accessibilityRole="switch"
            accessibilityLabel={tr("M-MB-01.glossHint")}
            aria-checked={gloss}
            dataSet={{ state: gloss ? "on" : "off" }}
            onPress={() => setGloss(!gloss)}
            hitSlop={6}
            style={({ pressed }) => [styles.glossTap, pressed && { opacity: 0.8 }]}
          >
            <View
              style={[
                styles.gloss,
                {
                  borderColor: gloss ? t.color.ink : t.color.ruleStrong,
                  backgroundColor: gloss ? t.color.ink : t.color.plate,
                },
              ]}
            >
              <Txt kind="label" style={{ color: gloss ? t.color.plate : t.color.ink2 }}>
                {tr("M-MB-01.glossOn")}
              </Txt>
            </View>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

/** A statement sentence, with its English gloss beneath it when the gloss is on (never in English itself). */
export function GlossedSentence({
  pair,
  lang,
  gloss,
  kind = "statementBody",
  color,
  underline,
  testID,
}: {
  pair: GlossPair;
  lang: Lang;
  gloss: boolean;
  kind?: TypeRole;
  color?: "ink" | "ink2" | "ink3";
  underline?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.glossed} testID={testID}>
      <Sentence
        segments={pair.sentence.segments}
        kind={kind}
        lang={lang}
        color={color}
        underline={underline}
      />
      {gloss && pair.gloss ? (
        <Txt kind="body" color="ink2" lang="en" testID={testID ? `${testID}.gloss` : undefined}>
          {pair.gloss.display}
        </Txt>
      ) : null}
    </View>
  );
}

/**
 * The mark that leads a history row; every row also has its words, so no state is told by colour alone. UI gate
 * round 5 (one marker vocabulary, docs/DESIGN.md §4): the console's 8 px round state dot, 8 px from its words, with no
 * indent: a step people took (approved, sent, received) is the done dot in ink, PayPal's confirmation the jade dot, a
 * person's decision the amber dot, cash at the bodega its hatch swatch (the status pill's cash mark). Who approved is
 * in the row's words, so no initials stand in the margin.
 */
export function HistoryMark({ mark }: { mark: Mark; by?: readonly string[] }) {
  const { t } = useFs();
  if (mark === "hatch") {
    return (
      <View style={styles.markSlot} importantForAccessibility="no-hide-descendants" aria-hidden>
        <StatusDot tone="cash" />
      </View>
    );
  }
  const look =
    mark === "jade"
      ? { fill: t.color.jade, ring: t.color.jadeFlushBorder }
      : mark === "canary"
        ? { fill: t.color.canary, ring: t.color.canary }
        : { fill: t.color.ink, ring: t.color.ink };
  return (
    <View style={styles.markSlot} importantForAccessibility="no-hide-descendants" aria-hidden>
      <View dataSet={{ mark }} style={[styles.dot, { backgroundColor: look.fill, borderColor: look.ring }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s8 },
  glossTap: { minHeight: target.min, justifyContent: "center" },
  gloss: {
    minHeight: 36,
    justifyContent: "center",
    paddingHorizontal: space.s16,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
  glossed: { gap: space.s4 },
  // One 10 px slot (the cash swatch's width), so every row's words start at the same x, 8 px after its mark.
  markSlot: { width: 10, alignItems: "center", justifyContent: "center" },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1 },
});
