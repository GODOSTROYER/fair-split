/**
 * M-CL-01 Scan (design K1, S1.9): a small top app bar with the station chip ("Purok 2 pickup", when the pairing or
 * the co-op names the station) and one floating action, "Scan resibo", in the right thumb's reach. The treasurer's
 * rescan requests come first, as banners; then the status line, today's slips as rings that close as they reach the
 * co-op; on cash day, the cash list; the last pages scanned; and, in demo and Judge Mode, the labelled sample slips.
 *
 * Field-grade: Adlaw light for daylight, 48 dp targets and a 64 dp scan slab, text to 2×, nothing that needs two
 * hands. Every page is filed on the phone first, signal or not: "Walay signal. 3 ka resibo natipigan sa telepono."
 */
import { router } from "expo-router";
import { Fragment, useState } from "react";
import { StyleSheet, View } from "react-native";
import { radius, space, target } from "../../_shims/tokens.native";
import { isSameManilaDay, MANUAL_ONLY, summarise } from "../../lib/outbox";
import { hasCameraFallback } from "../../platform/scanner";
import { HREF } from "../../services/session";
import { useApp } from "../../state/app";
import { useFs } from "../../theme/theme";
import { Screen, TopBar } from "../../ui/chrome";
import { Glyph } from "../../ui/glyph";
import { Snackbar, useSnackbar } from "../../ui/overlay";
import { Banner, Button, Chip, Rule, SectionTitle } from "../../ui/primitives";
import { Slab } from "../../ui/slab";
import { Txt } from "../../ui/text";
import { CameraCapture } from "./camera-capture";
import { CaptureRow } from "./capture-row";
import { CashPlate } from "./cash-plate";
import { useCashDay } from "./cash-provider";
import { pluralKey } from "./messages";
import { NadawatSheet } from "./nadawat-sheet";
import { useOutbox } from "./outbox-provider";
import { useRemoveCapture } from "./remove-capture";
import { RescanBanner } from "./rescan-banner";
import { useRescans } from "./rescan-provider";
import { ReviewSheet } from "./review-sheet";
import { SamplesPlate } from "./samples-plate";
import { scanScreenState } from "./screen-state";
import { useTakeOver } from "./take-over";
import { TodayTally } from "./tally";
import { useCaptureFlow } from "./use-capture";
import { useCompact } from "./use-compact";
import { useNow } from "./use-now";
import { useClerkSite } from "./use-site";
import { useT } from "./use-t";

/** Room under the content for the floating scan slab and its snackbar. */
const DOCK = target.hero + space.s32 + space.s8;

export function ScanScreen() {
  const { online, api, frame } = useApp();
  const { t } = useFs();
  const tr = useT();
  const snack = useSnackbar();
  const outbox = useOutbox();
  const cash = useCashDay();
  const site = useClerkSite();
  const rescans = useRescans();
  const remove = useRemoveCapture({ onRemoved: snack.show, testID: "M-CL-01.remove" });
  const take = useTakeOver({ onTaken: snack.show, testID: "M-CL-01.take-over" });
  const [openLine, setOpenLine] = useState<string | null>(null);
  const compact = useCompact();
  const { station } = site;
  // Judge Mode on a live fs-api accepts sample slips only (S3.9); demo mode offers them beside real capture.
  const samplesOnly = api.mode === "live" && frame.inFrame;
  const showSamples = api.mode === "demo" || frame.inFrame;
  const flow = useCaptureFlow({ station: station ?? "", samplesOnly, show: snack.show });
  const { records, me } = outbox;
  const now = useNow(
    records.some((r) => r.state === "uploading" || (r.state === "failed" && r.nextAttemptAt !== MANUAL_ONLY)),
  );
  const slips = summarise(records.filter((r) => r.kind === "slip"));
  // "N slips weren't accepted" counts slips; a refused cash receipt says so on its own row of the cash list.
  const refused = slips.refused;
  const recent = records.filter((r) => isSameManilaDay(r.createdAt, now)).slice(0, 3);
  const state = scanScreenState({ online, busy: flow.busy, event: flow.event, records });
  const entry = openLine ? (cash.entries.find((e) => e.line.lineId === openLine) ?? null) : null;
  const cashFirst = cash.open && cash.entries.some((e) => e.status === "due");
  const viewOutbox = () => router.navigate(HREF.outbox);
  const canScan = !flow.busy && outbox.status === "ready";

  const cashPlate = <CashPlate cash={cash} onOpen={(e) => setOpenLine(e.line.lineId)} />;
  // At large text or on a narrow window the station moves under the title, so the title never squeezes out.
  const stationChip = station ? (
    <View
      accessible
      accessibilityLabel={tr("M-CL-01.stationSr", { station })}
      testID="M-CL-01.station"
      style={compact ? styles.stationCompact : null}
    >
      <Chip icon="scale" label={station} />
    </View>
  ) : null;

  return (
    <View style={[styles.root, { backgroundColor: t.color.ground }]}>
      <TopBar title={tr("M-CL-01.title")} trailing={compact ? undefined : (stationChip ?? undefined)} />
      <Screen
        testID="M-CL-01"
        state={state}
        topInset={false}
        contentStyle={{ paddingBottom: space.s32 }}
        footer={
          // Round 2: the scan slab sits on its own bar in the thumb zone, so it never covers what scrolls under it.
          <View style={[styles.dock, { backgroundColor: t.color.ground, borderTopColor: t.color.rule }]}>
            <Slab
              label={
                flow.busy
                  ? tr("M-CL-01.scanning")
                  : tr(samplesOnly ? "M-CL-01.addSampleNext" : "M-CL-01.scan")
              }
              srLabel={tr(samplesOnly ? "M-CL-01.addSampleNext" : "M-CL-01.scanSr")}
              depth="d1"
              tone="chalk"
              icon={samplesOnly ? "slip" : "scan"}
              height={target.hero}
              disabled={!canScan}
              onCommit={flow.scan}
              testID="M-CL-01.scan"
            />
          </View>
        }
      >
        {compact ? stationChip : null}

        {rescans.map((q) => (
          <RescanBanner
            key={q.id}
            request={q}
            original={q.captureId ? (records.find((r) => r.id === q.captureId) ?? null) : null}
            onScan={flow.scan}
            disabled={!canScan}
          />
        ))}

        <StatusLine
          online={online}
          status={outbox.status}
          onPhone={slips.onPhone}
          total={slips.total}
          refused={refused}
          onView={viewOutbox}
          onRetry={outbox.reopen}
        />

        <TodayTally records={records} now={now} me={me} />

        {cashFirst ? cashPlate : null}

        {recent.length ? (
          <View>
            <SectionTitle>{tr("M-CL-01.recent")}</SectionTitle>
            <View style={[styles.plate, { backgroundColor: t.color.plate }]}>
              {recent.map((r, i) => (
                <Fragment key={r.id}>
                  {i > 0 ? <Rule /> : null}
                  <CaptureRow
                    r={r}
                    now={now}
                    online={online}
                    treasurer={site.treasurer}
                    paper={56}
                    me={me}
                    onSendNow={() => outbox.sendNow(r.id)}
                    onTakeOver={() => take.ask(r)}
                    onRemove={() => remove.ask(r)}
                    testID={`M-CL-01.recent.${r.id}`}
                  />
                </Fragment>
              ))}
            </View>
            <Button
              variant="text"
              icon="forward"
              label={tr("M-CL-01.seeAll")}
              onPress={viewOutbox}
              style={styles.seeAll}
              testID="M-CL-01.see-all"
            />
          </View>
        ) : null}

        {cashFirst ? null : cashPlate}

        {showSamples ? (
          <SamplesPlate records={records} samplesOnly={samplesOnly} onAdd={(s) => void flow.addSample(s)} />
        ) : null}
      </Screen>

      <Snackbar msg={snack.msg} bottom={DOCK} />
      <ReviewSheet
        review={flow.review}
        onRescan={flow.rescan}
        onKeep={flow.keep}
        onDismiss={flow.dismissReview}
      />
      <NadawatSheet
        entry={entry}
        cash={cash}
        site={site}
        samples={showSamples}
        samplesOnly={samplesOnly}
        onClose={() => setOpenLine(null)}
      />
      {remove.dialog}
      {take.dialog}
      {hasCameraFallback ? (
        <CameraCapture
          visible={flow.camera}
          title={tr("M-CL-01.cameraTitle")}
          onClose={flow.closeCamera}
          onCaptured={(uri) => void flow.fromCamera(uri)}
          onLibrary={flow.fromLibrary}
          onDenied={flow.cameraDenied}
        />
      ) : null}
    </View>
  );
}

