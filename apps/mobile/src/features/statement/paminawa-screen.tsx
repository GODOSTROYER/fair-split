/**
 * M-MB-03 Paminawa (listen): the statement read aloud one sentence at a time, the current sentence underlined in
 * ink, "Hinay" at 0.85×, language chips, lock-screen controls for the Gemini clips. When a clip is missing the
 * phone's own voice reads it, labelled as such (register §9 Audio). When the voice names "resibo 0403", that chip
 * rises 8 dp and stays lit for 1.2 s.
 */
import { setAudioModeAsync, useAudioPlaylist, useAudioPlaylistStatus } from "expo-audio";
import { router } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LANGS } from "../../_shims/contracts";
import { translate } from "../../_shims/i18n";
import { radius, space, springs, target } from "../../_shims/tokens.native";
import { statementSentences } from "../../lib/statement";
import { pickLanguage, type SpeakHandle, speakSequence } from "../../platform/speech";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Glyph } from "../../ui/glyph";
import { Button, Chip, MachineTranslatedNote } from "../../ui/primitives";
import { Sentence } from "../../ui/sentence";
import { Txt, useT } from "../../ui/text";
import { useStatement } from "./use-statement";

function LiftingChip({ serial, lit }: { serial: string; lit: number }) {
  const { t, motion } = useFs();
  const y = useSharedValue(0);
  useEffect(() => {
    if (!lit) return;
    if (motion.reduced) return;
    y.set(withSequence(withSpring(-8, springs.settle), withDelay(1200, withSpring(0, springs.settle))));
  }, [lit, motion.reduced, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.get() }] }));
  const on = lit > 0;
  return (
    <Animated.View style={style}>
      <View
        style={[
          styles.slipChip,
          { backgroundColor: on ? t.color.ink : t.color.plate, borderColor: on ? t.color.ink : t.color.rule },
        ]}
      >
        <Glyph name="slip" size={16} color={on ? t.color.plate : t.color.ink2} />
        <Txt kind="label" style={{ color: on ? t.color.plate : t.color.ink }}>
          {serial}
        </Txt>
      </View>
    </Animated.View>
  );
}

