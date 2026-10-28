/**
 * The quality gate's question (M-CL-01 `quality`: "Ngitngit kaayo. I-scan pag-usab."), one flagged page at a time.
 * The page is shown as paper so the clerk judges it himself. Scanning again drops it; keeping it files it anyway
 * (the reading pipeline makes the final call). Closing the sheet keeps it: nothing he captured is lost to a tap.
 */
import { StyleSheet, useWindowDimensions, View } from "react-native";
import { space } from "../../_shims/tokens.native";
import { Sheet } from "../../ui/overlay";
import { Button } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { Paper } from "./paper";
import type { Review } from "./use-capture";
import { useT } from "./use-t";

export function ReviewSheet({
  review,
  onRescan,
  onKeep,
  onDismiss,
}: {
  review: Review | null;
  onRescan(): void;
  onKeep(): void;
  onDismiss(): void;
}) {
  const tr = useT();
  const { width } = useWindowDimensions();
  const page = review?.page;
  const w = Math.min(width - space.s48 * 2, 240);
  const h = page && page.width > 0 ? Math.round((w * page.height) / page.width) : w;
  const dark = review?.issue !== "small";
  return (
    <Sheet
      visible={review !== null}
      title={tr(dark ? "M-CL-01.qualityTitle" : "M-CL-01.qualitySmallTitle")}
      onClose={onDismiss}
      testID="M-CL-01.review"
    >
      {review && page ? (
        <View style={styles.body}>
          {review.count > 1 ? (
            <Txt kind="label" color="ink2">
              {tr("M-CL-01.qualityCount", { i: review.index, n: review.count })}
            </Txt>
          ) : null}
          <View style={styles.paper}>
            <Paper
              uri={page.thumbUri}
              width={w}
              height={Math.min(h, 320)}
              label={tr(dark ? "M-CL-01.quality" : "M-CL-01.qualitySmall")}
              testID="M-CL-01.review.page"
            />
          </View>
          <Txt kind="bodyStrong">{tr(dark ? "M-CL-01.quality" : "M-CL-01.qualitySmall")}</Txt>
          <Txt kind="body" color="ink2">
            {tr("M-CL-01.qualityBody")}
          </Txt>
          <View style={styles.actions}>
            <Button
              tall
              icon="scan"
              label={tr("M-CL-01.rescan")}
              onPress={onRescan}
              testID="M-CL-01.review.rescan"
            />
            <Button variant="text" label={tr("M-CL-01.keep")} onPress={onKeep} testID="M-CL-01.review.keep" />
          </View>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.s16, paddingBottom: space.s8 },
  paper: { alignItems: "center", paddingVertical: space.s8 },
  actions: { gap: space.s8 },
});
