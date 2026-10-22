import type { Uploader } from "../lib/outbox";

/** Demo mode: a labelled stand-in that "uploads" in about a second, with real progress callbacks. */
export function demoUploader(): Uploader {
  return async (rec, onProgress) => {
    for (const p of [0.2, 0.45, 0.7, 1]) {
      await new Promise((r) => setTimeout(r, 220));
      onProgress(p);
    }
    return {
      kind: "ok",
      documentId: `demo-doc-${rec.id.slice(-6)}`,
      duplicateOf: null,
      rowsRead: null,
      serial: null,
    };
  };
}
