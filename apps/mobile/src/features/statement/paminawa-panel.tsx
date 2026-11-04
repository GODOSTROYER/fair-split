/**
 * M-MB-03 Paminawa (S1.9, design §6 M3): her statement read aloud one sentence at a time. The transcript is set at
 * 22 sp with the sentence being read in ink and underlined; play and pause at 72 dp; "Hinay" at 0.85×; language
 * chips; and an honest label for the voice: "Sintetikong tingog (Gemini TTS)" for the clips fs-api served for these
 * sentences, "Tingog sa telepono" when the phone reads, "Audio sa Filipino; teksto sa Cebuano" when spike S10 failed, or
 * text only when this phone has no voice for the language. When a sentence names a slip, its chip rises 8 dp and is
 * lit for 1.2 s. It plays by itself only for "Paminawon una", never under TalkBack and never on the web.
 */
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  type LayoutChangeEvent,
  Platform,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  View,
  type ViewInstance,
} from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Lang } from "../../_shims/contracts";
import { fontFamily } from "../../_shims/fonts";
import { translate } from "../../_shims/i18n";
import { radius, space, target } from "../../_shims/tokens.native";
import { type AudioPlan, audioPlan, glossPairs, MONEY_SLOTS } from "../../lib/statement";
import type { VoiceChoice } from "../../platform/speech";
import { stage } from "../../services/frame-bridge";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { spring, TIMELINE } from "../../ui/motion";
import { Button, Hatch, HonestyPill, SurfaceLabels } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { lineView } from "./line-view";
import { canPlay, paminawaScreenState, SLOW_RATE } from "./paminawa-machine";
import { GlossedSentence, LangBar } from "./parts";
import { useStatement } from "./statement-store";
import { usePaminawa, usePhoneVoice } from "./use-paminawa";
import { useT } from "./use-t";

const EMPTY: AudioPlan = { mode: "text-only", steps: [] };

/** The honest name of the voice that will read (I8), or null while the phone is still being asked. */
export function useVoiceLabel(
  plan: AudioPlan,
  voice: VoiceChoice | null | undefined,
  lang: Lang,
): string | null {
  const tr = useT();
  const clipLabel = plan.steps.find((s) => s.voice.kind === "clip");
  switch (plan.mode) {
    case "synthetic":
      return clipLabel?.voice.kind === "clip" && clipLabel.voice.label
        ? clipLabel.voice.label
        : tr("M-MB-03.synthetic");
    case "filipino-audio":
      return tr("M-MB-03.filipinoAudio");
    case "mixed":
      return tr("M-MB-03.mixed");
    case "device-voice":
      return `${tr("common.deviceVoice")}. ${tr("M-MB-03.deviceVoiceNote")}`;
    case "text-only":
      return voice === undefined
        ? null
        : tr("M-MB-03.textOnly", { lang: translate(lang, "common.langName") });
  }
}

