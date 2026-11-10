/**
 * The states every screen needs and no screen should invent: offline (with the time of the last copy), empty
 * (an invitation to act, never a mood), and loading (a static skeleton: no shimmer, because there are no ambient
 * loops, design §3 rule 5).
 */
import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { format } from "../_shims/domain";
import { radius, space } from "../_shims/tokens.native";
import { useApp } from "../state/app";
import { useFs } from "../theme/theme";
import { Glyph, type GlyphName } from "./glyph";
import { Banner } from "./primitives";
import { Txt, useT } from "./text";

/**
 * "Walay signal" with the time of the copy on screen ("Katapusang kopya, 10:21"). Shown while the phone is offline;
 * pass `visible` to force it (a cached statement that failed to refresh while online, say).
 */
export function OfflineBar({
  lastCopyAt,
  visible,
  testID = "offline",
}: {
  lastCopyAt?: string | null;
  visible?: boolean;
  testID?: string;
}) {
  const { online } = useApp();
  const t = useT();
  if (!(visible ?? !online)) return null;
  return (
    <Banner icon="wifiOff" testID={testID}>
      <Txt kind="bodyStrong">{t("common.offline")}</Txt>
      {lastCopyAt ? (
        <Txt kind="body" color="ink2">
          {t("common.lastCopy", { time: format.time(lastCopyAt) })}
        </Txt>
      ) : null}
    </Banner>
  );
}

/** Nothing here yet, and what to do about it. */
export function EmptyState({
  glyph = "info",
  title,
  body,
  action,
  testID,
}: {
  glyph?: GlyphName;
  title: string;
  body?: string;
  action?: ReactNode;
  testID?: string;
}) {
  const { t } = useFs();
  return (
    <View testID={testID} style={[styles.empty, { borderColor: t.color.rule }]}>
      <Glyph name={glyph} size={32} color={t.color.ink2} />
      <Txt kind="title2" accessibilityRole="header">
        {title}
      </Txt>
      {body ? (
        <Txt kind="body" color="ink2">
          {body}
        </Txt>
      ) : null}
      {action}
    </View>
  );
}

/** Static placeholder blocks in the shape of what is loading; announced once as "Loading". */
export function Skeleton({
  lines = 3,
  block = 0,
  style,
}: {
  lines?: number;
  block?: number;
  style?: ViewStyle;
}) {
  const { t } = useFs();
  const tr = useT();
  return (
    <View
      accessible
      accessibilityLabel={tr("common.loading")}
      accessibilityRole="progressbar"
      style={[styles.skeleton, style]}
    >
      {block > 0 ? <View style={[styles.block, { height: block, backgroundColor: t.color.plate2 }]} /> : null}
      {Array.from({ length: lines }, (_, i) => (
        <View
          key={i}
          style={[styles.line, { width: i === lines - 1 ? "60%" : "100%", backgroundColor: t.color.plate2 }]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    alignItems: "flex-start",
    gap: space.s12,
    padding: space.s24,
    // A solid hairline (round 3: dashed lines mean simulated only).
    borderWidth: 1,
    borderRadius: radius.card,
  },
  skeleton: { gap: space.s12 },
  block: { borderRadius: radius.none },
  line: { height: 14, borderRadius: radius.plate },
});
