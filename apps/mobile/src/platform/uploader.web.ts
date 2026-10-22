/** Web frames upload Judge Mode samples with fetch (no progress events; the ring jumps). */
import type { FairSplitApi } from "../_shims/api-client";
import type { Uploader } from "../lib/outbox";
import { demoUploader } from "./uploader-demo";

export function createUploader(api: FairSplitApi): Uploader {
  if (api.mode === "demo") return demoUploader();
  return async (rec, onProgress) => {
    let body: Blob;
    try {
      body = await (await fetch(rec.fileUri)).blob();
    } catch {
      return { kind: "reject", error: "sample unreadable" };
    }
    onProgress(0.1);
    const r = await api.uploadCapture(
      {
        id: rec.id,
        sha256Hex: rec.sha256,
        bytes: rec.bytes,
        mime: rec.mime,
        capturedAt: new Date(rec.createdAt).toISOString(),
        station: rec.station,
        memberHint: rec.memberHint,
      },
      body,
    );
    onProgress(1);
    if (r.ok) {
      return {
        kind: "ok",
        documentId: r.value.documentId,
        duplicateOf: r.value.exactDuplicateOf,
        rowsRead: r.value.rowsRead,
        serial: r.value.serial,
      };
    }
    if (r.code === "NETWORK" || r.code === "RATE_LIMITED" || (r.status ?? 0) >= 500)
      return { kind: "retry", error: r.code };
    return { kind: "reject", error: r.code };
  };
}
