/**
 * First-run pieces (ONBOARDING slice). First run is where a judge or Nang Celing meets the product, so it carries
 * the design's own materials (design §1 signatures 1 and 7, §2.5):
 * - the desk: a band of tablea lacquer, the colour of a roasted cacao tablet, whatever the app's theme;
 * - paper on it: the white original, square-cornered, casting the product's only shadow;
 * - the stencilled season and lot marks of the jute sacks;
 * - the ink stamp of a person's decision, from the box stamped on a choice to the initials that land when a phone
 *   is paired.
 * Plus the choice plate that can speak itself in the phone's own voice (labelled, I8), the six-box pairing code and
 * the footer that holds each step's one action in the thumb zone.
 */
import * as Speech from "expo-speech";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, TextInput, View, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import type { Lang } from "../../_shims/contracts";
import { fontFamily } from "../../_shims/fonts";
import { radius, space, target, themes } from "../../_shims/tokens.native";
import { CODE_LENGTH, normalizeCode } from "../../lib/pairing";
import { pickVoiceLanguage } from "../../services/voice";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { reducedFade, spring, tween } from "../../ui/motion";
import { Txt } from "../../ui/text";
import { qrFacsimileCells } from "./flow";

/** The desk is always tablea lacquer: paper glows on it in either theme (design §1, signature 1). */
const DESK = themes.tablea;

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

/* ------------------------------------------------------------------ the desk and the paper on it */

/** The bodega desk: a full-bleed band of lacquer under the step's paper. */
export function Desk({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <View testID={testID} style={[styles.desk, { backgroundColor: DESK.color.ground }]}>
      {children}
    </View>
  );
}

/** Words written on the desk itself: chalk on lacquer (8.4:1). */
export function DeskNote({ children, testID }: { children: ReactNode; testID?: string }) {
  return (
    <Txt kind="body" style={{ color: DESK.color.ink2 }} testID={testID}>
      {children}
    </Txt>
  );
}

/** A sheet of paper on the desk: the white original, radius 0, and the only shadow in the product. */
export function Paper({
  children,
  style,
  testID,
}: {
  children: ReactNode;
  style?: ViewStyle;
  testID?: string;
}) {
  const { t } = useFs();
  return (
    <View
      testID={testID}
      style={[styles.paper, { backgroundColor: t.color.copyWhite, boxShadow: DESK.shadowPaper }, style]}
    >
      {children}
    </View>
  );
}

/* ------------------------------------------------------------------ the season and lot marks */

/**
 * "2026-A", "LB-PH-2026-03": the season and the lot as ids. UI gate round 3 retires the stencilled display face (the
 * condensed figures with bridged counters): a mark is the id role now, the figure cut's tabular set in mono, 13 px for
 * the lot and a step up for the season beside the product name. Read as one label by a screen reader. `ground` is
 * kept for callers (the stencil's bridges used it).
 */
export function StencilMark({
  text,
  label,
  size = 20,
  color,
  testID,
}: {
  text: string;
  label: string;
  size?: number;
  color: string;
  ground?: string;
  testID?: string;
}) {
  const fontSize = size >= 24 ? 17 : 13;
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={label}
      testID={testID}
      dataSet={{ mark: text }}
      style={styles.stencil}
    >
      <Txt
        kind="hash"
        importantForAccessibility="no"
        aria-hidden
        maxFontSizeMultiplier={1.5}
        style={{ color, fontSize, lineHeight: Math.round(fontSize * 1.35) }}
      >
        {text}
      </Txt>
    </View>
  );
}

/* ------------------------------------------------------------------ a choice, stamped */

/** The box a person stamps: hollow until chosen, then filled with ink (a human decision is ink, design §2.5). */
function StampBox({ checked }: { checked: boolean }) {
  const { t } = useFs();
  return (
    <View
      style={[
        styles.stampBox,
        checked
          ? { backgroundColor: t.color.ink, borderColor: t.color.ink }
          : { backgroundColor: "transparent", borderColor: t.color.ink3 },
      ]}
    >
      {checked ? <Glyph name="check" size={20} color={t.color.plate} /> : null}
    </View>
  );
}

