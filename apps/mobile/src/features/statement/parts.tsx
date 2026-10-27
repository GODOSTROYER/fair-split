/**
 * Small pieces the member screens share (MEMBER slice only; nothing here is shell API):
 * - `LangBar`: Cebuano, Filipino, English one tap away on every member surface (design §8), the "machine-translated,
 *   pending native review" chip on ceb and fil (S1.13), and the English gloss switch;
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
import { Glyph } from "../../ui/glyph";
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

/** Machine output is pencil (design §1): the translation chip is drawn in pencil, with the translate glyph. */
export function MachineChip({ testID }: { testID?: string }) {
  const { t } = useFs();
  const tr = useT();
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="text"
      accessibilityLabel={tr("common.machineTranslated")}
      style={[styles.machine, { borderColor: t.color.rule, backgroundColor: t.color.plate2 }]}
    >
      <Glyph name="translate" size={16} color={t.color.pencil} />
      <Txt kind="caption" style={{ color: t.color.pencil, flexShrink: 1 }}>
        {tr("common.machineTranslated")}
      </Txt>
    </View>
  );
}

/** The member's language row, with the review chip and the English gloss switch when the language is not English. */
export function LangBar({ testID }: { testID: string }) {
  const { lang } = useApp();
  const { t } = useFs();
  const tr = useT();
  // Never reads a statement of its own: outside the member area (the board's Pangutana) it only keeps the choice.
  const { gloss, glossForced, setGloss } = useStatement({ enabled: false });
  return (
    <View style={styles.bar}>
      <LanguagePicker testID={`${testID}.lang`} />
      {lang !== "en" ? (
        <View style={styles.row}>
          <MachineChip testID={`${testID}.machine`} />
          {glossForced ? null : (
            <Pressable
              testID={`${testID}.gloss`}
              accessibilityRole="switch"
              accessibilityLabel={tr("M-MB-01.glossHint")}
              accessibilityState={{ checked: gloss }}
              dataSet={{ state: gloss ? "on" : "off" }}
              onPress={() => setGloss(!gloss)}
              hitSlop={6}
              style={({ pressed }) => [styles.glossTap, pressed && { opacity: 0.8 }]}
            >
              <View
                style={[
                  styles.gloss,
                  {
                    borderColor: gloss ? t.color.ink : t.color.rule,
                    backgroundColor: gloss ? t.color.ink : t.color.plate,
                  },
                ]}
              >
                <Txt kind="label" style={{ color: gloss ? t.color.plate : t.color.ink }}>
                  {tr("M-MB-01.glossOn")}
                </Txt>
              </View>
            </Pressable>
          )}
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
  bar: { gap: space.s8 },
  row: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: space.s8 },
  machine: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    minHeight: 32,
    paddingHorizontal: space.s8,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.plate,
    flexShrink: 1,
  },
  glossTap: { minHeight: target.min, justifyContent: "center" },
  gloss: {
    minHeight: 32,
    justifyContent: "center",
    paddingHorizontal: space.s12,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  glossed: { gap: space.s4 },
  glossText: { fontFamily: fontFamily.statement },
  stamps: { flexDirection: "row", gap: space.s4, width: 40, alignItems: "center" },
  square: { width: 12, height: 12, borderWidth: 1, overflow: "hidden", marginLeft: 3 },
});
