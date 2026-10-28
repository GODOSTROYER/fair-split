/**
 * M-ON-01 `listen-choice` (S1.9): members answer one question after pairing, "Unsa ang una ninyong gusto: basahon o
 * paminawon?", by picking one of two plates. Each plate can speak itself in the phone's own voice (labelled), so a
 * member who would rather listen does not have to read the options to choose listening. The answer is stored on this
 * phone, can be changed from the statement, and is never inferred from age or literacy.
 */
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { space } from "../../_shims/tokens.native";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { ChoicePlate, StepFooter, useSample } from "./parts";
import { useT } from "./use-t";

export function ListenChoice({ onDone }: { onDone(): void }) {
  const { lang, listenFirst, setListenFirst } = useApp();
  const { t } = useFs();
  const tr = useT();
  const sample = useSample();
  const [choice, setChoice] = useState<boolean | null>(listenFirst);

  const readOut = (id: "read" | "listen") =>
    id === "read"
      ? `${tr("M-ON-01.listen.read")}. ${tr("M-ON-01.listen.readHint")}`
      : `${tr("M-ON-01.listen.listen")}. ${tr("M-ON-01.listen.listenHint")} ${tr("M-ON-01.listen.sample")}`;

  return (
    <Screen
      testID="M-ON-01"
      state="listen-choice"
      footer={
        <StepFooter>
          <Button
            tall
            label={tr("M-ON-01.continue")}
            disabled={choice === null}
            testID="M-ON-01.continue"
            onPress={() => {
              if (choice === null) return;
              setListenFirst(choice);
              onDone();
            }}
          />
        </StepFooter>
      }
    >
      <Txt kind="statementLead" accessibilityRole="header" lang={lang}>
        {tr("M-ON-01.listen.title")}
      </Txt>

      <View style={styles.plates} accessibilityRole="radiogroup">
        <ChoicePlate
          lang={lang}
          selected={choice === false}
          onSelect={() => setChoice(false)}
          title={tr("M-ON-01.listen.read")}
          body={tr("M-ON-01.listen.readHint")}
          testID="M-ON-01.listen.read"
          play={{
            playing: sample.playing === "read",
            onPress: () => void sample.play("read", readOut("read"), lang),
            label: tr("M-ON-01.listen.play"),
            stopLabel: tr("M-ON-01.lang.stop"),
            testID: "M-ON-01.listen.read.play",
          }}
        />
        <ChoicePlate
          lang={lang}
          selected={choice === true}
          onSelect={() => setChoice(true)}
          title={tr("M-ON-01.listen.listen")}
          body={tr("M-ON-01.listen.listenHint")}
          testID="M-ON-01.listen.listen"
          play={{
            playing: sample.playing === "listen",
            onPress: () => void sample.play("listen", readOut("listen"), lang),
            label: tr("M-ON-01.listen.play"),
            stopLabel: tr("M-ON-01.lang.stop"),
            testID: "M-ON-01.listen.listen.play",
          }}
        />
      </View>

      <View style={styles.notes}>
        <View style={styles.voice}>
          <Glyph name="listen" size={16} color={t.color.ink2} />
          <Txt kind="caption" color="ink2">
            {tr("common.deviceVoice")}
          </Txt>
        </View>
        <Txt kind="caption" color="ink3">
          {tr("M-ON-01.listen.change")}
        </Txt>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  plates: { gap: space.s12 },
  notes: { gap: space.s4 },
  voice: { flexDirection: "row", alignItems: "center", gap: space.s4 },
});
