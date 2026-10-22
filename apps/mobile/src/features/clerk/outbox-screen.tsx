/**
 * M-CL-02 Outbox (S1.8 M-CK-02): per capture a thumbnail, the serial once read, the member hint, the file size and a
 * progress ring. States: queued, uploading, uploaded, read ("4 ka linya nabasa"), failed ("Mosulay pag-usab sa
 * 40 s", with "Ipadala karon").
 */
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { FlatList, StyleSheet, View } from "react-native";
import { format } from "../../_shims/domain";
import { radius, space } from "../../_shims/tokens.native";
import { type CaptureRecord, MANUAL_ONLY } from "../../lib/outbox";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { TopBar } from "../../ui/chrome";
import { Banner, Button, DemoLabel, Rule } from "../../ui/primitives";
import { Txt, useT } from "../../ui/text";
import { ProgressRing } from "./parts";

function useNow(ms: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Row({ r, now, onSendNow }: { r: CaptureRecord; now: number; onSendNow(): void }) {
  const { t } = useFs();
  const tr = useT();
  const waitS = Math.max(0, Math.ceil((r.nextAttemptAt - now) / 1000));
  const refused = r.state === "failed" && r.nextAttemptAt === MANUAL_ONLY;
  const stateText =
    r.state === "queued"
      ? tr("M-CL-02.queued")
      : r.state === "uploading"
        ? `${tr("M-CL-02.uploading")} ${Math.round(r.progress * 100)}%`
        : r.state === "uploaded"
          ? tr("M-CL-02.uploaded")
          : r.state === "read"
            ? tr("M-CL-02.read", { n: r.rowsRead ?? 0 })
            : refused
              ? tr("M-CL-02.refused")
              : tr("M-CL-02.retryIn", { s: waitS });
  return (
    <View style={styles.row} testID={`M-CL-02.row.${r.id}`} dataSet={{ state: r.state }}>
      <View>
        <Image
          source={{ uri: r.thumbUri ?? r.fileUri }}
          style={[styles.thumb, { borderColor: t.color.rule }]}
          contentFit="cover"
        />
        {r.source === "sample" ? (
          <View style={[styles.sampleTag, { backgroundColor: t.color.plate2 }]}>
            <Txt
              kind="caption"
              color="ink2"
              maxFontSizeMultiplier={1}
              style={{ fontSize: 9, lineHeight: 11 }}
            >
              {tr("M-CL-02.sample")}
            </Txt>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: space.s2 }}>
        <Txt kind="bodyStrong">
          {r.serial ? tr("M-CL-02.serial", { serial: r.serial }) : tr("M-CL-02.notRead")}
        </Txt>
        <Txt kind="caption" color="ink2">
          {[r.memberHint, format.bytes(r.bytes), format.time(new Date(r.createdAt).toISOString())]
            .filter(Boolean)
            .join(", ")}
        </Txt>
        <Txt
          kind="label"
          color={r.state === "failed" ? "canaryText" : "ink2"}
          accessibilityLiveRegion="polite"
        >
          {stateText}
        </Txt>
        {r.duplicateOf ? (
          <Txt kind="caption" color="ink3">
            {tr("M-CL-02.duplicateOf")}
          </Txt>
        ) : null}
        {r.state === "failed" ? (
          <Button
            variant="text"
            label={tr("M-CL-02.sendNow")}
            onPress={onSendNow}
            style={{ alignSelf: "flex-start" }}
            testID={`M-CL-02.send-now.${r.id}`}
          />
        ) : null}
      </View>
      <ProgressRing state={r.state} progress={r.progress} />
    </View>
  );
}

export function OutboxScreen() {
  const { outbox, online } = useApp();
  const { t } = useFs();
  const tr = useT();
  const now = useNow(1000);
  const records = outbox?.records ?? [];
  const onPhone = records.filter(
    (r) => r.state === "queued" || r.state === "failed" || r.state === "uploading",
  ).length;
  return (
    <View
      style={{ flex: 1, backgroundColor: t.color.ground }}
      testID="M-CL-02"
      dataSet={{ state: online ? "online" : "offline" }}
    >
      <TopBar title={tr("M-CL-02.title")} />
      <FlatList
        data={records}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ gap: space.s12, marginBottom: space.s12 }}>
            <DemoLabel />
            {!online ? (
              <Banner tone="decide" icon="wifiOff">
                <Txt kind="bodyStrong">{tr("M-CL-01.offline", { n: onPhone })}</Txt>
              </Banner>
            ) : null}
          </View>
        }
        ItemSeparatorComponent={Rule}
        ListEmptyComponent={
          <View style={[styles.empty, { borderColor: t.color.rule }]}>
            <Txt kind="body" color="ink2">
              {tr("M-CL-02.empty")}
            </Txt>
          </View>
        }
        renderItem={({ item }) => (
          <View style={{ backgroundColor: t.color.plate }}>
            <Row r={item} now={now} onSendNow={() => void outbox?.outbox.sendNow(item.id)} />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.s16, paddingBottom: space.s48 },
  row: { flexDirection: "row", alignItems: "center", gap: space.s12, padding: space.s12 },
  thumb: { width: 56, height: 56, borderWidth: 1, borderRadius: radius.none },
  sampleTag: { position: "absolute", bottom: 0, left: 0, right: 0, alignItems: "center" },
  empty: { padding: space.s24, borderWidth: 1, borderStyle: "dashed", borderRadius: radius.plate },
});
