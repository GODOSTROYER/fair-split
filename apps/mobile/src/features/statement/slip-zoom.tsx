/**
 * MM-7 "Tap a peso" (design §7 M7, S2.9): from her slip chip the view zooms about the tap point from 1× to 2.4×
 * into the crop where the kilos are written in Jessie's hand; the statement dims to 20%; the other crops tile
 * beneath with their sum printed flat. Back reverses the zoom. Low tier and reduced motion: a 200 ms crossfade
 * straight to the crop. Crops come from the reviewed fixtures (IC-11) only; until WS-MEDIA lands this draws a
 * labelled sample of the slip template.
 */
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { BackHandler, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import type { StatementSlip } from "../../_shims/api-client";
import type { Lang } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import { radius, space, springs, tweens } from "../../_shims/tokens.native";
import { feedback } from "../../platform/feedback";
import { useFs } from "../../theme/theme";
import { Button } from "../../ui/primitives";
import { Txt, useT } from "../../ui/text";
import type { Mm7Phase } from "./receipt-bar";

const ZOOM = 2.4;
const GLIDE_SETTLE_MS = 661;

/** A slip crop: the reviewed photo when it exists, otherwise a labelled sample of the template. */
export function SlipCrop({ slip, width, lang }: { slip: StatementSlip; width: number; lang: Lang }) {
  const { t } = useFs();
  const tr = useT();
  const height = Math.round(width * 0.62);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${tr("M-MB-02.slip", { serial: slip.serial })}, ${format.kg(slip.netGrams, 2)}. ${tr("common.syntheticSample")}`}
      style={[
        styles.paper,
        { width, height, backgroundColor: t.color.copyWhite, boxShadow: t.shadowPaper } as object,
      ]}
    >
      {slip.cropUrl ? (
        <Image source={{ uri: slip.cropUrl }} style={StyleSheet.absoluteFill} contentFit="contain" />
      ) : (
        <View style={styles.template}>
          <View style={styles.templateHead}>
            <Txt kind="caption" style={{ color: "#4E453E" }} maxFontSizeMultiplier={1}>
              Bulawanon Kakaw Growers MPC
            </Txt>
            <Txt kind="caption" style={{ color: "#BF2A1C" }} maxFontSizeMultiplier={1}>
              {`No. ${slip.serial}`}
            </Txt>
          </View>
          {[
            ["Date", format.date(slip.deliveredOn, lang)],
            ["Net kg", format.kg(slip.netGrams, 2).replace(" kg", "")],
          ].map(([k, v]) => (
            <View key={k} style={[styles.field, { borderBottomColor: "#D8D4CD" }]}>
              <Txt kind="caption" style={{ color: "#6F665E", width: width * 0.22 }} maxFontSizeMultiplier={1}>
                {k}
              </Txt>
              <Txt
                maxFontSizeMultiplier={1}
                style={{
                  color: t.color.ballpoint,
                  fontFamily: "MonaSans_500Medium",
                  fontSize: Math.round(width * (k === "Net kg" ? 0.1 : 0.06)),
                  transform: [{ rotate: "-2deg" }],
                }}
              >
                {v}
              </Txt>
            </View>
          ))}
        </View>
      )}
      <View style={[styles.tag, { backgroundColor: t.color.plate2, borderColor: t.color.rule }]}>
        <Txt kind="caption" color="ink2" maxFontSizeMultiplier={1}>
          {tr("common.syntheticSample")}
        </Txt>
      </View>
    </View>
  );
}

export function SlipZoom({
  slips,
  serial,
  origin,
  lang,
  onPhase,
  onClosed,
}: {
  slips: readonly StatementSlip[];
  serial: string;
  origin: { x: number; y: number };
  lang: Lang;
  onPhase(p: Mm7Phase): void;
  onClosed(): void;
}) {
  const { t, motion } = useFs();
  const tr = useT();
  const { width: W, height: H } = useWindowDimensions();
  const cardW = Math.min(W - space.s32, 380);
  const cardH = Math.round(cardW * 0.62);
  const top = Math.max(space.s64, H * 0.12);
  const centre = { x: W / 2, y: top + cardH / 2 };
  const instant = motion.reduced || motion.low;
  const s = useSharedValue(instant ? 1 : 1 / ZOOM);
  const k = useSharedValue(instant ? 1 : 0); // 0 = at the chip, 1 = in place
  const dim = useSharedValue(0);
  const [tiled, setTiled] = useState(false);
  const active = slips.find((x) => x.serial === serial) ?? slips[0];
  const others = slips.filter((x) => x.serial !== active?.serial);

  useEffect(() => {
    onPhase("zooming");
    if (instant) {
      dim.set(withTiming(1, { duration: tweens.glideFallback.duration }));
      const id = setTimeout(() => {
        onPhase("zoomed");
        setTiled(true);
        onPhase("tiled");
      }, tweens.glideFallback.duration);
      return () => clearTimeout(id);
    }
    dim.set(withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) }));
    s.set(withSpring(1, springs.glide));
    k.set(withSpring(1, springs.glide));
    // Phases follow the timeline, not frame delivery: the glide spring settles in about 661 ms (S2.8).
    const id = setTimeout(settle, GLIDE_SETTLE_MS);
    return () => clearTimeout(id);
  }, []);

  function settle() {
    onPhase("zoomed");
    setTiled(true);
    onPhase("tiled");
  }

  // A Rigid / Segment_Tick haptic as the zoom crosses 1.6× (of 2.4×).
  useAnimatedReaction(
    () => s.get() >= 1.6 / ZOOM,
    (crossed, was) => {
      if (crossed && was === false) scheduleOnRN(feedback.play, "zoom.commit");
    },
  );

  const close = () => {
    onPhase("returning");
    setTiled(false);
    if (instant) {
      dim.set(withTiming(0, { duration: tweens.glideFallback.duration }));
      setTimeout(onClosed, tweens.glideFallback.duration);
      return;
    }
    dim.set(withTiming(0, { duration: 240 }));
    s.set(withSpring(1 / ZOOM, springs.glide));
    k.set(withSpring(0, springs.glide));
    // Exits run about 20% faster than entrances (design §3 rule 5).
    setTimeout(onClosed, Math.round(GLIDE_SETTLE_MS * 0.8));
  };

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      close();
      return true;
    });
    return () => sub.remove();
  });

  const scrim = useAnimatedStyle(() => ({ opacity: dim.get() * 0.8 }));
  const card = useAnimatedStyle(() => ({
    opacity: instant ? dim.get() : 1,
    transform: [
      { translateX: (origin.x - centre.x) * (1 - k.get()) },
      { translateY: (origin.y - centre.y) * (1 - k.get()) },
      { scale: s.get() },
    ],
  }));

  if (!active) return null;
  const total = format.kg(slips.reduce((sum, x) => sum + x.netGrams, 0));
  const tileW = Math.floor((cardW - space.s8 * 2) / 3);

  return (
    <View style={StyleSheet.absoluteFill} testID="M-MB-01.zoom">
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.color.ground }, scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel={tr("M-MB-02.close")} />
      </Animated.View>
      <Animated.View style={[styles.card, { top, left: (W - cardW) / 2 }, card]}>
        <SlipCrop slip={active} width={cardW} lang={lang} />
      </Animated.View>
      {tiled ? (
        <Animated.View
          entering={motion.reduced ? undefined : FadeIn.duration(180)}
          style={[styles.tiles, { top: top + cardH + space.s24, left: (W - cardW) / 2, width: cardW }]}
        >
          <View style={{ flexDirection: "row", gap: space.s8 }}>
            {others.map((o) => (
              <SlipCrop key={o.serial} slip={o} width={tileW} lang={lang} />
            ))}
          </View>
          <Txt kind="amountM" accessibilityLiveRegion="polite">
            {total}
          </Txt>
          {!active.cropUrl ? (
            <Txt kind="caption" color="ink2">
              {tr("M-MB-02.photoPending")}
            </Txt>
          ) : null}
          <Button
            variant="tonal"
            icon="back"
            label={tr("M-MB-02.close")}
            onPress={close}
            testID="M-MB-01.zoom.back"
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  paper: { borderRadius: radius.none, overflow: "hidden" },
  template: { flex: 1, padding: space.s12, gap: space.s8 },
  templateHead: { flexDirection: "row", justifyContent: "space-between" },
  field: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.s8,
    borderBottomWidth: 1,
    paddingBottom: 2,
  },
  tag: {
    position: "absolute",
    top: space.s8,
    right: space.s8,
    paddingHorizontal: space.s4,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  card: { position: "absolute" },
  tiles: { position: "absolute", gap: space.s12 },
});
