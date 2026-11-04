/**
 * Small pieces the member screens share (MEMBER slice only; nothing here is shell API):
 * - `LangBar`: Cebuano, Filipino, English one tap away on every member surface (design §8), and the English gloss
 *   switch (the "machine-translated, pending native review" chip is the chrome's, on every screen: `SurfaceLabels`);
 * - `GlossedSentence`: a statement sentence with its English gloss underneath when the gloss is on (IC-12 `gloss`);
 * - `HistoryMark`: the mark beside a history row (initials in ink for people, jade only for PayPal's confirmation).
 */
import { Pressable, StyleSheet, View } from "react-native";
import type { Lang } from "../../_shims/contracts";
import { fontFamily } from "../../_shims/fonts";
import { radius, space, target } from "../../_shims/tokens.native";
import type { GlossPair } from "../../lib/statement";
import { useApp } from "../../state/app";
import { type TypeRole, useFs } from "../../theme/theme";
import { LanguagePicker } from "../../ui/language-picker";
import { Hatch, InkStamp } from "../../ui/primitives";
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
        <Txt
          kind="body"
          color="ink2"
          lang="en"
          style={styles.glossText}
          testID={testID ? `${testID}.gloss` : undefined}
        >
          {pair.gloss.display}
        </Txt>
      ) : null}
    </View>
  );
}

/** The mark that leads a history row; every row also has its words, so no state is told by colour alone. */
export function HistoryMark({ mark, by }: { mark: Mark; by: readonly string[] }) {
  const { t } = useFs();
  if (mark === "stamps" && by.length) {
    return (
      <View style={styles.stamps}>
        {by.map((i) => (
          <InkStamp key={i} initials={i} />
        ))}
      </View>
    );
  }
  const fill =
    mark === "jade"
      ? t.color.jade
      : mark === "canary"
        ? t.color.canary
        : mark === "hatch"
          ? t.color.plate
          : t.color.pencil;
  return (
    <View style={styles.stamps}>
      <View
        style={[
          styles.square,
          { backgroundColor: fill, borderColor: mark === "jade" ? t.color.jadeFlushBorder : t.color.rule },
        ]}
      >
        {mark === "hatch" ? <Hatch /> : null}
      </View>
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
  glossText: { fontFamily: fontFamily.statement },
  stamps: { flexDirection: "row", gap: space.s4, width: 40, alignItems: "center" },
  square: { width: 12, height: 12, borderWidth: 1, overflow: "hidden", marginLeft: 3 },
});
