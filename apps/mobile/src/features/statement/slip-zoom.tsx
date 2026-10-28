/**
 * MM-7's zoom (design §7 M7, S2.9 "Tap a peso"): from the slip she tapped, the view zooms about the tap point into
 * the slip where her kilos are written in the clerk's hand, with the figure she traced framed in 1 px ink; the
 * statement dims to 20%; a Rigid / Segment_Tick haptic fires two-thirds of the way in. Then her other slips tile
 * beneath, 60 ms apart, with their sum printed flat ("Tanan: 148.0 kg"), and Paminawa can read the sentence that
 * names them, lifting each slip as it is named. Back plays the zoom in reverse.
 *
 * Phases come from the screen's MM-7 moment (zooming → zoomed → tiled → returning); they follow the spring's own
 * completion, not a timer. Reduced motion and the low tier crossfade (200 ms) straight to the slip at full size.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewInstance,
} from "react-native";
import Animated, {
  FadeIn,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";
import type { StatementDTO } from "../../_shims/api-client";
import type { Lang } from "../../_shims/contracts";
import { SPRING_SOURCE } from "../../_shims/motion";
import { layer, space } from "../../_shims/tokens.native";
import { slipFigures, slipTotal } from "../../lib/figures";
import type { AudioPlan } from "../../lib/statement";
import { feedback } from "../../platform/feedback";
import type { VoiceChoice } from "../../platform/speech";
import { useFs } from "../../theme/theme";
import { focusFirst } from "../../ui/a11y";
import type { MomentPhase } from "../../ui/moment";
import { ms, spring, TIMELINE, tween } from "../../ui/motion";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { hapticAt, zoomLimit, zoomTransform } from "./mm7";
import { canPlay } from "./paminawa-machine";
import { SLIP_ASPECT, type SlipOwner, SlipPaper } from "./slip-paper";
import { SlipTiles, type TapPoint } from "./slip-tiles";
import { usePaminawa } from "./use-paminawa";
import { useT } from "./use-t";

/** The statement shows at 20% under the zoom (design §7 M7). */
const DIM = 0.8;
/** How long the `glide` spring takes to come to rest: twice its perceptual duration (critically damped). */
const SETTLE_MS = SPRING_SOURCE.glide.d * 2000;

