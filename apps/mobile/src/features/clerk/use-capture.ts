/**
 * The capture flow behind "Scan resibo" (M-CL-01): the system document scanner, the camera fallback with its edge
 * guide, photos already on the phone, and sample slips; the quality gate; filing in the outbox with its duplicate
 * check; and the screen's transient states (quality, duplicate-file, unavailable, camera-denied).
 *
 * A page is filed the moment it is safe on the phone, signal or not. Nothing the clerk captured is dropped unless
 * the clerk says so: closing the quality question keeps the page.
 */
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { format } from "../../_shims/domain";
import type { AddResult } from "../../lib/outbox";
import { feedback } from "../../platform/feedback";
import {
  deleteCaptureFile,
  documentScannerAvailable,
  hasCameraFallback,
  type ProcessedPage,
  pickFromLibrary,
  processPage,
  type ScanResult,
  samplePage,
  scanWithSystemScanner,
} from "../../platform/scanner";
import { HREF } from "../../services/session";
import type { SnackMessage } from "../../ui/overlay";
import { pluralKey } from "./messages";
import { useOutbox } from "./outbox-provider";
import { type QualityIssue, qualityIssue } from "./quality";
import { nextSampleSerial } from "./samples";
import type { ScanEvent } from "./screen-state";
import { useT } from "./use-t";

export type Snack = (text: string, tone?: "neutral" | "decide", action?: SnackMessage["action"]) => void;

export interface Review {
  page: ProcessedPage;
  issue: QualityIssue;
  /** 1-based position among the pages flagged by this scan. */
  index: number;
  count: number;
}

/** How long a transient state (a duplicate, the scanner missing) stays the screen's `data-state`. */
const EVENT_MS = 4000;