/**
 * Where the clerk's work stands, in one sentence. Offline is not a warning: the slips are safe, and they go out by
 * themselves (neutral, never canary). Only a slip the co-op refused asks for him (canary, a person's decision).
 */
function StatusLine({
  online,
  status,
  onPhone,
  total,
  refused,
  onView,
  onRetry,
}: {
  online: boolean;
  status: "opening" | "ready" | "error";
  onPhone: number;
  total: number;
  refused: number;
  onView(): void;
  onRetry(): void;
}) {
  const { t } = useFs();
  const tr = useT();
  if (status === "error") {
    return (
      <Banner
        tone="decide"
        icon="info"
        testID="M-CL-01.status"
        action={<Button variant="text" label={tr("common.tryAgain")} onPress={onRetry} />}
      >
        <Txt kind="bodyStrong">{tr("common.error")}</Txt>
      </Banner>
    );
  }
  if (!online) {
    return (
      <Banner icon="wifiOff" testID="M-CL-01.status">
        <Txt kind="bodyStrong">
          {onPhone ? tr(pluralKey("M-CL-01.offline", onPhone), { n: onPhone }) : tr("M-CL-01.offlineEmpty")}
        </Txt>
        {onPhone ? (
          <Txt kind="body" color="ink2">
            {tr("M-CL-01.offlineAfter")}
          </Txt>
        ) : null}
      </Banner>
    );
  }
  if (refused) {
    return (
      <Banner
        tone="decide"
        icon="info"
        testID="M-CL-01.status"
        action={<Button variant="text" label={tr("M-CL-01.view")} onPress={onView} />}
      >
        <Txt kind="bodyStrong">{tr(pluralKey("M-CL-01.refused", refused), { n: refused })}</Txt>
      </Banner>
    );
  }
  const [glyph, text] = onPhone
    ? (["outbox", tr(pluralKey("M-CL-01.waiting", onPhone), { n: onPhone })] as const)
    : total
      ? (["check", tr("M-CL-01.allSent")] as const)
      : (["scan", tr("M-CL-01.ready")] as const);
  return (
    <View testID="M-CL-01.status" style={styles.line}>
      <Glyph name={glyph} size={20} color={t.color.ink} />
      <Txt kind="bodyStrong" style={{ flex: 1 }}>
        {text}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dock: {
    alignItems: "flex-end",
    paddingHorizontal: space.s16,
    paddingVertical: space.s12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  plate: { borderRadius: radius.plate, paddingHorizontal: space.s12 },
  seeAll: { alignSelf: "flex-start", marginTop: space.s4 },
  stationCompact: { alignSelf: "flex-start", maxWidth: "100%" },
  line: { flexDirection: "row", alignItems: "center", gap: space.s8, minHeight: target.min },
});