export function PaminawaScreen() {
  const { lang, setLang } = useApp();
  const { t } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { dto } = useStatement();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [slow, setSlow] = useState(false);
  const [lit, setLit] = useState<Record<string, number>>({});
  const speech = useRef<SpeakHandle | null>(null);

  const sentences = useMemo(() => (dto ? statementSentences(dto, lang).sentences : []), [dto, lang]);
  const clips = dto?.audio?.[lang] ?? null;
  const hasClips = !!clips && clips.length === sentences.length && clips.length > 0;
  const playlist = useAudioPlaylist({ sources: hasClips ? clips.map((c) => ({ uri: c.url })) : [] });
  const status = useAudioPlaylistStatus(playlist);

  // Lock-screen controls need `doNotMix` (S2.7); product sounds stay silent while Paminawa plays.
  useEffect(() => {
    if (!hasClips) return;
    void setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: "doNotMix",
      shouldPlayInBackground: true,
    });
    return () => {
      void setAudioModeAsync({
        playsInSilentMode: false,
        interruptionMode: "mixWithOthers",
        shouldPlayInBackground: false,
      });
    };
  }, [hasClips]);

  useEffect(() => {
    if (hasClips && status.currentIndex !== undefined) setIndex(status.currentIndex);
  }, [hasClips, status.currentIndex]);

  useEffect(() => {
    const s = sentences[index];
    if (!playing || !s?.mentions.length) return;
    const now = Date.now();
    setLit((cur) => ({
      ...cur,
      ...Object.fromEntries(s.mentions.map((m) => [m.replace("slip:", ""), now])),
    }));
  }, [index, playing, sentences]);

  useEffect(() => () => speech.current?.stop(), []);
  useEffect(() => {
    // Changing language restarts from the top in the new language.
    speech.current?.stop();
    setPlaying(false);
    setIndex(0);
  }, [lang]);

  const play = async (from = index) => {
    if (hasClips) {
      playlist.playbackRate = slow ? 0.85 : 1;
      if (from !== status.currentIndex) playlist.skipTo(from);
      playlist.setActiveForLockScreen(true, { title: tr("M-MB-03.title"), artist: dto?.coop.name ?? "" });
      playlist.play();
      setPlaying(true);
      return;
    }
    speech.current?.stop();
    const language = await pickLanguage(lang);
    setPlaying(true);
    speech.current = speakSequence(
      sentences.map((s) => s.spoken),
      {
        language,
        rate: slow ? 0.8 : 0.95,
        startAt: from,
        onSentence: setIndex,
        onDone: () => {
          setPlaying(false);
          setIndex(0);
        },
      },
    );
  };

  const pause = () => {
    if (hasClips) playlist.pause();
    else speech.current?.stop();
    setPlaying(false);
  };

  return (
    <View
      style={[styles.sheet, { backgroundColor: t.color.plate2, paddingTop: insets.top + space.s8 }]}
      testID="M-MB-03"
      dataSet={{ state: playing ? "playing" : "paused" }}
    >
      <View style={styles.header}>
        <Txt kind="title1" accessibilityRole="header" style={{ flex: 1 }}>
          {tr("M-MB-03.title")}
        </Txt>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={tr("common.close")}
          onPress={() => router.back()}
          hitSlop={8}
          style={styles.close}
          testID="M-MB-03.close"
        >
          <Glyph name="close" color={t.color.ink} />
        </Pressable>
      </View>
      <View style={styles.langs}>
        {LANGS.map((l) => (
          <Chip
            key={l}
            label={translate(l, "M-ON-01.lang.name")}
            selected={l === lang}
            onPress={() => setLang(l)}
            testID={`M-MB-03.lang.${l}`}
          />
        ))}
      </View>

      <Animated.ScrollView contentContainerStyle={styles.transcript}>
        {sentences.map((s, i) => (
          <Pressable
            key={s.id}
            onPress={() => {
              setIndex(i);
              void play(i);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: i === index }}
          >
            <Sentence
              segments={s.segments}
              kind="statementLead"
              color={i === index ? "ink" : "ink2"}
              lang={lang}
              underline={i === index}
            />
          </Pressable>
        ))}
        {dto ? (
          <View style={styles.chips}>
            {dto.slips.map((s) => (
              <LiftingChip key={s.serial} serial={s.serial} lit={lit[s.serial] ?? 0} />
            ))}
          </View>
        ) : null}
      </Animated.ScrollView>

      <View
        style={[styles.controls, { paddingBottom: insets.bottom + space.s16, borderTopColor: t.color.rule }]}
      >
        <Pressable
          testID="M-MB-03.play"
          accessibilityRole="button"
          accessibilityLabel={playing ? tr("M-MB-03.pause") : tr("M-MB-03.play")}
          onPress={() => (playing ? pause() : void play())}
          style={({ pressed }) => [styles.play, { backgroundColor: pressed ? t.color.ink2 : t.color.ink }]}
        >
          <Glyph name={playing ? "pause" : "play"} size={32} color={t.color.plate} />
        </Pressable>
        <View style={{ flex: 1, gap: space.s8 }}>
          <View style={{ flexDirection: "row", gap: space.s8, flexWrap: "wrap" }}>
            <Chip
              label={`${tr("M-MB-03.slow")} 0.85×`}
              selected={slow}
              onPress={() => {
                setSlow((v) => !v);
                if (hasClips) playlist.playbackRate = slow ? 1 : 0.85;
              }}
              testID="M-MB-03.slow"
            />
            <Button
              variant="text"
              icon="refresh"
              label={tr("M-MB-03.restart")}
              onPress={() => void play(0)}
            />
          </View>
          <Txt
            kind="caption"
            color="ink2"
            testID="M-MB-03.voice-label"
            dataSet={{ state: hasClips ? "synthetic" : "device-voice" }}
          >
            {hasClips ? tr("M-MB-03.synthetic") : tr("M-MB-03.deviceVoice")}
          </Txt>
          <MachineTranslatedNote />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: space.s16, gap: space.s8 },
  close: { width: target.min, height: target.min, alignItems: "center", justifyContent: "center" },
  langs: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: space.s8,
    paddingHorizontal: space.s16,
    paddingTop: space.s8,
  },
  transcript: { padding: space.s16, gap: space.s16 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.s8, paddingTop: space.s8 },
  slipChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    minHeight: 32,
    paddingHorizontal: space.s12,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  controls: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s16,
    paddingHorizontal: space.s16,
    paddingTop: space.s16,
    borderTopWidth: 1,
  },
  play: { width: target.play, height: target.play, alignItems: "center", justifyContent: "center" },
});