/** A slip chip that rises 8 dp (`settle`) and is lit for 1.2 s each time the voice names it. */
function NamedChip({ serial, lit, label }: { serial: string; lit: number; label: string }) {
  const { t, motion } = useFs();
  const y = useSharedValue(0);
  const on = useSharedValue(0);
  useEffect(() => {
    if (!lit) return;
    on.set(1);
    const off = setTimeout(() => on.set(0), TIMELINE.paminawaChip.litMs);
    if (!motion.reduced) {
      y.set(
        withSequence(
          withSpring(-TIMELINE.paminawaChip.liftDp, spring("settle")),
          withDelay(TIMELINE.paminawaChip.litMs, withSpring(0, spring("settle"))),
        ),
      );
    }
    return () => clearTimeout(off);
  }, [lit, motion.reduced, y, on]);
  const lift = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const face = useAnimatedStyle(() => ({
    backgroundColor: on.get() ? t.color.ink : t.color.plate,
    borderColor: on.get() ? t.color.ink : t.color.rule,
  }));
  const text = useAnimatedStyle(() => ({ color: on.get() ? t.color.plate : t.color.ink }));
  return (
    <Animated.View style={lift} testID={`M-MB-03.chip.${serial}`} dataSet={{ lit: lit ? "named" : "idle" }}>
      <Animated.View style={[styles.chip, face]} accessible accessibilityLabel={label}>
        <Animated.Text style={[styles.chipText, text]} maxFontSizeMultiplier={2}>
          {serial}
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

export function PaminawaPanel({ onClose, auto = false }: { onClose(): void; auto?: boolean }) {
  const { lang, online } = useApp();
  const { t, motion } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const st = useStatement();
  const { dto, capsule } = st;
  const view = dto && capsule ? lineView(dto, capsule, st.track, lang) : null;
  const rail = view?.payKind ?? "paypal";
  const exclude = view && !view.showAmount ? MONEY_SLOTS : undefined;
  const pairs = useMemo(() => (dto ? glossPairs(dto, lang, rail, exclude) : []), [dto, lang, rail, exclude]);
  const voice = usePhoneVoice(lang);
  const plan = useMemo(
    () =>
      dto ? audioPlan(dto, lang, { deviceVoice: !!voice, rail, exclude, playable: () => online }) : EMPTY,
    [dto, lang, voice, rail, exclude, online],
  );
  const player = usePaminawa(plan, {
    voice,
    lockTitle: tr("M-MB-03.lockTitle"),
    lockArtist: dto?.coop.name ?? "",
  });
  const { state } = player;
  const label = useVoiceLabel(plan, voice, lang);
  const playable = canPlay(plan);
  const screenState = paminawaScreenState({
    loaded: !!dto && (voice !== undefined || plan.mode !== "text-only"),
    status: state.status,
    mode: plan.mode,
    online,
  });

  // IC-12: a stage frame learns which screen it shows.
  useFocusEffect(
    useCallback(() => {
      stage.focus("M-MB-03");
    }, []),
  );

  // "Paminawon una": start by itself once the voice is known; never under TalkBack, never on the web.
  const started = useRef(false);
  useEffect(() => {
    if (!auto || started.current || motion.screenReader || Platform.OS === "web") return;
    if (voice === undefined || !playable) return;
    started.current = true;
    player.play(0);
  }, [auto, motion.screenReader, voice, playable, player]);

  // Keep the sentence being read in view: measured when it starts (layout events can be late or missing in a
  // throttled frame), with the last reported layout as the fallback.
  const scroll = useRef<ScrollViewInstance>(null);
  const content = useRef<ViewInstance>(null);
  const rows = useRef<(ViewInstance | null)[]>([]);
  const tops = useRef<number[]>([]);
  useEffect(() => {
    if (state.status !== "playing") return;
    const go = (y: number) =>
      scroll.current?.scrollTo({ y: Math.max(0, y - space.s24), animated: !motion.reduced });
    const row = rows.current[state.index];
    const fallback = tops.current[state.index];
    if (row && content.current) {
      row.measureLayout(
        content.current,
        (_x, y) => go(y),
        () => fallback !== undefined && go(fallback),
      );
    } else if (fallback !== undefined) {
      go(fallback);
    }
  }, [state.index, state.status, motion.reduced]);

  const playingNow = state.status === "playing";
  const total = plan.steps.length;

  return (
    <View
      style={[styles.sheet, { backgroundColor: t.color.plate2, paddingTop: insets.top + space.s8 }]}
      testID="M-MB-03"
      dataSet={{ state: screenState, voice: plan.mode }}
    >
      <View style={styles.header}>
        <Txt kind="title1" accessibilityRole="header" style={styles.flex}>
          {tr("M-MB-03.title")}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("common.close")}
          onPress={onClose}
          hitSlop={8}
          style={({ pressed }) => [styles.close, pressed && { backgroundColor: t.color.pencilWash }]}
          testID="M-MB-03.close"
        >
          <Glyph name="close" color={t.color.ink} />
        </Pressable>
      </View>
      <ScrollView ref={scroll} style={styles.flex} contentContainerStyle={styles.transcript}>
        <View ref={content} collapsable={false} style={styles.content}>
          {/* The labels scroll away with the transcript, so a small phone keeps most of its height for the words. */}
          <View style={styles.top}>
            <SurfaceLabels screen="M-MB-03" />
            <LangBar testID="M-MB-03" />
            {label ? (
              // Round 2: the voice is labelled with the honesty tag family's "Synthetic voice" tag, not a sentence.
              <HonestyPill
                testID="M-MB-03.voice"
                dataSet={{ state: plan.mode }}
                glyph={plan.mode === "text-only" ? "info" : "listen"}
              >
                {label}
              </HonestyPill>
            ) : null}
            {!online ? (
              <Txt kind="caption" color="ink2" testID="M-MB-03.offline">
                {tr("M-MB-03.offline")}
              </Txt>
            ) : null}
          </View>
          <View style={[styles.rule, { backgroundColor: t.color.rule }]} />
          {pairs.map((p, i) => {
            const current = i === state.index && state.status !== "idle";
            return (
              <Pressable
                key={p.sentence.id}
                ref={(r) => {
                  rows.current[i] = r;
                }}
                onLayout={(e: LayoutChangeEvent) => {
                  tops.current[i] = e.nativeEvent.layout.y;
                }}
                onPress={playable ? () => player.play(i) : undefined}
                disabled={!playable}
                accessibilityRole={playable ? "button" : "text"}
                accessibilityHint={playable ? tr("M-MB-03.playFrom") : undefined}
                aria-selected={current}
                testID={`M-MB-03.sentence.${i}`}
                dataSet={{
                  state: current ? "current" : "idle",
                  audioSource: plan.steps[i]?.voice.kind ?? "none",
                  audioUrl: plan.steps[i]?.voice.kind === "clip" ? plan.steps[i]?.voice.url : "",
                  audioSlot: p.sentence.slot ?? "",
                }}
                style={({ pressed }) => [styles.sentence, pressed && { backgroundColor: t.color.pencilWash }]}
              >
                <GlossedSentence
                  pair={p}
                  lang={lang}
                  gloss={st.gloss}
                  kind="statementLead"
                  color={current || state.status === "idle" ? "ink" : "ink2"}
                  underline={current}
                />
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View
        style={[styles.controls, { paddingBottom: insets.bottom + space.s16, borderTopColor: t.color.rule }]}
      >
        {dto?.slips.length ? (
          <View style={styles.chips}>
            {dto.slips.map((s) => (
              <NamedChip
                key={s.serial}
                serial={s.serial}
                lit={state.lit[s.serial] ?? 0}
                label={tr("M-MB-02.slip", { serial: s.serial })}
              />
            ))}
          </View>
        ) : null}
        <View style={styles.row}>
          <Pressable
            testID="M-MB-03.play"
            accessibilityRole="button"
            accessibilityLabel={playingNow ? tr("M-MB-03.pause") : tr("M-MB-03.play")}
            aria-disabled={!playable}
            disabled={!playable}
            dataSet={{ state: playingNow ? "playing" : playable ? "ready" : "unavailable" }}
            onPress={() => (playingNow ? player.pause() : player.play())}
            style={({ pressed }) => [
              styles.play,
              // Round 2: the same indigo play circle as the statement's Paminawa button.
              {
                backgroundColor: !playable
                  ? t.color.plate
                  : pressed
                    ? t.slab.chalk.edgeRight
                    : t.slab.chalk.face,
              },
              !playable && { borderColor: t.color.rule, borderWidth: 1 },
            ]}
          >
            {!playable ? <Hatch /> : null}
            <Glyph
              name={playingNow ? "pause" : "play"}
              size={32}
              color={playable ? t.slab.chalk.label : t.color.ink3}
            />
          </Pressable>
          <View style={styles.side}>
            <View style={styles.sideRow}>
              <Pressable
                testID="M-MB-03.slow"
                accessibilityRole="switch"
                accessibilityLabel={`${tr("M-MB-03.slow")}, ${tr("M-MB-03.slowValue")}`}
                aria-checked={state.rate === SLOW_RATE}
                aria-disabled={!playable}
                disabled={!playable}
                dataSet={{ state: state.rate === SLOW_RATE ? "on" : "off" }}
                onPress={() => player.slow(state.rate !== SLOW_RATE)}
                hitSlop={4}
                style={[styles.slowTap, !playable && styles.unavailable]}
              >
                <View
                  style={[
                    styles.slow,
                    {
                      backgroundColor: state.rate === SLOW_RATE ? t.color.ink : t.color.plate,
                      borderColor: state.rate === SLOW_RATE ? t.color.ink : t.color.rule,
                    },
                  ]}
                >
                  <Txt kind="label" style={{ color: state.rate === SLOW_RATE ? t.color.plate : t.color.ink }}>
                    {tr("M-MB-03.slow")}
                  </Txt>
                  <Txt
                    kind="figureS"
                    style={{ color: state.rate === SLOW_RATE ? t.color.plate : t.color.ink2 }}
                  >
                    {tr("M-MB-03.slowValue")}
                  </Txt>
                </View>
              </Pressable>
              {playable ? (
                <Button
                  variant="text"
                  icon="refresh"
                  label={tr("M-MB-03.restart")}
                  onPress={() => player.play(0)}
                  testID="M-MB-03.restart"
                />
              ) : null}
            </View>
            {total ? (
              <Txt kind="figureS" color="ink2" testID="M-MB-03.progress">
                {tr("M-MB-03.progress", { n: Math.min(state.index + 1, total), total })}
              </Txt>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.s16, gap: space.s8 },
  close: { width: target.min, height: target.min, alignItems: "center", justifyContent: "center" },
  top: { paddingHorizontal: space.s8, gap: space.s12, paddingBottom: space.s8 },
  voice: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  rule: { height: 1, marginHorizontal: space.s8, marginBottom: space.s8 },
  transcript: { paddingHorizontal: space.s8, paddingTop: space.s8, paddingBottom: space.s24 },
  content: { gap: space.s4 },
  sentence: { paddingHorizontal: space.s8, paddingVertical: space.s8, borderRadius: radius.plate },
  controls: { gap: space.s16, paddingHorizontal: space.s16, paddingTop: space.s16, borderTopWidth: 1 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s8 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 32,
    paddingHorizontal: space.s12,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  chipText: { fontFamily: fontFamily.figure, fontSize: 14, lineHeight: 18 },
  row: { flexDirection: "row", alignItems: "center", gap: space.s16 },
  play: {
    width: target.play,
    height: target.play,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    overflow: "hidden",
  },
  side: { flex: 1, gap: space.s8 },
  sideRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.s8 },
  slowTap: { minHeight: target.min, justifyContent: "center" },
  unavailable: { opacity: 0.55 },
  slow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: space.s4,
    minHeight: 36,
    paddingHorizontal: space.s12,
    paddingVertical: space.s8,
    borderWidth: 1,
    borderRadius: radius.pill,
  },
});