export function ChoicePlate({
  selected,
  onSelect,
  title,
  body,
  lang,
  testID,
  play,
  paper,
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
  /** A sheet of paper on the desk (with the paper shadow) rather than a plate on the ground. */
  paper?: boolean;
  children?: ReactNode;
}) {
  const { t } = useFs();
  const surface: ViewStyle = paper
    ? { backgroundColor: t.color.copyWhite, boxShadow: DESK.shadowPaper, borderRadius: radius.none }
    : {
        backgroundColor: t.color.plate,
        borderWidth: 2,
        borderRadius: radius.plate,
        borderColor: selected ? t.color.ink : t.color.rule,
      };
  return (
    <View style={[styles.plate, surface]}>
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
        <StampBox checked={selected} />
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

/* ------------------------------------------------------------------ the treasurer's pairing card */

/**
 * Where the QR sits on the treasurer's card: its three finder squares in pencil (machine print) over a faint,
 * fixed scatter of modules. A picture of the card, never a code: there is nothing here that decodes.
 */
export function QrFacsimile({ size }: { size: number }) {
  const { t } = useFs();
  const m = size / 25;
  const finder = (x: number, y: number) =>
    `M${x} ${y}h${7 * m}v${7 * m}h${-7 * m}z M${x + m} ${y + m}v${5 * m}h${5 * m}v${-5 * m}z M${x + 2 * m} ${y + 2 * m}h${3 * m}v${3 * m}h${-3 * m}z`;
  const finders = [finder(0, 0), finder(18 * m, 0), finder(0, 18 * m)].join(" ");
  const modules = useMemo(
    () =>
      qrFacsimileCells()
        .map(([r, c]) => `M${c * m} ${r * m}h${m}v${m}h${-m}z`)
        .join(" "),
    [m],
  );
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <Svg width={size} height={size}>
        <Path d={modules} fill={t.color.pencil} fillOpacity={0.3} />
        <Path d={finders} fill={t.color.pencil} fillRule="evenodd" />
      </Svg>
    </View>
  );
}

/** The camera's frame on the card: the same three finder squares, drawn over the live picture to aim by. */
export function FinderGuide({ size, color }: { size: number; color: string }) {
  const m = size / 25;
  const corner = (x: number, y: number) => `M${x} ${y}h${7 * m}v${7 * m}h${-7 * m}z`;
  const d = [corner(0, 0), corner(18 * m, 0), corner(0, 18 * m)].join(" ");
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} accessibilityElementsHidden>
      <Svg width={size} height={size}>
        <Path d={d} fill="none" stroke={color} strokeWidth={2} />
      </Svg>
    </View>
  );
}

/**
 * The ink stamp that lands on the card when the phone is paired: the person's initials, pressed once. The one
 * authored motion of the pairing step (the land spring); under reduced motion it fades in over 150 ms.
 */
export function PairStamp({ initials, label, testID }: { initials: string; label: string; testID?: string }) {
  const { t, motion } = useFs();
  const scale = useSharedValue(motion.reduced ? 1 : 1.25);
  const opacity = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced) {
      opacity.set(withTiming(1, reducedFade()));
      return;
    }
    opacity.set(withTiming(1, tween("micro")));
    scale.set(withSpring(1, spring("land")));
  }, [motion.reduced, opacity, scale]);
  const style = useAnimatedStyle(() => ({
    opacity: opacity.get(),
    transform: [{ rotate: "-4deg" }, { scale: scale.get() }],
  }));
  return (
    <Animated.View
      accessible
      accessibilityRole="image"
      accessibilityLabel={label}
      testID={testID}
      style={[styles.bigStamp, { backgroundColor: t.color.ink }, style]}
    >
      <View style={[styles.bigStampRim, { borderColor: t.color.plate }]} />
      {initials ? (
        <Txt maxFontSizeMultiplier={1} style={[styles.bigStampText, { color: t.color.plate }]}>
          {initials}
        </Txt>
      ) : (
        <Glyph name="check" size={40} color={t.color.plate} />
      )}
    </Animated.View>
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
      <View style={[COLUMN, styles.footerColumn]}>{children}</View>
    </View>
  );
}

/** First-run screens read as one column, centred on a wide window (a judge's laptop). */
export const COLUMN: ViewStyle = { maxWidth: 560, width: "100%", alignSelf: "center" };

const styles = StyleSheet.create({
  desk: {
    marginHorizontal: -space.s16,
    paddingHorizontal: space.s16,
    paddingVertical: space.s24,
    gap: space.s16,
  },
  paper: { borderRadius: radius.none },
  stencil: { flexDirection: "row", alignItems: "flex-end", alignSelf: "flex-start" },
  plate: {
    flexDirection: "row",
    alignItems: "stretch",
    minHeight: 88,
  },
  choice: { flex: 1, flexDirection: "row", alignItems: "center", gap: space.s16, padding: space.s16 },
  choiceText: { flex: 1, gap: space.s4 },
  stampBox: {
    width: 28,
    height: 28,
    borderWidth: 2,
    borderRadius: radius.plate,
    alignItems: "center",
    justifyContent: "center",
  },
  play: {
    width: target.hero,
    minHeight: target.min,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
  },
  bigStamp: {
    width: 96,
    height: 96,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.plate,
  },
  bigStampRim: { position: "absolute", top: 6, left: 6, right: 6, bottom: 6, borderWidth: 1.5 },
  bigStampText: { fontFamily: fontFamily.strong, fontSize: 36, lineHeight: 40, letterSpacing: 1 },
  // The six boxes share the row they are given (a card on a 320 dp phone is 256 dp inside), up to 48 dp each.
  codeRow: { flexDirection: "row", alignItems: "center", gap: space.s8, alignSelf: "stretch" },
  box: {
    flex: 1,
    maxWidth: 48,
    height: target.primary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderRadius: radius.plate,
  },
  boxGap: { marginLeft: space.s12 },
  codeField: { color: "transparent", opacity: 0.02, fontSize: 28 },
  footer: {
    paddingHorizontal: space.s16,
    paddingTop: space.s12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  footerColumn: { gap: space.s8 },
});
