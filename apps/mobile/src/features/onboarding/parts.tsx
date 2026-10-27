/**
 * First-run pieces (ONBOARDING slice): a choice plate that can also speak itself in the phone's own voice (for a
 * member who would rather hear the options than read them), the six-box pairing code, and the sticky footer that
 * holds each step's one action in the thumb zone.
 */
import * as Speech from "expo-speech";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Lang } from "../../_shims/contracts";
import { radius, space, target } from "../../_shims/tokens.native";
import { CODE_LENGTH, normalizeCode } from "../../lib/pairing";
import { pickVoiceLanguage } from "../../services/voice";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Txt } from "../../ui/text";

/* ------------------------------------------------------------------ the phone's own voice, with a state */

/** Speaks one sample at a time and knows which one is speaking, so its button can say "Stop" (labelled I8). */
export function useSample() {
  const [playing, setPlaying] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  useEffect(
    () => () => {
      current.current = null;
      void Speech.stop();
    },
    [],
  );
  const play = useCallback(async (id: string, text: string, lang: Lang) => {
    await Speech.stop();
    if (current.current === id) {
      current.current = null;
      setPlaying(null);
      return;
    }
    current.current = id;
    setPlaying(id);
    const end = () => {
      if (current.current === id) {
        current.current = null;
        setPlaying(null);
      }
    };
    Speech.speak(text, {
      language: await pickVoiceLanguage(lang),
      rate: 0.92,
      onDone: end,
      onStopped: end,
      onError: end,
    });
  }, []);
  return { playing, play };
}

/* ------------------------------------------------------------------ a choice plate */

export function ChoicePlate({
  selected,
  onSelect,
  title,
  body,
  lang,
  testID,
  play,
  children,
}: {
  selected: boolean;
  onSelect(): void;
  title: string;
  body?: string;
  /** The language the plate is written in (each language plate speaks its own). */
  lang?: Lang;
  testID: string;
  play?: { playing: boolean; onPress(): void; label: string; stopLabel: string; testID: string };
  children?: ReactNode;
}) {
  const { t } = useFs();
  return (
    <View
      style={[
        styles.plate,
        { backgroundColor: t.color.plate, borderColor: selected ? t.color.ink : t.color.rule },
      ]}
    >
      <Pressable
        testID={testID}
        dataSet={{ state: selected ? "selected" : "idle" }}
        accessibilityRole="radio"
        accessibilityState={{ checked: selected }}
        accessibilityLabel={body ? `${title}. ${body}` : title}
        accessibilityLanguage={lang}
        onPress={onSelect}
        style={({ pressed }) => [styles.choice, pressed && { backgroundColor: t.color.pencilWash }]}
      >
        <View style={[styles.radio, { borderColor: selected ? t.color.ink : t.color.ink3 }]}>
          {selected ? <View style={[styles.radioDot, { backgroundColor: t.color.ink }]} /> : null}
        </View>
        <View style={styles.choiceText}>
          <Txt kind="title2" lang={lang}>
            {title}
          </Txt>
          {body ? (
            <Txt kind="statementBody" color="ink2" lang={lang}>
              {body}
            </Txt>
          ) : null}
          {children}
        </View>
      </Pressable>
      {play ? (
        <Pressable
          testID={play.testID}
          accessibilityRole="button"
          accessibilityLabel={play.playing ? play.stopLabel : play.label}
          accessibilityState={{ busy: play.playing }}
          dataSet={{ state: play.playing ? "playing" : "idle" }}
          onPress={play.onPress}
          style={({ pressed }) => [
            styles.play,
            {
              borderLeftColor: t.color.rule,
              backgroundColor: play.playing ? t.color.ink : pressed ? t.color.pencilWash : t.color.plate2,
            },
          ]}
        >
          <Glyph name={play.playing ? "stop" : "listen"} color={play.playing ? t.color.plate : t.color.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

/* ------------------------------------------------------------------ the six-box code */

const SLOTS = [0, 1, 2, 3, 4, 5] as const;

/**
 * Six boxes over one real number field (so paste, the SMS one-time-code suggestion, the system keyboard and the
 * screen reader all work); a space after the third box, as the treasurer's screen prints it ("418 207").
 */
export function CodeInput({
  value,
  onChange,
  onComplete,
  disabled,
  label,
  testID,
}: {
  value: string;
  onChange(v: string): void;
  onComplete(v: string): void;
  disabled?: boolean;
  label: string;
  testID: string;
}) {
  const { t } = useFs();
  const [focused, setFocused] = useState(false);
  const caret = Math.min(value.length, CODE_LENGTH - 1);
  return (
    <View style={styles.codeRow} dataSet={{ state: focused ? "focused" : "idle" }}>
      {SLOTS.map((n) => {
        const digit = value[n] ?? "";
        const active = focused && n === caret && !disabled;
        return (
          <View
            key={`slot${n}`}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[
              styles.box,
              n === 3 ? styles.boxGap : null,
              {
                backgroundColor: t.color.plate,
                borderColor: active ? t.color.pod : digit ? t.color.ink2 : t.color.rule,
              },
            ]}
          >
            <Txt
              kind="amountM"
              style={{ color: disabled ? t.color.ink3 : t.color.ink }}
              maxFontSizeMultiplier={1.5}
            >
              {digit}
            </Txt>
          </View>
        );
      })}
      <TextInput
        testID={testID}
        value={value}
        onChangeText={(v) => {
          const next = normalizeCode(v);
          onChange(next);
          if (next.length === CODE_LENGTH) onComplete(next);
        }}
        editable={!disabled}
        accessibilityLabel={label}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={CODE_LENGTH + 2}
        caretHidden
        contextMenuHidden={false}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[StyleSheet.absoluteFill, styles.codeField]}
      />
    </View>
  );
}

/* ------------------------------------------------------------------ the step's one action */

export function StepFooter({ children }: { children: ReactNode }) {
  const { t } = useFs();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.footer,
        {
          paddingBottom: insets.bottom + space.s16,
          backgroundColor: t.color.ground,
          borderTopColor: t.color.rule,
        },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  plate: {
    flexDirection: "row",
    alignItems: "stretch",
    borderWidth: 2,
    borderRadius: radius.plate,
    minHeight: 88,
  },
  choice: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.s16, padding: space.s16 },
  choiceText: { flex: 1, gap: space.s4 },
  radio: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  radioDot: { width: 12, height: 12, borderRadius: 6 },
  play: {
    width: target.hero,
    minHeight: target.min,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
  },
  codeRow: { flexDirection: "row", alignItems: "center", gap: space.s8, alignSelf: "flex-start" },
  box: {
    width: 44,
    height: target.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: radius.plate,
  },
  boxGap: { marginLeft: space.s12 },
  codeField: { color: "transparent", opacity: 0.02, fontSize: 28 },
  footer: {
    gap: space.s8,
    paddingHorizontal: space.s16,
    paddingTop: space.s12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
