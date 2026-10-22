/**
 * M-ON-01 first run, theme: "Unsa ang mas klaro nimo?" over the statement in Adlaw and in Tablea, as two plates to
 * tap (design A0). The whole app switches instantly; transitions stay off while the theme changes.
 */
import { router } from "expo-router";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { MEMBER_STATUS_WORDS } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { heroLine } from "../../_shims/seed";
import { type FsTokens, radius, space, type ThemeName, themes } from "../../_shims/tokens.native";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { typeScale, useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { useT } from "./use-t";

function MiniStatement({ tk, greeting, paid }: { tk: FsTokens; greeting: string; paid: string }) {
  return (
    <View style={[styles.mini, { backgroundColor: tk.color.ground }]}>
      <View style={[styles.miniCard, { backgroundColor: tk.color.plate }]}>
        <Txt
          kind="statementBody"
          style={{ color: tk.color.ink, fontSize: 15, lineHeight: 21 }}
          numberOfLines={2}
        >
          {greeting}
        </Txt>
        <Txt
          style={[typeScale.amountM, { color: tk.color.ink }]}
          maxFontSizeMultiplier={1.3}
          numberOfLines={1}
        >
          {format.usd(heroLine.netCents)}
        </Txt>
        <View
          style={[
            styles.miniCapsule,
            {
              backgroundColor: tk.color.jade,
              borderColor: tk.dark ? tk.color.jade : tk.color.jadeFlushBorder,
            },
          ]}
        >
          <Glyph name="check" size={14} color={tk.color.onJade} />
          <Txt kind="caption" style={{ color: tk.color.onJade }}>
            {paid}
          </Txt>
        </View>
      </View>
    </View>
  );
}

export function ThemeScreen() {
  const { theme, setTheme, completeOnboarding, lang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();
  const stacked = width < 360 || fontScale >= 1.3;
  const greeting = tr("M-ON-01.theme.sampleGreeting", { name: heroLine.nameByLang[lang] });

  const option = (name: ThemeName) => {
    const selected = theme === name;
    return (
      <Pressable
        key={name}
        testID={`M-ON-01.theme.${name}`}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={`${tr(name === "adlaw" ? "M-ON-01.theme.adlaw" : "M-ON-01.theme.tablea")}. ${tr(
          name === "adlaw" ? "M-ON-01.theme.adlawHint" : "M-ON-01.theme.tableaHint",
        )}`}
        onPress={() => setTheme(name)}
        style={[
          styles.option,
          stacked ? null : { flex: 1 },
          {
            borderColor: selected ? t.color.ink : t.color.rule,
            borderWidth: selected ? 2 : 1,
            backgroundColor: t.color.plate,
          },
        ]}
      >
        <MiniStatement tk={themes[name]} greeting={greeting} paid={MEMBER_STATUS_WORDS.PAID[lang]} />
        <View style={styles.optionLabel}>
          <View style={{ flex: 1 }}>
            <Txt kind="title2">{tr(name === "adlaw" ? "M-ON-01.theme.adlaw" : "M-ON-01.theme.tablea")}</Txt>
            <Txt kind="caption" color="ink2">
              {tr(name === "adlaw" ? "M-ON-01.theme.adlawHint" : "M-ON-01.theme.tableaHint")}
            </Txt>
          </View>
          {selected ? <Glyph name="check" color={t.color.ink} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen
      testID="M-ON-01"
      state="theme"
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
            onPress={() => {
              completeOnboarding();
              router.replace(HREF.pair);
            }}
          />
        </View>
      }
    >
      <Txt kind="title1" accessibilityRole="header">
        {tr("M-ON-01.theme.title")}
      </Txt>
      <View
        style={[styles.options, { flexDirection: stacked ? "column" : "row" }]}
        accessibilityRole="radiogroup"
      >
        {option("adlaw")}
        {option("tablea")}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  options: { gap: space.s12 },
  option: { borderRadius: radius.plate, overflow: "hidden" },
  mini: { padding: space.s12 },
  miniCard: { padding: space.s12, gap: space.s8 },
  miniCapsule: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: space.s4,
    paddingHorizontal: space.s8,
    paddingVertical: space.s2,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  optionLabel: { flexDirection: "row", alignItems: "center", gap: space.s8, padding: space.s12 },
  footer: { paddingHorizontal: space.s16, paddingTop: space.s12 },
});
