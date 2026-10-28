/**
 * `data-state` for the clerk's two screens, from IC-01's lists (`SCREEN_STATES`): the test contract E2E waits on
 * ("offline capture": offline → uploading → uploaded or read). One precedence, written once:
 *
 *   M-CL-01: scanning > the last event (quality, camera-denied, unavailable, duplicate-file) > offline >
 *            uploading > failed > the newest slip's read or uploaded > ready
 *   M-CL-02: empty > offline > syncing > online
 *
 * Pure (tested in Node).
 */
import type { ScreenStateOf } from "../../_shims/contracts";
import type { CaptureRecord } from "../../lib/outbox";

/** A transient outcome of the clerk's last action, shown for a few seconds. */
export type ScanEvent = "quality" | "duplicate-file" | "camera-denied" | "unavailable";

export function scanScreenState(s: {
  online: boolean;
  /** The scanner, camera or picker is open, or pages are being prepared. */
  busy: boolean;
  event: ScanEvent | null;
  records: readonly CaptureRecord[];
}): ScreenStateOf<"M-CL-01"> {
  if (s.busy) return "scanning";
  if (s.event) return s.event;
  if (!s.online) return "offline";
  if (s.records.some((r) => r.state === "uploading")) return "uploading";
  if (s.records.some((r) => r.state === "failed")) return "failed";
  const newest = s.records.find((r) => r.kind === "slip");
  if (newest?.state === "read") return "read";
  if (newest?.state === "uploaded") return "uploaded";
  return "ready";
}

export function outboxScreenState(s: {
  online: boolean;
  records: readonly CaptureRecord[];
}): ScreenStateOf<"M-CL-02"> {
  if (s.records.length === 0) return "empty";
  if (!s.online) return "offline";
  if (s.records.some((r) => r.state === "uploading")) return "syncing";
  return "online";
}
