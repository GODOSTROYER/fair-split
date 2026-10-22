/**
 * Native upload with progress: expo-file-system streams the file from disk (no base64 in JS memory, which matters
 * on 2 GB phones) with the Idempotency-Key and Content-Digest headers.
 */
import { File, UploadType } from "expo-file-system";
import { contentDigestHeader, type FairSplitApi } from "../_shims/api-client";
import type { Uploader, UploadOutcome } from "../lib/outbox";
import { demoUploader } from "./uploader-demo";

export function createUploader(api: FairSplitApi, getBearer: () => string | null): Uploader {
  if (api.mode === "demo") return demoUploader();
  return async (rec, onProgress): Promise<UploadOutcome> => {
    const file = new File(rec.fileUri);
    const headers: Record<string, string> = {
      "Content-Type": rec.mime,
      "Idempotency-Key": rec.id,
      "Content-Digest": contentDigestHeader(rec.sha256),
      "X-Capture-Meta": JSON.stringify({
        capturedAt: new Date(rec.createdAt).toISOString(),
        station: rec.station,
        memberHint: rec.memberHint,
        bytes: rec.bytes,
      }),
    };
    const bearer = getBearer();
    if (bearer) headers.Authorization = `Bearer ${bearer}`;
    try {
      const res = await file.upload(api.captureUrl(), {
        httpMethod: "POST",
        uploadType: UploadType.BINARY_CONTENT,
        headers,
        onProgress: (p) => {
          if (p.totalBytes > 0) onProgress(p.bytesSent / p.totalBytes);
        },
      });
      return interpret(res.status, res.body);
    } catch (e) {
      return { kind: "retry", error: e instanceof Error ? e.message : "network" };
    }
  };
}

export function interpret(status: number, body: string): UploadOutcome {
  if (status >= 200 && status < 300) {
    try {
      const v = JSON.parse(body) as {
        documentId: string;
        exactDuplicateOf?: string | null;
        rowsRead?: number | null;
        serial?: string | null;
      };
      return {
        kind: "ok",
        documentId: v.documentId,
        duplicateOf: v.exactDuplicateOf ?? null,
        rowsRead: v.rowsRead ?? null,
        serial: v.serial ?? null,
      };
    } catch {
      return { kind: "retry", error: "bad response" };
    }
  }
  if (status === 429 || status >= 500) return { kind: "retry", error: String(status) };
  let code = String(status);
  try {
    code = (JSON.parse(body) as { error?: { code?: string } }).error?.code ?? code;
  } catch {
    // keep the status
  }
  return { kind: "reject", error: code };
}
