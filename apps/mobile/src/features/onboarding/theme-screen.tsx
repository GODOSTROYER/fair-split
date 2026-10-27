/**
 * M-ON-01 first run, `/onboarding/theme` ("Klaro ba?"). The app has one theme, Adlaw, for daylight on a budget phone
 * (approved plan: one theme per surface; theme switching is cut), so this register route asks the question the theme
 * step existed for: can you read it? It shows a sample statement (labelled) at this phone's own text size. Too small,
 * and it says where the phone's text size lives (Android opens Display settings); Fair Split follows the system size
 * up to 2× (S1.12), and the sample grows the moment the person comes back.
 */
import { router } from "expo-router";
import { useState } from "react";
import { Linking, Platform, StyleSheet, useWindowDimensions, View } from "react-native";
import { MEMBER_STATUS_WORDS } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { cashDayIso, coop, fx, heroLine, season } from "../../_shims/seed";
import { radius, space } from "../../_shims/tokens.native";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { AmountDisplay } from "../../ui/amount";
import { Screen } from "../../ui/chrome";
import { Banner, Button, MemberStatusChip } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { largeText, textSizePct } from "./flow";
import { ChoicePlate, StepFooter } from "./parts";
import { useT } from "./use-t";

function openDisplaySettings(): void {
  if (Platform.OS === "android") {
    void Linking.sendIntent("android.settings.DISPLAY_SETTINGS").catch(() => {
      void Linking.openSettings().catch(() => {});
    });
  }
}

export function ThemeScreen() {
  const { completeOnboarding, lang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const { fontScale } = useWindowDimensions();
  const [answer, setAnswer] = useState<"clear" | "small" | null>(null);
  const stacked = largeText(fontScale);

  return (
    <Screen
      testID="M-ON-01"
      state="theme"
      footer={
        <StepFooter>
          <Button
            tall
            label={tr("M-ON-01.continue")}
            testID="M-ON-01.continue"
            onPress={() => {
              completeOnboarding();
              router.replace(HREF.pair);
            }}
          />
        </StepFooter>
      }
    >
      <View style={styles.lead}>
        <Txt kind="title1" accessibilityRole="header">
          {tr("M-ON-01.size.title")}
        </Txt>
        <Txt kind="body" color="ink2">
          {tr("M-ON-01.size.body")}
        </Txt>
      </View>

      <View
        style={[styles.sample, { backgroundColor: t.color.copyWhite, borderColor: t.color.rule }]}
        testID="M-ON-01.size.sample"
      >
        <Txt kind="label" color="ink2">
          {tr("M-ON-01.size.coop", { coop: coop.name, season: season.code })}
        </Txt>
        <Txt kind="statementLead" lang={lang}>
          {tr("M-ON-01.size.greeting", { name: heroLine.nameByLang[lang] })}
        </Txt>
        <View style={[styles.money, stacked ? styles.moneyStacked : null]}>
          <AmountDisplay
            text={format.usd(heroLine.netCents)}
            srLabel={format.amountSpoken(heroLine.netCents, fx.phpPerUsd)}
            state="landed"
          />
          <Txt kind="body" color="ink2">
            {format.pesoEstimate(heroLine.netCents, fx.phpPerUsd, lang)}
          </Txt>
        </View>
        <MemberStatusChip
          status="PAID"
          word={`${MEMBER_STATUS_WORDS.PAID[lang]}, ${format.dayMonth(cashDayIso, lang)}`}
        />
        <Txt kind="caption" color="ink3">
          {tr("common.syntheticSample")}
        </Txt>
      </View>

      <Txt kind="label" color="ink2" testID="M-ON-01.size.now" accessibilityLiveRegion="polite">
        {tr("M-ON-01.size.now", { pct: textSizePct(fontScale) })}
      </Txt>

      <View style={styles.choices} accessibilityRole="radiogroup">
        <ChoicePlate
          selected={answer === "clear"}
          onSelect={() => setAnswer("clear")}
          title={tr("M-ON-01.size.clear")}
          testID="M-ON-01.size.clear"
        />
        <ChoicePlate
          selected={answer === "small"}
          onSelect={() => setAnswer("small")}
          title={tr("M-ON-01.size.small")}
          testID="M-ON-01.size.small"
        />
      </View>

      {answer === "small" ? (
        <Banner icon="info" testID="M-ON-01.size.how">
          <Txt kind="body">{tr(Platform.OS === "web" ? "M-ON-01.size.howWeb" : "M-ON-01.size.how")}</Txt>
          {Platform.OS === "android" ? (
            <Button
              variant="text"
              label={tr("M-ON-01.size.open")}
              onPress={openDisplaySettings}
              style={styles.open}
              testID="M-ON-01.size.open"
            />
          ) : null}
        </Banner>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  lead: { gap: space.s8 },
  sample: { gap: space.s12, padding: space.s16, borderWidth: 1, borderRadius: radius.none },
  money: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: space.s12 },
  moneyStacked: { flexDirection: "column", alignItems: "flex-start" },
  choices: { gap: space.s12 },
  open: { alignSelf: "flex-start" },
});
