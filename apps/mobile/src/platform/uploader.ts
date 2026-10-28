/**
 * Android/iOS: expo-file-system streams the file from the app's documents (no base64 in JS memory, which matters on
 * 2 GB phones), with the Idempotency-Key and Content-Digest headers from the shared protocol. An upload with no
 * progress for 45 s is cancelled and retried later with the same key, so one stalled link on a purok road can
 * never block the queue behind it. A capture goes only with the bearer of the clerk who filed it (`bearerFor`), read
 * as the request is built: paired as anyone else by then, it is held, and nothing leaves.
 */
import { File, UploadType } from "expo-file-system";
import type { FairSplitApi } from "../_shims/api-client";
import {
  type BearerFor,
  headerLookup,
  heldUnlessFiler,
  interpretUpload,
  LOCAL_ERROR,
  originOf,
  STALL_MS,
  uploadRequest,
} from "../features/clerk/upload-protocol";
import type { Uploader } from "../lib/outbox";
import { demoUploader } from "./uploader-demo";

export interface UploaderDeps {
  api: FairSplitApi;
  bearerFor: BearerFor;
  now?: () => number;
}

export function createUploader(deps: UploaderDeps): Uploader {
  if (deps.api.mode === "demo") return heldUnlessFiler(demoUploader(), deps.bearerFor);
  const now = deps.now ?? Date.now;
  const origin = originOf(deps.api.captureUrl());
  return async (rec, onProgress) => {
    const file = new File(rec.fileUri);
    if (!file.exists) return { kind: "reject", error: LOCAL_ERROR.fileMissing };
    // Last, right before the request is built: only the pairing of the clerk who filed it may carry it.
    const bearer = deps.bearerFor(rec.filedBy?.persona ?? null);
    if (!bearer) return { kind: "held" };
    const req = uploadRequest(rec, origin, bearer);
    const ctrl = new AbortController();
    let stall = setTimeout(() => ctrl.abort(), STALL_MS);
    try {
      const res = await file.upload(req.url, {
        httpMethod: req.method,
        uploadType: UploadType.BINARY_CONTENT,
        headers: req.headers,
        mimeType: rec.mime,
        signal: ctrl.signal,
        onProgress: (p) => {
          clearTimeout(stall);
          stall = setTimeout(() => ctrl.abort(), STALL_MS);
          if (p.totalBytes > 0) onProgress(p.bytesSent / p.totalBytes);
        },
      });
      return interpretUpload(rec.kind, res.status, res.body, headerLookup(res.headers), now());
    } catch {
      return { kind: "retry", error: ctrl.signal.aborted ? LOCAL_ERROR.stalled : LOCAL_ERROR.network };
    } finally {
      clearTimeout(stall);
    }
  };
}
