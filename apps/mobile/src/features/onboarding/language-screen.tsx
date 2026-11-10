/**
 * M-ON-01 first run, language (design A0): the first screen anyone sees, so it carries the product's own materials.
 * The lockup with the season and lot stencilled as on the co-op's jute sacks; the question in all three languages
 * at once (nobody has chosen one yet); and the three languages as three sheets of paper on the tablea desk, each
 * written and heard in its own language (the phone's own voice, labelled, I8), the chosen one stamped in ink. The
 * honest "not yet" for Hiligaynon, Waray and Bikol is written on the desk itself.
 */
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { LANGS } from "../../_shims/contracts";
import { season } from "../../_shims/seed";
import { space } from "../../_shims/tokens.native";
import { seasonLabel } from "../../lib/display";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { t as inLang } from "./messages";
import { ChoicePlate, COLUMN, Desk, DeskNote, IdMark, StepFooter, useSample } from "./parts";
import { useT } from "./use-t";

export function LanguageScreen() {
  const { lang, setLang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const sample = useSample();

  return (
    <Screen
      testID="M-ON-01"
      state="language"
      contentStyle={COLUMN}
      footer={
        <StepFooter>
          <Button
            tall
            label={tr("M-ON-01.continue")}
            testID="M-ON-01.continue"
            onPress={() => router.replace(HREF.theme)}
          />
        </StepFooter>
      }
    >
      <View style={styles.lockup} testID="M-ON-01.lockup">
        <Txt kind="title2">{tr("app.name")}</Txt>
        <View style={styles.marks}>
          <IdMark
            text={seasonLabel(season.code)}
            label={tr("M-ON-01.size.season", { season: seasonLabel(season.code) })}
            color={t.color.ink2}
            testID="M-ON-01.mark.season"
          />
          <IdMark
            text={season.lot}
            label={tr("M-ON-01.mark.lot", { lot: season.lot })}
            color={t.color.ink2}
            testID="M-ON-01.mark.lot"
          />
        </View>
      </View>

      <View style={styles.lead}>
        <Txt kind="title1" accessibilityRole="header" lang={lang}>
          {inLang(lang, "M-ON-01.lang.prompt")}
        </Txt>
        {LANGS.filter((l) => l !== lang).map((l) => (
          <Txt key={l} kind="title2" color="ink3" lang={l}>
            {inLang(l, "M-ON-01.lang.prompt")}
          </Txt>
        ))}
      </View>

      <Desk testID="M-ON-01.desk">
        <View style={styles.plates} accessibilityRole="radiogroup">
          {LANGS.map((l) => (
            <ChoicePlate
              key={l}
              paper
              lang={l}
              selected={l === lang}
              onSelect={() => setLang(l)}
              title={inLang(l, "M-ON-01.lang.name")}
              body={inLang(l, "M-ON-01.lang.sample")}
              testID={`M-ON-01.lang.${l}`}
              play={{
                playing: sample.playing === l,
                onPress: () => void sample.play(l, inLang(l, "M-ON-01.lang.sample"), l),
                label: inLang(l, "M-ON-01.lang.play"),
                stopLabel: inLang(l, "M-ON-01.lang.stop"),
                testID: `M-ON-01.play.${l}`,
              }}
            />
          ))}
        </View>
        <DeskNote testID="M-ON-01.lang.not-yet">{tr("M-ON-01.lang.notYet")}</DeskNote>
      </Desk>

      <View style={styles.notes}>
        <View style={styles.voice}>
          <Glyph name="listen" size={16} color={t.color.ink2} />
          <Txt kind="caption" color="ink2">
            {tr("common.deviceVoice")}
          </Txt>
        </View>
        <Txt kind="caption" color="ink2">
          {tr("M-ON-01.lang.change")}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lockup: { gap: space.s8 },
  marks: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    columnGap: space.s16,
    rowGap: space.s4,
  },
  lead: { gap: space.s4 },
  plates: { gap: space.s16 },
  notes: { gap: space.s4 },
  voice: { flexDirection: "row", alignItems: "center", gap: space.s4 },
});
