/**
 * M-ON-01 first run, language (design A0): three large plates, each with a play button that speaks its sample in
 * the phone's own voice (labelled), and the honest "not yet" row for Hiligaynon, Waray and Bikol.
 */
import { router } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LANGS, type Lang } from "../../_shims/contracts";
import { radius, space, target } from "../../_shims/tokens.native";
import { HREF } from "../../services/session";
import { pickVoiceLanguage, speakOnce } from "../../services/voice";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { t as translate } from "./messages";
import { useT } from "./use-t";

export function LanguageScreen() {
  const { lang, setLang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();

  const play = async (l: Lang) => speakOnce(translate(l, "M-ON-01.lang.sample"), await pickVoiceLanguage(l));

  return (
    <Screen
      testID="M-ON-01"
      state="language"
      footer={
        <View
          style={[
            styles.footer,
            { paddingBottom: insets.bottom + space.s16, backgroundColor: t.color.ground },
          ]}
        >
          <Button
            tall
            label={tr("M-ON-01.continue")}
            testID="M-ON-01.continue"
            onPress={() => router.replace(HREF.theme)}
          />
        </View>
      }
    >
      <View style={{ gap: space.s4 }}>
        <Txt kind="label" color="ink2">
          {tr("app.lockup")}
        </Txt>
        {LANGS.map((l) => (
          <Txt key={l} kind={l === lang ? "title1" : "title2"} color={l === lang ? "ink" : "ink2"} lang={l}>
            {translate(l, "M-ON-01.lang.prompt")}
          </Txt>
        ))}
      </View>

      <View style={{ gap: space.s12 }} accessibilityRole="radiogroup">
        {LANGS.map((l) => {
          const selected = l === lang;
          return (
            <View
              key={l}
              style={[
                styles.plate,
                {
                  backgroundColor: t.color.plate,
                  borderColor: selected ? t.color.ink : t.color.rule,
                  borderWidth: selected ? 2 : 1,
                },
              ]}
            >
              <Pressable
                testID={`M-ON-01.lang.${l}`}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={`${translate(l, "M-ON-01.lang.name")}. ${translate(l, "M-ON-01.lang.sample")}`}
                onPress={() => setLang(l)}
                style={styles.choice}
              >
                <View style={[styles.radio, { borderColor: selected ? t.color.ink : t.color.ink3 }]}>
                  {selected ? <View style={[styles.radioDot, { backgroundColor: t.color.ink }]} /> : null}
                </View>
                <View style={{ flex: 1, gap: space.s2 }}>
                  <Txt kind="title2">{translate(l, "M-ON-01.lang.name")}</Txt>
                  <Txt kind="statementBody" color="ink2" lang={l}>
                    {translate(l, "M-ON-01.lang.sample")}
                  </Txt>
                </View>
              </Pressable>
              <Pressable
                testID={`M-ON-01.play.${l}`}
                accessibilityRole="button"
                accessibilityLabel={translate(l, "M-ON-01.lang.play")}
                onPress={() => void play(l)}
                style={({ pressed }) => [
                  styles.play,
                  {
                    backgroundColor: pressed ? t.color.pencilWash : t.color.plate2,
                    borderColor: t.color.rule,
                  },
                ]}
              >
                <Glyph name="listen" color={t.color.ink} />
              </Pressable>
            </View>
          );
        })}
        <View style={[styles.notYet, { borderColor: t.color.rule }]}>
          <Txt kind="body" color="ink3">
            {tr("M-ON-01.lang.notYet")}
          </Txt>
        </View>
        <Txt kind="caption" color="ink3">
          {tr("M-ON-01.lang.deviceVoice")}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: "row",
    alignItems: "stretch",
    borderRadius: radius.plate,
    minHeight: 88,
  },
  choice: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.s16, padding: space.s16 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 10, height: 10, borderRadius: 5 },
  play: {
    width: 64,
    minHeight: target.min,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
  },
  notYet: { paddingVertical: space.s12, paddingHorizontal: space.s16, borderWidth: 1, borderStyle: "dashed" },
  footer: { paddingHorizontal: space.s16, paddingTop: space.s12 },
});
