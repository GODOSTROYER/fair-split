/**
 * The cash receipt (plan: Jessie "attests cash with a Nadawat photo"; S1.7 W-TR-09 cash day), in three steps:
 *   1. the member signs or thumbmarks the "Nadawat" box on the printed statement (the record never says which);
 *   2. the clerk photographs the box (the co-op keeps the photo; Proof shows only its hash);
 *   3. the clerk hands over the exact pesos and presses the d2 slab "Markahi nga nadawat".
 * The amount is hollow while the cash is due and turns to solid ink under the clerk's stamp once attested (the
 * amount grammar's `attested`; never jade, which is PayPal's). The receipt files through the offline outbox, and
 * the sheet says where it is: on the phone, sending, or recorded by the co-op. Before cash day, for a line still
 * being checked, or without the photo, the slab is hatched with the reason; it is never greyed out.
 */
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";
import { format } from "../../_shims/domain";
import { people } from "../../_shims/seed";
import { radius, space, target } from "../../_shims/tokens.native";
import {
  deleteCaptureFile,
  documentScannerAvailable,
  hasCameraFallback,
  type ProcessedPage,
  processPage,
  type ScanResult,
  sampleImagePage,
  scanWithSystemScanner,
} from "../../platform/scanner";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { AmountDisplay } from "../../ui/amount";
import { Glyph, type GlyphName } from "../../ui/glyph";
import { reducedFade, spring, tween } from "../../ui/motion";
import { Sheet } from "../../ui/overlay";
import { Button, InkStamp } from "../../ui/primitives";
import { Slab } from "../../ui/slab";
import { Txt } from "../../ui/text";
import { CameraCapture } from "./camera-capture";
import type { RosterEntry } from "./cash-day";
import { LOCAL_WORD } from "./cash-plate";
import type { CashHandle } from "./cash-provider";
import { Paper } from "./paper";
import { sampleNadawat } from "./samples";
import { useCompact } from "./use-compact";
import { useT } from "./use-t";

export function NadawatSheet({
  entry,
  cash,
  initials,
  station,
  samples,
  samplesOnly,
  onClose,
  onMessage,
}: {
  entry: RosterEntry | null;
  cash: CashHandle;
  initials: string;
  station: string;
  /** Demo and Judge Mode: a drawn, labelled photo of the signed box can stand in for the camera. */
  samples: boolean;
  /** Judge Mode on a live fs-api: only the sample is accepted. */
  samplesOnly: boolean;
  onClose(): void;
  onMessage(text: string): void;
}) {
  const tr = useT();
  return (
    <Sheet visible={entry !== null} title={entry?.line.name ?? ""} onClose={onClose} testID="M-CL-01.nadawat">
      {entry && cash.day ? (
        <Receipt
          key={entry.line.lineId}
          entry={entry}
          cash={cash}
          initials={initials}
          station={station}
          samples={samples}
          samplesOnly={samplesOnly}
          onMessage={onMessage}
        />
      ) : (
        <Txt kind="body" color="ink2">
          {tr("M-CL-01.cash.loading")}
        </Txt>
      )}
    </Sheet>
  );
}

