/**
 * The board's own pieces (BOARD slice): the hash in rows of four to compare by eye, a resolved hold that opens to
 * show who decided it (and tells the console the Chair is reading it), the payouts with a total that ties back to
 * the amount, the labelled "Simulated push" that stands in for FCM in judge frames, the honest push status on a
 * phone, and the amount that turns from pencil to ink when both keys are in.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { CosignHold, CosignRequestDTO } from "../../_shims/api-client";
import type { AmountState } from "../../_shims/contracts";
import { format } from "../../_shims/domain";
import type { MessageArgs } from "../../_shims/i18n";
import { people } from "../../_shims/seed";
import { radius, space, target } from "../../_shims/tokens.native";
import { openPushSettings } from "../../platform/push";
import { useApp } from "../../state/app";
import { usePushStatus } from "../../state/use-push";
import { useFs } from "../../theme/theme";
import { AmountDisplay } from "../../ui/amount";
import { Glyph } from "../../ui/glyph";
import { ms, reducedFade, spring, tween } from "../../ui/motion";
import { Button, InkStamp, Rule } from "../../ui/primitives";
import { SealView } from "../../ui/seal-view";
import { Txt } from "../../ui/text";
import { compactLayout, hashRows, memberOf } from "./cosign-model";
import type { BoardKey } from "./messages";
import { useT } from "./use-t";

/* ------------------------------------------------------------------ large text */

/** The board's reflow rule (`compactLayout`) for this window. */
export function useCompact(): boolean {
  const { width, height, fontScale } = useWindowDimensions();
  return compactLayout(width, height, fontScale);
}

/* ------------------------------------------------------------------ English under the Chair's words */

/**
 * The stage's gloss (IC-12 `fs.prefs.gloss`): judges driving the Chair frame read English under each Cebuano or
 * Filipino line, so they can see what they sign. Off on phones and when the app is already in English.
 */
export function useGloss(): (key: BoardKey, args?: MessageArgs) => string | null {
  const { gloss, lang } = useApp();
  const en = useT("en");
  return useCallback((key, args) => (gloss && lang !== "en" ? en(key, args) : null), [gloss, lang, en]);
}

export function Gloss({
  text,
  align,
  testID,
}: {
  text: string | null;
  align?: "left" | "center";
  testID?: string;
}) {
  if (!text) return null;
  return (
    <Txt kind="caption" color="ink3" align={align} lang="en" testID={testID}>
      {text}
    </Txt>
  );
}

/* ------------------------------------------------------------------ the hash, to compare by eye */

