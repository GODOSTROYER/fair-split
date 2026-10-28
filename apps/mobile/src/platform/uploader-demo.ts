/**
 * Demo mode (no fs-api, every screen labelled "Demo data"): a stand-in that "uploads" in about a second with real
 * progress callbacks, so the rings fill and close as they would against the co-op. It never fails on its own; the
 * failure paths are tested against msw, never staged in front of a judge.
 */
import type { Uploader } from "../lib/outbox";

const STEPS = [0.18, 0.42, 0.66, 0.88, 1] as const;

export function demoUploader(opts: { stepMs?: number } = {}): Uploader {
  const stepMs = opts.stepMs ?? 220;
  return async (rec, onProgress) => {
    for (const p of STEPS) {
      await new Promise((r) => setTimeout(r, stepMs));
      onProgress(p);
    }
    return {
      kind: "ok",
      documentId: `demo-${rec.kind === "nadawat" ? "receipt" : "doc"}-${rec.id.slice(-6)}`,
      duplicateOf: null,
      rowsRead: null,
      serial: null,
    };
  };
}