function Receipt({
  entry,
  cash,
  initials,
  station,
  samples,
  samplesOnly,
  onMessage,
}: {
  entry: RosterEntry;
  cash: CashHandle;
  initials: string;
  station: string;
  samples: boolean;
  samplesOnly: boolean;
  onMessage(text: string): void;
}) {
  const { motion } = useFs();
  const tr = useT();
  const { lang } = useApp();
  const day = cash.day;
  const [photo, setPhoto] = useState<ProcessedPage | null>(null);
  const [taking, setTaking] = useState(false);
  const [camera, setCamera] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const photoRef = useRef<ProcessedPage | null>(null);
  photoRef.current = photo;

  const received = entry.status === "received";
  const fill = useSharedValue(received ? 1 : 0);
  const stamp = useSharedValue(received ? 1 : 0);
  const wasReceived = useRef(received);
  useEffect(() => {
    if (received && !wasReceived.current) {
      // Just attested on this sheet: the hollow amount fills to ink, then the stamp lands.
      fill.set(withTiming(1, motion.reduced ? reducedFade() : tween("crossfade")));
      stamp.set(motion.reduced ? withTiming(1, reducedFade()) : withSpring(1, spring("land")));
    } else if (received) {
      fill.set(1);
      stamp.set(1);
    }
    wasReceived.current = received;
  }, [received, motion.reduced, fill, stamp]);
  const stampStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, stamp.get() * 1.5),
    transform: [{ scale: motion.reduced ? 1 : 1.35 - 0.35 * stamp.get() }],
  }));

  // A photo taken but never attested is not kept.
  useEffect(
    () => () => {
      const p = photoRef.current;
      if (p) {
        deleteCaptureFile(p.uri);
        if (p.thumbUri !== p.uri) deleteCaptureFile(p.thumbUri);
      }
    },
    [],
  );

  if (!day) return null;
  const pesos = format.cashPesos(entry.line.cents, day.phpPerUsd);
  const spoken = format.cashSpoken(entry.line.cents, day.phpPerUsd);

  const keepPhoto = (res: ScanResult) => {
    if (res.kind !== "pages" || res.pages.length === 0) {
      if (res.kind === "error") setPhotoFailed(true);
      return;
    }
    const [first, ...extra] = res.pages;
    const keep = new Set([first?.uri, first?.thumbUri]);
    // Only what is being replaced goes: the same sample picked twice shares one file with the new photo.
    const drop = (p: ProcessedPage | null) => {
      if (!p) return;
      for (const uri of new Set([p.uri, p.thumbUri])) if (!keep.has(uri)) deleteCaptureFile(uri);
    };
    for (const p of extra) drop(p);
    drop(photoRef.current);
    setPhotoFailed(false);
    setPhoto(first ?? null);
  };

  /** The box is on paper, so the document scanner crops it best; else our camera, or the browser's. */
  const take = () => {
    if (taking) return;
    if (Platform.OS !== "web" && !documentScannerAvailable()) {
      if (hasCameraFallback) setCamera(true);
      return;
    }
    void scanWithSystemScanner(() => setTaking(true))
      .then(keepPhoto)
      .finally(() => setTaking(false));
  };

  const fromCamera = async (uri: string) => {
    setCamera(false);
    setTaking(true);
    try {
      keepPhoto({ kind: "pages", pages: [await processPage(uri, "camera")] });
    } catch {
      setPhotoFailed(true);
    } finally {
      setTaking(false);
    }
  };

  /** Demo and Judge Mode: the drawn, labelled photo of this line's signed box. */
  const pickSample = async () => {
    if (taking) return;
    setTaking(true);
    try {
      keepPhoto({ kind: "pages", pages: [await sampleImagePage(sampleNadawat(entry.line, day.phpPerUsd))] });
    } catch {
      setPhotoFailed(true);
    } finally {
      setTaking(false);
    }
  };

  const commit = async () => {
    if (!photo || committing) return;
    setCommitting(true);
    try {
      const res = await cash.attest(entry, photo, initials, station);
      if (res?.outcome === "queued") {
        setPhoto(null); // the outbox owns the photo now
      } else if (res?.outcome === "already-attested") {
        onMessage(
          tr("M-CL-01.nadawat.alreadyOnPhone", {
            time: format.time(new Date(res.existing.createdAt).toISOString()),
          }),
        );
      } else {
        setPhotoFailed(true);
      }
    } finally {
      setCommitting(false);
    }
  };

  const reason =
    entry.status === "blocked"
      ? tr("M-CL-01.nadawat.held")
      : !cash.open
        ? tr("M-CL-01.cash.notYet", { date: format.dayMonth(day.cashDay, lang) })
        : !photo
          ? tr("M-CL-01.nadawat.needPhoto")
          : undefined;

  return (
    <View style={styles.body} dataSet={{ cashState: entry.status, receipt: entry.local }}>
      <Txt kind="body" color="ink2">
        {received ? entry.line.memberNo : tr("M-CL-01.nadawat.member", { member: entry.line.memberNo })}
      </Txt>

      <View style={styles.amountRow}>
        <AmountDisplay
          text={pesos}
          srLabel={spoken}
          state={received ? "attested" : "hollow"}
          size="l"
          fill={fill}
          testID="M-CL-01.nadawat.amount"
        />
        {received && entry.receivedBy ? (
          <Animated.View style={stampStyle}>
            <InkStamp
              initials={entry.receivedBy}
              label={tr("M-CL-01.nadawat.stamp", { initials: entry.receivedBy })}
            />
          </Animated.View>
        ) : null}
      </View>
      <Txt kind="caption" color="ink2">
        {tr("M-CL-01.nadawat.from", { usd: format.usd(entry.line.cents), rate: `₱${day.phpPerUsd}` })}
      </Txt>

      {received ? (
        <Done entry={entry} />
      ) : (
        <View style={styles.steps}>
          <Step n={1} glyph="thumb" done={photo !== null}>
            <Txt kind="body">{tr("M-CL-01.nadawat.step1")}</Txt>
          </Step>
          <Step n={2} glyph="camera" done={photo !== null}>
            <Txt kind="body">{tr("M-CL-01.nadawat.step2")}</Txt>
            {photo ? (
              <View style={styles.photoRow}>
                <Paper
                  uri={photo.thumbUri}
                  width={88}
                  height={Math.round((88 * photo.height) / Math.max(1, photo.width))}
                  label={tr("M-CL-01.nadawat.photoSr", { size: format.bytes(photo.bytes) })}
                  testID="M-CL-01.nadawat.preview"
                />
                {samplesOnly ? null : (
                  <Button
                    variant="text"
                    icon="camera"
                    label={tr("M-CL-01.nadawat.retake")}
                    onPress={take}
                    disabled={taking}
                    testID="M-CL-01.nadawat.retake"
                  />
                )}
              </View>
            ) : (
              <View style={styles.photoActions}>
                {samplesOnly ? null : (
                  <Button
                    variant="tonal"
                    tall
                    icon="camera"
                    label={taking ? tr("M-CL-01.scanning") : tr("M-CL-01.nadawat.photo")}
                    onPress={take}
                    disabled={taking || entry.status === "blocked"}
                    testID="M-CL-01.nadawat.photo"
                  />
                )}
                {samples ? (
                  <Button
                    variant={samplesOnly ? "tonal" : "text"}
                    tall={samplesOnly}
                    icon="slip"
                    label={tr("M-CL-01.nadawat.sample")}
                    onPress={() => void pickSample()}
                    disabled={taking || entry.status === "blocked"}
                    testID="M-CL-01.nadawat.sample"
                  />
                ) : null}
              </View>
            )}
            {photoFailed ? (
              <Txt kind="caption" color="canaryText">
                {tr("M-CL-01.nadawat.photoFailed")}
              </Txt>
            ) : null}
          </Step>
          <Step n={3} glyph="cash" done={false}>
            <Txt kind="body">{tr("M-CL-01.nadawat.step3")}</Txt>
            <Slab
              label={tr("M-CL-01.nadawat.slab")}
              srLabel={tr("M-CL-01.nadawat.slabSr", { amount: spoken, name: entry.line.name })}
              depth="d2"
              tone="chalk"
              icon="check"
              height={target.primary}
              unavailableReason={reason}
              disabled={committing}
              onCommit={commit}
              testID="M-CL-01.nadawat.slab"
            />
          </Step>
        </View>
      )}

      <Txt kind="caption" color="ink3">
        {tr("M-CL-01.nadawat.privacy")}
      </Txt>

      {hasCameraFallback ? (
        <CameraCapture
          visible={camera}
          title={tr("M-CL-01.nadawat.step2")}
          onClose={() => setCamera(false)}
          onCaptured={(uri) => void fromCamera(uri)}
          testID="M-CL-01.nadawat.camera"
        />
      ) : null}
    </View>
  );
}