export function HashRows({
  hex,
  testID,
  kind = "figure",
}: {
  hex: string;
  testID?: string;
  kind?: "figure" | "hash";
}) {
  const tr = useT();
  const rows = useMemo(() => hashRows(hex).map((text, i) => ({ id: `row${i}`, text })), [hex]);
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={tr("seal.hash", { hash: format.hash(hex) })}
      testID={testID}
      dataSet={{ hash: hex }}
      style={styles.hashRows}
    >
      {rows.map((r) => (
        <Txt key={r.id} kind={kind} color="ink2" align="center" style={styles.hashRow} selectable>
          {r.text}
        </Txt>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------ a resolved hold */

/** The treasurer's first name for her initials (the request carries initials only). */
export function resolverName(initials: string): string {
  return initials === people.treasurer.initials ? people.treasurer.first : initials;
}

export function HoldRow({
  hold,
  expanded,
  onToggle,
}: {
  hold: CosignHold;
  expanded: boolean;
  onToggle(): void;
}) {
  const { t } = useFs();
  const tr = useT();
  const gloss = useGloss();
  const kind = tr(`hold.${hold.kind}` as BoardKey);
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={tr("M-BD-01.holdA11y", { id: hold.id, kind, summary: hold.summary })}
      testID={`M-BD-01.hold.${hold.id}`}
      dataSet={{ state: expanded ? "open" : "closed" }}
      style={({ pressed }) => [styles.hold, pressed && { backgroundColor: t.color.pencilWash }]}
    >
      <View style={styles.holdStamp}>
        <InkStamp initials={hold.resolvedBy} label={resolverName(hold.resolvedBy)} />
      </View>
      <View style={styles.holdText}>
        <View style={styles.holdHead}>
          <Txt kind="figure" color="ink3">
            {hold.id}
          </Txt>
          <Txt kind="bodyStrong" style={styles.flex}>
            {kind}
          </Txt>
        </View>
        <Gloss text={gloss(`hold.${hold.kind}` as BoardKey)} />
        <Txt kind="body" color="ink2" numberOfLines={expanded ? undefined : 2}>
          {hold.summary}
        </Txt>
        {expanded ? (
          <Txt kind="caption" color="ink3">
            {tr("M-BD-01.holdBy", {
              name: resolverName(hold.resolvedBy),
              time: format.time(hold.resolvedAt),
            })}
          </Txt>
        ) : null}
      </View>
      <Glyph name={expanded ? "chevronDown" : "chevron"} size={20} color={t.color.ink3} />
    </Pressable>
  );
}

/* ------------------------------------------------------------------ the payouts */

export function PayoutRows({
  items,
  totalCents,
  state,
}: {
  items: CosignRequestDTO["items"];
  totalCents: number;
  state: AmountState;
}) {
  const tr = useT();
  return (
    <View style={styles.items} testID="M-BD-01.items">
      {items.map((i) => (
        <View key={i.senderItemId} style={styles.itemRow}>
          <Txt
            kind="figure"
            style={styles.flex}
            importantForAccessibility="no"
            accessibilityElementsHidden
            aria-hidden
          >
            {memberOf(i)}
          </Txt>
          <AmountDisplay
            size="figure"
            text={format.usd(i.amountCents)}
            srLabel={`${memberOf(i)}, ${format.amountSpoken(i.amountCents)}`}
            state={state}
            testID={`M-BD-01.item.${memberOf(i)}`}
          />
        </View>
      ))}
      <Rule />
      <View style={styles.itemRow}>
        <Txt
          kind="bodyStrong"
          style={styles.flex}
          importantForAccessibility="no"
          accessibilityElementsHidden
          aria-hidden
        >
          {tr("M-BD-01.total")}
        </Txt>
        <AmountDisplay
          size="figure"
          text={format.usd(totalCents)}
          srLabel={`${tr("M-BD-01.total")}, ${format.amountSpoken(totalCents)}`}
          state={state}
          testID="M-BD-01.total"
        />
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ pencil to ink */

/**
 * The hero amount in pencil until both keys are in, then ink (MM-5 `inked`): the ink layer fades in over the pencil
 * one (200 ms, or the 150 ms reduced change); a cold load that is already signed shows ink at once.
 */
export function SignedAmount({
  text,
  srLabel,
  ink,
  live,
  testID,
  align = "left",
}: {
  text: string;
  srLabel: string;
  ink: boolean;
  /** True when the change happens on screen; false draws the end state still. */
  live: boolean;
  testID: string;
  align?: "left" | "center";
}) {
  const { motion } = useFs();
  const opacity = useSharedValue(ink ? 1 : 0);
  // The figure never wraps or clips: in a column narrower than the amount (200% zoom, a 2× font on a small
  // phone) it scales down to fit, and gives back the height it no longer needs.
  const [avail, setAvail] = useState(0);
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const scale = avail > 0 && natural.w > avail ? avail / natural.w : 1;
  useEffect(() => {
    if (!ink) {
      opacity.set(0);
      return;
    }
    opacity.set(live ? withTiming(1, motion.reduced ? reducedFade() : tween("crossfade")) : 1);
  }, [ink, live, motion.reduced, opacity]);
  const inkStyle = useAnimatedStyle(() => ({ opacity: opacity.get() }));
  return (
    <View
      testID={testID}
      dataSet={{ amountState: ink ? "ink" : "pencil" }}
      onLayout={(e) => setAvail(e.nativeEvent.layout.width)}
      style={[styles.fit, { alignItems: align === "center" ? "center" : "flex-start" }]}
    >
      <View
        onLayout={(e) => setNatural({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={[
          align === "center" ? styles.originCenter : styles.originLeft,
          scale < 1 ? { transform: [{ scale }], marginBottom: -natural.h * (1 - scale) } : null,
        ]}
      >
        <AmountDisplay text={text} srLabel={srLabel} state="pencil" />
        <Animated.View
          style={[StyleSheet.absoluteFill, inkStyle]}
          pointerEvents="none"
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <AmountDisplay text={text} srLabel={srLabel} state="ink" />
        </Animated.View>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ push: simulated in frames, honest on phones */

/**
 * The phone frames' stand-in for the co-sign push (S1.9 M-BD-01; plan P1): the notification the Chair would get,
 * labelled "Simulated push" (I8). It drops in once when the request opens; under reduced motion it fades.
 */
export function SimulatedPush({ dto }: { dto: CosignRequestDTO }) {
  const { t, motion } = useFs();
  const tr = useT();
  const y = useSharedValue(motion.reduced ? 0 : -space.s24);
  const fade = useSharedValue(0);
  useEffect(() => {
    if (motion.reduced) {
      fade.set(withTiming(1, reducedFade()));
      return;
    }
    y.set(withSpring(0, spring("settle")));
    fade.set(withTiming(1, tween("drawerIn")));
  }, [motion.reduced, y, fade]);
  const style = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ translateY: y.get() }] }));
  const title = tr("M-BD-01.push.title", {
    season: dto.seasonCode,
    n: dto.itemCount,
    amount: format.usd(dto.totalCents),
  });
  return (
    <Animated.View
      testID="M-BD-01.push"
      accessible
      accessibilityRole="text"
      accessibilityLabel={`${tr("M-BD-01.push.label")}. ${title}`}
      style={[styles.push, { backgroundColor: t.color.plate, borderColor: t.color.rule }, style]}
    >
      <View style={styles.pushHead}>
        <SealView
          batchSha256={dto.batchSha256}
          size={24}
          keys={dto.treasurerSigned ? 1 : 0}
          engrave={false}
        />
        <Txt kind="label">{tr("M-BD-01.push.app")}</Txt>
        <Txt kind="caption" color="ink3" style={styles.flex}>
          {tr("M-BD-01.push.now")}
        </Txt>
        <View style={[styles.pushLabel, { borderColor: t.color.rule, backgroundColor: t.color.plate2 }]}>
          <Glyph name="info" size={12} color={t.color.ink2} />
          <Txt kind="caption" color="ink2">
            {tr("M-BD-01.push.label")}
          </Txt>
        </View>
      </View>
      <Txt kind="bodyStrong">{title}</Txt>
    </Animated.View>
  );
}

/** On a phone, what push can and cannot do yet, in words (I8): never silent about a missing notification. */
export function PushNote() {
  const { t } = useFs();
  const tr = useT();
  const push = usePushStatus();
  if (Platform.OS === "web" || !push || push.status === "registered" || push.status === "unsupported") {
    return null;
  }
  const denied = push.status === "denied";
  return (
    <View
      testID="M-BD-01.push-status"
      dataSet={{ state: push.status }}
      style={[styles.note, { borderColor: t.color.rule }]}
    >
      <Glyph name="info" size={18} color={t.color.ink2} />
      <View style={styles.noteText}>
        <Txt kind="body" color="ink2">
          {tr(denied ? "M-BD-01.push.denied" : "M-BD-01.push.unconfigured")}
        </Txt>
        {denied ? (
          <Button
            variant="text"
            label={tr("M-BD-01.push.openSettings")}
            onPress={openPushSettings}
            style={styles.noteAction}
            testID="M-BD-01.push-settings"
          />
        ) : null}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ small pieces */

/** "Naa si Analyn sa approval screen.": a still ink dot, never a pulse (no ambient loops). */
export function PresenceLine({ name }: { name: string }) {
  const { t } = useFs();
  const tr = useT();
  const gloss = useGloss();
  return (
    <Animated.View
      entering={FadeIn.duration(ms("crossfade"))}
      style={styles.presence}
      testID="M-BD-01.presence"
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.dot, { backgroundColor: t.color.ink }]} />
      <View style={styles.flexShrink}>
        <Txt kind="body" color="ink2">
          {tr("M-BD-01.presence", { name })}
        </Txt>
        <Gloss text={gloss("M-BD-01.presence", { name })} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  fit: { alignSelf: "stretch" },
  originLeft: { transformOrigin: "left top" },
  originCenter: { transformOrigin: "center top" },
  hashRows: { alignItems: "center", gap: space.s2 },
  hashRow: { letterSpacing: 0.6 },
  hold: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s12,
    minHeight: target.min,
    paddingVertical: space.s8,
    marginHorizontal: -space.s8,
    paddingHorizontal: space.s8,
  },
  holdStamp: { paddingTop: space.s2 },
  holdText: { flex: 1, gap: space.s2 },
  holdHead: { flexDirection: "row", alignItems: "baseline", gap: space.s8, flexWrap: "wrap" },
  items: { gap: space.s4 },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    minHeight: 28,
    columnGap: space.s12,
  },
  push: {
    gap: space.s8,
    padding: space.s16,
    borderWidth: 1,
    // A system container keeps the system's own radius (design §2.4); the notification is the phone's, not ours.
    borderRadius: 20,
  },
  pushHead: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space.s8 },
  pushLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s4,
    paddingHorizontal: space.s8,
    paddingVertical: 2,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
  note: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space.s12,
    padding: space.s12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.plate,
  },
  noteText: { flex: 1, gap: space.s4 },
  noteAction: { alignSelf: "flex-start" },
  presence: { flexDirection: "row", alignItems: "center", gap: space.s8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
});
