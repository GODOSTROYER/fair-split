/**
 * M-ON-01 first run, language (design A0): three large plates, Cebuano, Filipino and English, each written and heard
 * in its own language (the phone's own voice, labelled, I8), with the honest "not yet" for Hiligaynon, Waray and
 * Bikol. The question is asked in all three languages at once, because nobody has chosen one yet.
 */
import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { LANGS } from "../../_shims/contracts";
import { radius, space } from "../../_shims/tokens.native";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { t as inLang } from "./messages";
import { ChoicePlate, StepFooter, useSample } from "./parts";
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
      <View style={styles.lead}>
        <Txt kind="label" color="ink2">
          {tr("app.lockup")}
        </Txt>
        <Txt kind="title1" accessibilityRole="header" lang={lang}>
          {inLang(lang, "M-ON-01.lang.prompt")}
        </Txt>
        {LANGS.filter((l) => l !== lang).map((l) => (
          <Txt key={l} kind="title2" color="ink3" lang={l}>
            {inLang(l, "M-ON-01.lang.prompt")}
          </Txt>
        ))}
      </View>

      <View style={styles.plates} accessibilityRole="radiogroup">
        {LANGS.map((l) => (
          <ChoicePlate
            key={l}
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
        <View style={[styles.notYet, { borderColor: t.color.rule }]} testID="M-ON-01.lang.not-yet">
          <Txt kind="body" color="ink2">
            {tr("M-ON-01.lang.notYet")}
          </Txt>
        </View>
      </View>

      <View style={styles.notes}>
        <View style={styles.voice}>
          <Glyph name="listen" size={16} color={t.color.ink2} />
          <Txt kind="caption" color="ink2">
            {tr("common.deviceVoice")}
          </Txt>
        </View>
        <Txt kind="caption" color="ink3">
          {tr("M-ON-01.lang.change")}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { gap: space.s4 },
  plates: { gap: space.s12 },
  notYet: {
    paddingVertical: space.s12,
    paddingHorizontal: space.s16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.plate,
  },
  notes: { gap: space.s4 },
  voice: { flexDirection: "row", alignItems: "center", gap: space.s4 },
});