/** After the receipt: when, by whom, and where the record is now. */
function Done({ entry }: { entry: RosterEntry }) {
  const { t } = useFs();
  const tr = useT();
  const where =
    entry.local === "on-phone"
      ? tr("M-CL-01.nadawat.doneOnPhone")
      : entry.local === "sending"
        ? tr(LOCAL_WORD.sending)
        : entry.local === "sent"
          ? tr("M-CL-01.nadawat.doneSent")
          : entry.local === "refused"
            ? tr("M-CL-01.nadawat.doneRefused", { treasurer: people.treasurer.first })
            : null;
  const photo = entry.receipt?.thumbUri ?? entry.receipt?.fileUri ?? null;
  return (
    <View style={[styles.done, { borderColor: t.color.rule }]} testID="M-CL-01.nadawat.done">
      <View style={{ flex: 1, gap: space.s4 }}>
        {entry.receivedAt ? (
          <Txt kind="bodyStrong">
            {tr("M-CL-01.nadawat.done", { time: format.time(new Date(entry.receivedAt).toISOString()) })}
          </Txt>
        ) : null}
        {where ? (
          <Txt
            kind="body"
            style={{ color: entry.local === "refused" ? t.color.canaryText : t.color.ink2 }}
            accessibilityLiveRegion="polite"
          >
            {where}
          </Txt>
        ) : null}
      </View>
      {photo ? <Paper uri={photo} width={64} height={84} /> : null}
    </View>
  );
}

/** One step of a real sequence: its number (a check once done), and what to do. */
function Step({
  n,
  glyph,
  done,
  children,
}: {
  n: number;
  glyph: GlyphName;
  done: boolean;
  children: ReactNode;
}) {
  const { t } = useFs();
  const tr = useT();
  const compact = useCompact();
  return (
    <View style={styles.step}>
      <View
        accessible
        accessibilityLabel={tr("M-CL-01.nadawat.stepSr", { i: n })}
        style={[
          styles.stepMark,
          { borderColor: t.color.ink, backgroundColor: done ? t.color.ink : "transparent" },
        ]}
      >
        {done ? (
          <Glyph name="check" size={16} color={t.color.plate} />
        ) : (
          <Txt kind="figureS" maxFontSizeMultiplier={1.3}>
            {String(n)}
          </Txt>
        )}
      </View>
      <View style={styles.stepBody}>
        {compact ? null : (
          <View style={styles.stepGlyph}>
            <Glyph name={glyph} size={20} color={t.color.ink2} />
          </View>
        )}
        <View style={{ flex: 1, gap: space.s12 }}>{children}</View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: space.s12, paddingBottom: space.s8 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: space.s12, flexWrap: "wrap" },
  steps: { gap: space.s16, marginTop: space.s8 },
  step: { flexDirection: "row", gap: space.s12, alignItems: "flex-start" },
  stepMark: {
    width: 28,
    height: 28,
    borderWidth: 1.5,
    borderRadius: radius.plate,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  stepBody: { flex: 1, flexDirection: "row", gap: space.s8 },
  stepGlyph: { paddingTop: 2 },
  photoRow: { flexDirection: "row", alignItems: "flex-end", gap: space.s12 },
  photoActions: { alignItems: "flex-start", gap: space.s4 },
  done: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.s12,
    padding: space.s12,
    borderWidth: 1,
    borderRadius: radius.plate,
  },
});
