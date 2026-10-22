/**
 * M-CL-01 Scan (design K1, S1.8 M-CK-01): a top app bar with the station chip, one FAB "Scan resibo". The FAB opens
 * the system document scanner; if that is unavailable, the camera with an edge guide. Every page is resized, hashed
 * and filed in the offline outbox, signal or not: "Walay signal. 3 ka resibo natipigan sa telepono."
 */
import { Image } from "expo-image";
import { router } from "expo-router";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { format } from "../../_shims/domain";
import { radius, space, target } from "../../_shims/tokens.native";
import { type CaptureRecord, summarise } from "../../lib/outbox";
import { feedback } from "../../platform/feedback";
import {
  documentScannerAvailable,
  type ProcessedPage,
  processPage,
  samplePage,
  sampleSerials,
  scanWithSystemScanner,
  supportsSamples,
} from "../../platform/scanner";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen, TopBar } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Banner, Button, Chip, SectionTitle } from "../../ui/primitives";
import { Txt } from "../../ui/text";
import { useOutbox } from "./outbox-provider";
import { CameraCapture, ProgressRing, Snackbar, useSnackbar } from "./parts";
import { useT } from "./use-t";

export function ScanScreen() {
  const { online } = useApp();
  const outbox = useOutbox();
  const { t } = useFs();
  const tr = useT();
  const snack = useSnackbar();
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const records = outbox?.records ?? [];
  const sum = summarise(records);
  const station = tr("M-CL-01.station");

  const file = async (pages: ProcessedPage[]) => {
    if (!outbox) return;
    let saved = 0;
    for (const p of pages) {
      if (p.tooDark) {
        snack.show(tr("M-CL-01.quality"), "decide");
        continue;
      }
      const r = await outbox.outbox.add({
        sha256: p.sha256,
        fileUri: p.uri,
        thumbUri: p.thumbUri,
        mime: p.mime,
        bytes: p.bytes,
        width: p.width,
        height: p.height,
        station,
        memberHint: null,
        source: p.source,
      });
      if (r.outcome === "duplicate-file") {
        const at = r.existing.uploadedAt ?? r.existing.createdAt;
        snack.show(
          tr(r.existing.uploadedAt ? "M-CL-01.duplicate" : "M-CL-01.duplicateWaiting", {
            time: format.time(new Date(at).toISOString()),
          }),
          "decide",
        );
      } else {
        saved++;
        feedback.play("slip.captured");
      }
    }
    if (saved) snack.show(tr("M-CL-01.saved", { n: saved }));
    void outbox.outbox.sync();
  };

  const scan = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (Platform.OS === "web") return;
      if (!documentScannerAvailable()) {
        snack.show(tr("M-CL-01.unavailable"), "decide");
        setCamera(true);
        return;
      }
      const r = await scanWithSystemScanner();
      if (r.kind === "pages") await file(r.pages);
      else if (r.kind === "unavailable") {
        snack.show(tr("M-CL-01.unavailable"), "decide");
        setCamera(true);
      } else if (r.kind === "error") snack.show(tr("common.error"), "decide");
    } finally {
      setBusy(false);
    }
  };

  const status = !online
    ? tr("M-CL-01.offline", { n: sum.onPhone })
    : sum.onPhone
      ? tr("M-CL-01.waiting", { n: sum.onPhone })
      : tr("M-CL-01.allSent");

  return (
    <View style={{ flex: 1, backgroundColor: t.color.ground }}>
      <TopBar
        title={tr("M-CL-01.title")}
        trailing={<Chip icon="scale" label={station} testID="M-CL-01.station" />}
      />
      <Screen
        testID="M-CL-01"
        state={online ? "ready" : "offline"}
        topInset={false}
        contentStyle={{ paddingBottom: 120 }}
      >
        <Banner
          tone={online ? "neutral" : "decide"}
          icon={online ? "outbox" : "wifiOff"}
          testID="M-CL-01.status"
        >
          <Txt kind="bodyStrong">{status}</Txt>
        </Banner>

        <View style={[styles.today, { backgroundColor: t.color.plate }]}>
          <Txt kind="label" color="ink2">
            {tr("M-CL-01.today")}
          </Txt>
          <Txt kind="amountL">{String(sum.total)}</Txt>
          <Txt kind="body" color="ink2">
            {tr("M-CL-01.count", { n: sum.total, sent: sum.sent })}
          </Txt>
        </View>

        {records.length ? (
          <View>
            <SectionTitle>{tr("M-CL-02.title")}</SectionTitle>
            <View style={[styles.recent, { backgroundColor: t.color.plate }]}>
              {records.slice(0, 3).map((r: CaptureRecord) => (
                <Pressable
                  key={r.id}
                  onPress={() => router.push("/(clerk)/outbox")}
                  accessibilityRole="button"
                  style={styles.recentRow}
                >
                  <Image
                    source={{ uri: r.thumbUri ?? r.fileUri }}
                    style={[styles.thumb, { borderColor: t.color.rule }]}
                    contentFit="cover"
                  />
                  <Txt kind="body" style={{ flex: 1 }}>
                    {r.serial ? tr("M-CL-02.serial", { serial: r.serial }) : tr("M-CL-02.notRead")}
                  </Txt>
                  <ProgressRing state={r.state} progress={r.progress} size={28} />
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {supportsSamples ? (
          <View style={[styles.samples, { borderColor: t.color.rule }]} testID="M-CL-01.samples">
            <Txt kind="title2">{tr("M-CL-01.samples")}</Txt>
            <Txt kind="body" color="ink2">
              {tr("M-CL-01.samplesHint")}
            </Txt>
            {sampleSerials.map((serial) => (
              <Button
                key={serial}
                variant="tonal"
                icon="slip"
                label={tr("M-CL-01.addSample", { serial })}
                testID={`M-CL-01.sample.${serial}`}
                onPress={() => void samplePage(serial).then((p) => file([p]))}
              />
            ))}
          </View>
        ) : null}
      </Screen>

      {Platform.OS !== "web" ? (
        <Pressable
          testID="M-CL-01.fab"
          accessibilityRole="button"
          accessibilityLabel={tr("M-CL-01.fab")}
          onPress={() => void scan()}
          disabled={busy || !outbox}
          style={({ pressed }) => [
            styles.fab,
            { backgroundColor: pressed || busy ? t.color.ink2 : t.color.ink },
          ]}
        >
          <Glyph name="scan" color={t.color.plate} />
          <Txt kind="slab" style={{ color: t.color.plate }}>
            {tr("M-CL-01.fab")}
          </Txt>
        </Pressable>
      ) : null}
      <Snackbar msg={snack.msg} bottom={Platform.OS !== "web" ? 96 : 24} />
      <CameraCapture
        visible={camera}
        onClose={() => setCamera(false)}
        title={
          <Txt kind="title2" style={{ color: "#FFFFFF" }}>
            {tr("M-CL-01.fab")}
          </Txt>
        }
        onCaptured={(uri) => {
          setCamera(false);
          void processPage(uri, "camera").then((p) => file([p]));
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  today: { padding: space.s16, gap: space.s4, borderRadius: radius.none },
  recent: { borderRadius: radius.none },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    padding: space.s12,
    minHeight: target.min + 8,
  },
  thumb: { width: 44, height: 44, borderWidth: 1, borderRadius: radius.none },
  samples: {
    gap: space.s8,
    padding: space.s16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderRadius: radius.plate,
  },
  fab: {
    position: "absolute",
    right: space.s16,
    bottom: space.s16,
    minHeight: target.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    paddingHorizontal: space.s24,
    borderRadius: radius.plate,
  },
});