export function useCaptureFlow({
  station,
  samplesOnly,
  show,
}: {
  station: string;
  /** Judge Mode on a live fs-api: the co-op accepts sample slips only (S3.9). */
  samplesOnly: boolean;
  show: Snack;
}) {
  const { outbox, records } = useOutbox();
  const tr = useT();
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState<ScanEvent | null>(null);
  const [camera, setCamera] = useState(false);
  const [queue, setQueue] = useState<{ page: ProcessedPage; issue: QualityIssue }[]>([]);
  const [reviewTotal, setReviewTotal] = useState(0);
  const flowing = useRef(false);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordsRef = useRef(records);
  recordsRef.current = records;

  useEffect(
    () => () => {
      if (eventTimer.current) clearTimeout(eventTimer.current);
    },
    [],
  );

  const flash = useCallback((e: ScanEvent) => {
    setEvent(e);
    if (eventTimer.current) clearTimeout(eventTimer.current);
    eventTimer.current = setTimeout(() => setEvent(null), EVENT_MS);
  }, []);

  const viewOutbox = useCallback(() => router.navigate(HREF.outbox), []);

  /** Files pages the gate passed, or the clerk chose to keep. One message: a duplicate outranks "Saved". */
  const fileNow = useCallback(
    async (pages: readonly ProcessedPage[]) => {
      if (!outbox || pages.length === 0) return;
      let saved = 0;
      let failed = 0;
      let duplicate: Extract<AddResult, { outcome: "duplicate-file" | "already-attested" }> | null = null;
      for (const p of pages) {
        let r: AddResult;
        try {
          r = await outbox.add({
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
        } catch {
          // Never silent: the clerk is told this page is not saved, and scans it again.
          failed++;
          continue;
        }
        if (r.outcome === "queued") {
          saved++;
          continue;
        }
        // The same bytes again: keep the first copy, drop the one just made.
        if (r.existing.fileUri !== p.uri) {
          deleteCaptureFile(p.uri);
          if (p.thumbUri !== p.uri) deleteCaptureFile(p.thumbUri);
        }
        duplicate ??= r;
      }
      if (failed) {
        show(tr("M-CL-01.saveFailed"), "decide");
      } else if (duplicate) {
        const at = duplicate.existing.uploadedAt;
        feedback.play("duplicate.found");
        flash("duplicate-file");
        show(
          tr(at ? "M-CL-01.duplicate" : "M-CL-01.duplicateWaiting", {
            time: format.time(new Date(at ?? duplicate.existing.createdAt).toISOString()),
          }),
          "decide",
          { label: tr("M-CL-01.view"), onPress: viewOutbox },
        );
      } else if (saved) {
        show(tr(pluralKey("M-CL-01.saved", saved), { n: saved }));
      }
      if (saved) feedback.play("slip.captured");
      void outbox.sync();
    },
    [outbox, station, show, tr, flash, viewOutbox],
  );

  const file = useCallback(
    async (pages: readonly ProcessedPage[]) => {
      const good: ProcessedPage[] = [];
      const flagged: { page: ProcessedPage; issue: QualityIssue }[] = [];
      for (const p of pages) {
        const issue = qualityIssue(p);
        if (issue) flagged.push({ page: p, issue });
        else good.push(p);
      }
      await fileNow(good);
      if (flagged.length) {
        setQueue(flagged);
        setReviewTotal(flagged.length);
        flash("quality");
      }
    },
    [fileNow, flash],
  );

  const handle = useCallback(
    async (res: ScanResult) => {
      switch (res.kind) {
        case "pages":
          await file(res.pages);
          return;
        case "cancelled":
          return;
        case "unavailable":
          flash("unavailable");
          show(tr("M-CL-01.unavailable"), "decide");
          if (hasCameraFallback) setCamera(true);
          return;
        case "denied":
          flash("camera-denied");
          show(tr("M-CL-01.cameraDenied"), "decide");
          return;
        case "error":
          show(tr("M-CL-01.scannerError"), "decide");
          return;
      }
    },
    [file, flash, show, tr],
  );

  /** Pages are being prepared: the only time the flow blocks another press. */
  const working = useCallback(() => {
    flowing.current = true;
    setBusy(true);
  }, []);
  const done = useCallback(() => {
    flowing.current = false;
    setBusy(false);
  }, []);

  const addSample = useCallback(
    async (serial: string) => {
      if (flowing.current) return;
      working();
      try {
        await fileNow([await samplePage(serial)]);
      } catch {
        show(tr("M-CL-01.scannerError"), "decide");
      } finally {
        done();
      }
    },
    [fileNow, working, done, show, tr],
  );

  /**
   * "Scan resibo". Synchronous up to the scanner or the browser's picker, so the browser counts the press as the
   * person's own. On the web a picker the person dismisses may never answer (older browsers send no cancel event),
   * so the web blocks nothing until a photo is actually chosen.
   */
  const scan = useCallback(() => {
    if (flowing.current || !outbox) return;
    if (samplesOnly) {
      void addSample(nextSampleSerial(recordsRef.current));
      return;
    }
    if (Platform.OS !== "web") {
      if (!documentScannerAvailable()) {
        void handle({ kind: "unavailable" });
        return;
      }
      flowing.current = true; // the system scanner always answers, if only with a cancel
    }
    void scanWithSystemScanner(working).then(handle).finally(done);
  }, [outbox, samplesOnly, addSample, handle, working, done]);

  const fromCamera = useCallback(
    async (uri: string) => {
      setCamera(false);
      working();
      try {
        await file([await processPage(uri, "camera")]);
      } catch {
        show(tr("M-CL-01.scannerError"), "decide");
      } finally {
        done();
      }
    },
    [file, working, done, show, tr],
  );

  const fromLibrary = useCallback(() => {
    setCamera(false);
    void pickFromLibrary(working).then(handle).finally(done);
  }, [handle, working, done]);

  const review: Review | null = queue[0]
    ? {
        page: queue[0].page,
        issue: queue[0].issue,
        index: reviewTotal - queue.length + 1,
        count: reviewTotal,
      }
    : null;

  /** "Tipigi gihapon": file the flagged page anyway. */
  const keep = useCallback(() => {
    const [head, ...rest] = queue;
    if (!head) return;
    setQueue(rest);
    void fileNow([head.page]);
  }, [queue, fileNow]);

  /** "I-scan pag-usab": drop the flagged page; after the last one, the scanner opens again (same press). */
  const rescan = useCallback(() => {
    const [head, ...rest] = queue;
    if (!head) return;
    deleteCaptureFile(head.page.uri);
    if (head.page.thumbUri !== head.page.uri) deleteCaptureFile(head.page.thumbUri);
    setQueue(rest);
    if (rest.length) show(tr("M-CL-01.discarded"));
    else scan();
  }, [queue, scan, show, tr]);

  /** Closing the question keeps every page still waiting on it. */
  const dismissReview = useCallback(() => {
    const pages = queue.map((q) => q.page);
    setQueue([]);
    void fileNow(pages);
  }, [queue, fileNow]);

  const cameraDenied = useCallback(() => {
    flash("camera-denied");
  }, [flash]);

  return {
    busy,
    event,
    camera,
    closeCamera: () => setCamera(false),
    cameraDenied,
    scan,
    fromCamera,
    fromLibrary,
    addSample,
    review,
    keep,
    rescan,
    dismissReview,
  };
}
