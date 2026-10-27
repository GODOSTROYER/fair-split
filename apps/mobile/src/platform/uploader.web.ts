/**
 * Web frames and a phone's browser: uploads with XMLHttpRequest, whose upload events give the ring real progress,
 * and falls back to fetch where there is none (Node, under Vitest). The request comes from the shared protocol, so
 * it is byte-for-byte what the APK sends. An upload with no progress for 45 s is abandoned and retried later with
 * the same Idempotency-Key, so one stalled link can never block the queue behind it.
 */
import type { FairSplitApi } from "../_shims/api-client";
import {
  type HeaderLookup,
  interpretUpload,
  LOCAL_ERROR,
  originOf,
  STALL_MS,
  type UploadRequest,
  uploadRequest,
} from "../features/clerk/upload-protocol";
import type { CaptureKind, Uploader, UploadOutcome } from "../lib/outbox";
import { demoUploader } from "./uploader-demo";

export interface UploaderDeps {
  api: FairSplitApi;
  getBearer: () => string | null;
  now?: () => number;
}

export function createUploader(deps: UploaderDeps): Uploader {
  if (deps.api.mode === "demo") return demoUploader();
  const now = deps.now ?? Date.now;
  const origin = originOf(deps.api.captureUrl());
  return async (rec, onProgress) => {
    let body: Blob;
    try {
      const res = await fetch(rec.fileUri);
      if (!res.ok) return { kind: "reject", error: LOCAL_ERROR.fileMissing };
      body = await res.blob();
    } catch {
      return { kind: "reject", error: LOCAL_ERROR.fileMissing };
    }
    const req = uploadRequest(rec, origin, deps.getBearer());
    return typeof XMLHttpRequest === "function"
      ? sendXhr(req, body, rec.kind, onProgress, now)
      : sendFetch(req, body, rec.kind, onProgress, now);
  };
}

function sendXhr(
  req: UploadRequest,
  body: Blob,
  kind: CaptureKind,
  onProgress: (f: number) => void,
  now: () => number,
): Promise<UploadOutcome> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    let stall: ReturnType<typeof setTimeout> | null = null;
    const finish = (o: UploadOutcome) => {
      if (settled) return;
      settled = true;
      if (stall) clearTimeout(stall);
      resolve(o);
    };
    const arm = () => {
      if (stall) clearTimeout(stall);
      stall = setTimeout(() => {
        finish({ kind: "retry", error: LOCAL_ERROR.stalled });
        xhr.abort();
      }, STALL_MS);
    };
    xhr.open(req.method, req.url);
    for (const [k, v] of Object.entries(req.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      arm();
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      const header: HeaderLookup = (n) => xhr.getResponseHeader(n);
      finish(interpretUpload(kind, xhr.status, xhr.responseText, header, now()));
    };
    xhr.onerror = () => finish({ kind: "retry", error: LOCAL_ERROR.network });
    xhr.onabort = () => finish({ kind: "retry", error: LOCAL_ERROR.stalled });
    xhr.ontimeout = () => finish({ kind: "retry", error: LOCAL_ERROR.stalled });
    arm();
    xhr.send(body);
  });
}

async function sendFetch(
  req: UploadRequest,
  body: Blob,
  kind: CaptureKind,
  onProgress: (f: number) => void,
  now: () => number,
): Promise<UploadOutcome> {
  const ctrl = new AbortController();
  // fetch reports no upload progress, so the stall timer cannot be re-armed: allow two windows in total.
  const timer = setTimeout(() => ctrl.abort(), STALL_MS * 2);
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body, signal: ctrl.signal });
    const text = await res.text();
    onProgress(1);
    return interpretUpload(kind, res.status, text, (n) => res.headers.get(n), now());
  } catch {
    return { kind: "retry", error: ctrl.signal.aborted ? LOCAL_ERROR.stalled : LOCAL_ERROR.network };
  } finally {
    clearTimeout(timer);
  }
}