export function SlipZoom({
  dto,
  serial,
  origin,
  lang,
  owner,
  onPhase,
  onClosed,
  sources,
  voice,
  autoListen,
}: {
  dto: StatementDTO;
  serial: string;
  origin: TapPoint;
  lang: Lang;
  owner: SlipOwner;
  onPhase(p: MomentPhase<"MM-7">): void;
  onClosed(): void;
  /** The statement's SOURCES sentence as Paminawa would read it (one step), or an empty plan. */
  sources: AudioPlan;
  voice: VoiceChoice | null | undefined;
  autoListen: boolean;
}) {
  const { t, motion } = useFs();
  const tr = useT();
  const insets = useSafeAreaInsets();
  const { width: W, height: H } = useWindowDimensions();
  const instant = motion.reduced || motion.low;
  const zoom = zoomLimit(null);
  const cardW = Math.min(W - space.s32, 400);
  const cardH = Math.round(cardW * SLIP_ASPECT);
  const top = insets.top + Math.max(space.s48, H * 0.08);
  const centre = useMemo(() => ({ x: W / 2, y: top + cardH / 2 }), [W, top, cardH]);
  const k = useSharedValue(instant ? 1 : 0);
  const shown = useSharedValue(0);
  const [tiled, setTiled] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const paper = useRef<ViewInstance>(null);
  const later = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (later.current) clearTimeout(later.current);
    },
    [],
  );
  const active = dto.slips.find((x) => x.serial === serial) ?? dto.slips[0];
  const total = slipTotal(dto);
  const player = usePaminawa(sources, {
    voice,
    lockTitle: tr("M-MB-03.lockTitle"),
    lockArtist: dto.coop.name,
  });

  // In: glide from the chip (or crossfade), then tile the other slips 60 ms apart. The phases follow the
  // animation's own end; a frame that is throttled (a judge frame scrolled out of view, a backgrounded tab) never
  // reports one, so the same end is also reached after the spring's settling time and the slip set in place.
  useEffect(() => {
    onPhase("zooming");
    let done = false;
    const settled = () => {
      if (done) return;
      done = true;
      k.set(1);
      shown.set(1);
      onPhase("zoomed");
      setTiled(true);
      const stagger = TIMELINE["MM-7"].tileStaggerMs * Math.max(0, dto.slips.length - 1);
      later.current = setTimeout(() => onPhase("tiled"), stagger + ms("print"));
    };
    later.current = setTimeout(settled, instant ? ms("crossfade") + ms("micro") : SETTLE_MS);
    if (instant) {
      shown.set(withTiming(1, tween("crossfade"), (f) => f && scheduleOnRN(settled)));
      return;
    }
    shown.set(withTiming(1, tween("micro")));
    k.set(withSpring(1, spring("glide"), (f) => f && scheduleOnRN(settled)));
  }, []);

  useEffect(() => (tiled ? focusFirst(paper, 0) : undefined), [tiled]);

  // "Paminawon una": the sentence that names her slips reads itself once they are on the table (never under
  // TalkBack, and never on the web without a tap).
  const listened = useRef(false);
  useEffect(() => {
    if (!tiled || !autoListen || listened.current || !canPlay(sources)) return;
    listened.current = true;
    player.play(0);
  }, [tiled, autoListen, sources, player]);

  // The zoom commits two-thirds of the way in.
  useAnimatedReaction(
    () => k.get() >= hapticAt(),
    (crossed, was) => {
      if (crossed && was === false) scheduleOnRN(feedback.play, "zoom.commit");
    },
  );

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    if (later.current) clearTimeout(later.current);
    player.pause();
    onPhase("returning");
    setTiled(false);
    let closed = false;
    const done = () => {
      if (closed) return;
      closed = true;
      onClosed();
    };
    const exit = instant ? "crossfade" : "drawerOut";
    later.current = setTimeout(done, ms(exit) + ms("micro"));
    if (instant) {
      shown.set(withTiming(0, tween("crossfade"), (f) => f && scheduleOnRN(done)));
      return;
    }
    // Exits run faster than entrances (design §3 rule 5).
    shown.set(withTiming(0, tween("drawerOut")));
    k.set(withTiming(0, tween("drawerOut"), (f) => f && scheduleOnRN(done)));
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      closeRef.current();
      return true;
    });
    if (Platform.OS !== "web" || typeof document === "undefined") return () => sub.remove();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      sub.remove();
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const scrim = useAnimatedStyle(() => ({ opacity: shown.get() * DIM }));
  const card = useAnimatedStyle(() => {
    const z = zoomTransform(k.get(), origin, centre, zoom);
    return {
      opacity: instant ? shown.get() : 1,
      transform: [{ translateX: z.translateX }, { translateY: z.translateY }, { scale: z.scale }],
    };
  });

  if (!active) return null;
  const f = slipFigures(active, lang);

  return (
    <View
      style={[StyleSheet.absoluteFill, { zIndex: layer.flight }]}
      testID="M-MB-01.zoom"
      dataSet={{ state: tiled ? "tiled" : leaving ? "returning" : "zooming" }}
      accessibilityViewIsModal
    >
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: t.color.ground }, scrim]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={close}
          accessibilityRole="button"
          accessibilityLabel={tr("M-MB-02.close")}
          testID="M-MB-01.zoom.scrim"
        />
      </Animated.View>
      <Animated.View
        style={[styles.card, { top, left: (W - cardW) / 2, width: cardW, height: cardH }, card]}
        pointerEvents="box-none"
      >
        <View ref={paper} collapsable={false} accessible accessibilityLabel={tr("M-MB-02.slip", { serial })}>
          <SlipPaper
            slip={active}
            owner={owner}
            width={cardW}
            focusNet
            testID={`M-MB-01.zoom.${active.serial}`}
          />
        </View>
      </Animated.View>
      {tiled ? (
        <Animated.View
          entering={instant ? undefined : FadeIn.duration(ms("print"))}
          style={[
            styles.tray,
            {
              top: top + cardH + space.s8,
              left: (W - cardW) / 2 - space.s12,
              width: cardW + space.s24,
              backgroundColor: t.color.ground,
            },
          ]}
        >
          <Txt kind="body" color="ink2">
            {tr("M-MB-02.written", { date: f.date })}
          </Txt>
          <SlipTiles
            slips={dto.slips}
            owner={owner}
            testPrefix="M-MB-01.zoom.tile"
            current={active.serial}
            lit={player.state.lit}
          />
          <Txt kind="amountM" accessibilityLiveRegion="polite" testID="M-MB-01.zoom.total">
            {tr("M-MB-01.slipsTotal", { kg: total.kg })}
          </Txt>
          {!active.cropUrl ? (
            <Txt kind="caption" color="ink2">
              {tr("M-MB-02.photoPending")}
            </Txt>
          ) : null}
          <View style={styles.actions}>
            {canPlay(sources) ? (
              <Button
                variant="tonal"
                icon={player.state.status === "playing" ? "pause" : "listen"}
                label={player.state.status === "playing" ? tr("M-MB-03.pause") : tr("M-MB-02.zoomListen")}
                onPress={() => (player.state.status === "playing" ? player.pause() : player.play(0))}
                testID="M-MB-01.zoom.listen"
              />
            ) : null}
            <Button
              variant="text"
              icon="back"
              label={tr("M-MB-02.close")}
              onPress={close}
              testID="M-MB-01.zoom.back"
            />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: "absolute" },
  // The table the slips are laid on: solid, so the dimmed statement never shows through the words.
  tray: { position: "absolute", gap: space.s12, padding: space.s12 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: space.s8, alignItems: "center" },
});
