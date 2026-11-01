/**
 * Mobile view adapter over fs-api. The board/pairing routes use the served contracts (ADR-0012).
 *
 * IC-08 as the app needs it: typed DTOs, an HTTP client for the register §4 commands, and
 * `subscribe(scope, onEvent)` over SSE with Last-Event-ID replay. Routes the register does not list
 * (statement, device keys, push tokens) follow S3 where it names them and are
 * marked `shim-defined` otherwise, for WS-API to confirm.
 */
import { createParser, type EventSourceMessage } from "eventsource-parser";
import {
  type BatchView,
  cosignView,
  digestLines,
  type LineList,
  type RunView,
} from "../features/board/fs-api-view";
import type {
  ApiErrorCode,
  AppRole,
  ApprovalPayload,
  ApprovalRole,
  BatchItem,
  DeviceKeyKind,
  HoldKind,
  ItemStatus,
  Lang,
  LineState,
  ProofLine,
  Provenance,
  RunEvent,
  StatementAudio,
  StatementAudioClip,
  StatementAudioSentence,
  StatementTemplate,
} from "./contracts";

/* ------------------------------------------------------------------ DTOs */

export type ApiResult<T> = { ok: true; value: T } | { ok: false; code: ApiErrorCode; status?: number };

export interface PairClaimRequest {
  token?: string;
  code6?: string;
  device: { platform: "android" | "ios" | "web"; appVersion: string };
}

export interface PairClaimResponse {
  /** A device bearer token (APK) or a 2-hour frame token (web). */
  kind: "device" | "frame";
  bearer: string;
  expiresAt: string;
  workspaceId: string;
  persona: string;
  role: AppRole;
  memberNo?: string;
  displayName: string;
  lang?: Lang;
  /** A clerk phone's station, when the co-op names one (kept in `PairedSession.station`). */
  station?: string;
  /** The treasurer's first name for copy like "Gihangyo ni Analyn…" (kept in `PairedSession.treasurerName`). */
  treasurerName?: string;
}

export interface StatementSlip {
  serial: string;
  netGrams: number;
  deliveredOn: string;
  /** 720 px WebP crop from the reviewed fixture (IC-11); null until WS-MEDIA lands. */
  cropUrl: string | null;
  provisional?: boolean;
}

export interface StatementHistoryEntry {
  /** Approved by both keys, sent to PayPal, confirmed, parked by PayPal, moved to cash, received at the bodega. */
  kind: "approved" | "sent" | "paid" | "unclaimed" | "cash-due" | "received" | "held";
  at: string;
  /** Initials of the people who made the decision (stamped in ink). */
  by?: readonly string[];
}

/**
 * IC-11 statement audio (ADR-0011), the contract's own types: `StatementAudio` is fs-api's answer to
 * `GET /v1/media/audio/:lineId`, one `StatementAudioSentence` {slot, variant, mentions, textSha256, clip} per
 * sentence fs-api speaks, and a `StatementAudioClip` {url, textSha256, label, slot, offsets, durationMs} is a
 * synthetic voice reading one of them. `textSha256` is fs-api's SHA-256 of its own spoken words: the phone pairs
 * fs-api's sentences with its own by slot, variant and mentions and plays a clip only under fs-api's hash for that
 * sentence; it never hashes its own words.
 */
export type { StatementAudio, StatementAudioClip, StatementAudioSentence };

export interface StatementCredit {
  /** The slip the unruled deduction was written on. */
  slip: string;
  /** Pesos written on the slip, as centavos (the multa returned). */
  writtenCentavos: number;
  cents: number;
}

export interface StatementDTO {
  lineId: string;
  runId: string;
  runSlug: string;
  provenance: Provenance;
  coop: { name: string; place: string };
  season: { code: string; id: string };
  payer: { short: string };
  member: {
    memberNo: string;
    displayName: string;
    nameByLang: Readonly<Record<Lang, string>>;
    lang: Lang;
  };
  treasurer: { first: string; name: string; initials: string };
  rail: "PAYPAL" | "CASH";
  lineState: LineState;
  item: { senderItemId: string; status: ItemStatus | null; updatedAt: string | null } | null;
  /** Her verified kilos, and the co-op's, so the statement can say what share of the pool is hers. */
  kilos: { netGrams: number; grade1Grams: number; coopVerifiedGrams: number };
  amounts: {
    premiumCents: number;
    bonusCents: number;
    deductions: readonly { ruleId: string; label: string; cents: number }[];
    credits: readonly StatementCredit[];
    netCents: number;
  };
  fx: { phpPerUsd: string };
  slips: readonly StatementSlip[];
  history: readonly StatementHistoryEntry[];
  rateCard: { id: string; sha256: string; ratifiedAt: string };
  batchSha256: string | null;
  cashDay: string | null;
  expectedDate: string | null;
  sentences: Readonly<Record<Lang, readonly StatementTemplate[]>>;
  /**
   * fs-api's per-sentence audio answer per language (IC-11, ADR-0011 §6), as served (`withServedAudio`) or, in demo
   * mode, as exported from fs-api's renderer; empty until the audio days render clips.
   */
  audio: Readonly<Partial<Record<Lang, readonly StatementAudioSentence[]>>>;
}

export interface CosignHold {
  id: string;
  kind: HoldKind;
  summary: string;
  resolvedBy: string;
  resolvedAt: string;
}

/**
 * One member line as a signature binds it (approved plan: `linesDigest` covers every member line, on and off rail):
 * Canonical local fixtures are rehashed in full; fs-api's flat line hashes are cross-checked with
 * /batch and bound by the independently recomputed lines root (ADR-0012).
 */
export type CosignLine = Pick<ProofLine, "memberNo" | "rail" | "netCents" | "lineSha256"> &
  (
    | { canonical: ProofLine["canonical"]; source?: undefined }
    | {
        /** Option B: /lines exposes stored hashes, not full canonical line preimages (ADR-0012). */
        source: "fs-api-lines";
        canonical?: undefined;
        batchLineSha256: string | null;
      }
  );

export interface CosignRequestDTO {
  rail?: "simulated" | "sandbox";
  runId: string;
  runSlug: string;
  seasonId: string;
  seasonCode: string;
  state: "request" | "override" | "expired" | "signed" | "declined";
  provenance: Provenance;
  totalCents: number;
  itemCount: number;
  currency: "USD";
  thresholdCents: number;
  reason: "batch-over-threshold" | "line-over-threshold" | "override";
  rateCardSha256: string;
  senderBatchId: string;
  batchSha256: string;
  /** Hash of every member line, PayPal and cash; the phone recomputes it from `lines`, and the payload repeats it. */
  linesDigest: string;
  items: readonly (BatchItem & { memberNo: string })[];
  /** Every member line of the run, PayPal and cash, so the phone recomputes `linesDigest` (shim-defined). */
  lines: readonly CosignLine[];
  holds: readonly CosignHold[];
  treasurerSigned: { keyId: string; at: string } | null;
  presence: { persona: string; view: string; at: string } | null;
  expiresAt: string;
}

/**
 * IC-08's {payload, jcs}, augmented locally with fresh /batch and /lines responses so the phone
 * recomputes both roots before signing. fs-api's frozen response carries no extra fields (ADR-0012).
 */
export interface ApprovalPayloadDTO {
  payload: ApprovalPayload;
  /** The payload's JCS as the server will verify it; the phone signs only when it is exactly `jcs(payload)`. */
  jcs: string;
  senderBatchId: string;
  items: readonly BatchItem[];
  lines: readonly CosignLine[];
}

export interface ApprovalSubmission {
  role: ApprovalRole;
  keyId: string;
  payload: ApprovalPayload;
  /** Ed25519 signature over the JCS bytes of `payload`, lowercase hex. */
  signature: string;
}

export interface DeviceKeyRegistration {
  keyId: string;
  publicKey: string;
  /** `app` for the Chair's phone key (`fs-ernesto-a1`), `web_demo` for a judge's browser key; never `web`. */
  kind: DeviceKeyKind;
  biometricClass: "biometric-bound" | "pin-gated" | "none";
}

export interface CaptureMeta {
  /** UUIDv7, sent as the Idempotency-Key. */
  id: string;
  sha256Hex: string;
  bytes: number;
  mime: string;
  capturedAt: string;
  station: string;
  memberHint?: string | null;
}

export interface CaptureUploadResult {
  documentId: string;
  exactDuplicateOf: string | null;
  rowsRead: number | null;
  serial: string | null;
}

export type RunEventListener = (e: RunEvent) => void;

export interface FairSplitApi {
  readonly mode: "live" | "demo";
  getOpenCosignRun?(): Promise<ApiResult<{ runSlug: string }>>;
  registerFrameKey?(body: { publicKeyHex: string; signatureHex: string }): Promise<
    ApiResult<{
      keyId: string;
      approverId: string;
      kind: "web_demo";
      label: string;
      publicKeyHex: string;
    }>
  >;
  claimPairing(req: PairClaimRequest): Promise<ApiResult<PairClaimResponse>>;
  getStatement(): Promise<ApiResult<StatementDTO>>;
  getStatementByLink(token: string): Promise<ApiResult<StatementDTO>>;
  getCosignRequest(runSlug: string): Promise<ApiResult<CosignRequestDTO>>;
  getApprovalPayload(runSlug: string, role: ApprovalRole): Promise<ApiResult<ApprovalPayloadDTO>>;
  postApproval(runSlug: string, body: ApprovalSubmission): Promise<ApiResult<{ accepted: true }>>;
  declineApproval(
    runSlug: string,
    body: { role: ApprovalRole; reason: string },
  ): Promise<ApiResult<{ runState: "IN_REVIEW" }>>;
  registerDeviceKey(body: DeviceKeyRegistration): Promise<ApiResult<{ ok: true }>>;
  /**
   * A member's re-check request. `idempotencyKey` (a UUIDv7 per composed request, reused by every retry) goes out as
   * the `Idempotency-Key` header, so a retry after a lost answer never files a second request (architecture §6.7).
   */
  postReviewRequest(
    body: {
      lineId: string;
      slip?: string;
      note?: string;
    },
    opts?: { idempotencyKey?: string },
  ): Promise<ApiResult<{ id: string }>>;
  postPresence(body: { view: string }): Promise<ApiResult<{ ok: true }>>;
  registerPushToken(body: { token: string; platform: string }): Promise<ApiResult<{ ok: true }>>;
  /** Absolute URL for native background uploads (expo-file-system `File.upload`). */
  captureUrl(): string;
  uploadCapture(meta: CaptureMeta, body: Uint8Array | Blob): Promise<ApiResult<CaptureUploadResult>>;
  subscribe(scope: string, onEvent: (e: RunEvent) => void, opts?: SubscribeOptions): () => void;
}

/* ------------------------------------------------------------------ HTTP */

export interface HttpApiOptions {
  origin: string;
  getBearer: () => string | null;
  fetch?: typeof fetch;
  /** Streaming fetch for SSE (`expo/fetch` on native). Defaults to `fetch`. */
  streamingFetch?: typeof fetch;
}

const STATUS_CODES: Readonly<Record<number, ApiErrorCode>> = {
  401: "UNAUTHENTICATED",
  429: "RATE_LIMITED",
};

async function errorCode(res: Response): Promise<ApiErrorCode> {
  try {
    const body = (await res.json()) as { code?: string; error?: { code?: string } };
    const code = body?.code ?? body?.error?.code;
    if (code) return code as ApiErrorCode;
  } catch {
    // Non-JSON error bodies fall through to the status mapping.
  }
  return STATUS_CODES[res.status] ?? "NETWORK";
}

export function createHttpApi(opts: HttpApiOptions): FairSplitApi {
  const origin = opts.origin.replace(/\/+$/, "");
  // Resolved per call, so polyfills and test interceptors installed later are honoured.
  const doFetch: typeof fetch = (input, init) => (opts.fetch ?? globalThis.fetch)(input, init);

  function headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = { Accept: "application/json", ...extra };
    const bearer = opts.getBearer();
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    return h;
  }

  async function call<T>(method: string, path: string, body?: unknown, extra?: Record<string, string>) {
    let res: Response;
    try {
      res = await doFetch(`${origin}${path}`, {
        method,
        headers: headers(body === undefined ? extra : { "Content-Type": "application/json", ...extra }),
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      return { ok: false, code: "NETWORK" } as const;
    }
    if (!res.ok) return { ok: false, code: await errorCode(res), status: res.status } as const;
    return { ok: true, value: (await res.json()) as T } as const;
  }

  return {
    mode: "live",
    async claimPairing(req) {
      const response = await call<{
        token: string;
        role: AppRole;
        persona: string;
        workspaceId: string;
        expiresAt: string;
      }>("POST", "/v1/pairing/claim", req.token ? { token: req.token } : { code6: req.code6 });
      const r: ApiResult<PairClaimResponse> = response.ok
        ? {
            ok: true,
            value: {
              ...response.value,
              bearer: response.value.token,
              kind: "device",
              persona: `${response.value.role}:${response.value.persona}`,
              displayName: response.value.persona,
            },
          }
        : response;
      if (r.ok || r.code !== "NETWORK" || r.status === undefined) return r;
      // Map bare statuses when the server sends no error code.
      if (r.status === 410) return { ok: false, code: "PAIRING_EXPIRED", status: 410 };
      if (r.status === 409) return { ok: false, code: "PAIRING_USED", status: 409 };
      if (r.status === 404 || r.status === 400)
        return { ok: false, code: "PAIRING_INVALID", status: r.status };
      return r;
    },
    getStatement: () => call<StatementDTO>("GET", "/v1/members/me/statement"), // shim-defined
    getStatementByLink: (token) =>
      call<StatementDTO>("GET", `/v1/statements/link/${encodeURIComponent(token)}`), // shim-defined
    async getOpenCosignRun() {
      const r = await call<{ runSlug: string | null }>("GET", "/v1/judge/session");
      if (!r.ok) return r;
      return r.value.runSlug
        ? { ok: true, value: { runSlug: r.value.runSlug } }
        : { ok: false, status: 404, code: "NOT_FOUND" };
    },
    registerFrameKey: (body) => call("POST", "/v1/judge/keys", body),
    async getCosignRequest(slug) {
      const path = `/v1/runs/${encodeURIComponent(slug)}`;
      const [batch, lines, run, season] = await Promise.all([
        call<BatchView>("GET", `${path}/batch`),
        call<LineList>("GET", `${path}/lines`),
        call<RunView>("GET", path),
        call<{ season: { cosignBatchCents: number; cosignLineCents: number } }>(
          "GET",
          `/v1/seasons/${encodeURIComponent(slug.split("-r")[0] ?? "")}`,
        ),
      ]);
      if (!batch.ok) return batch;
      if (!lines.ok) return lines;
      if (!run.ok) return run;
      if (!season.ok) return season;
      return { ok: true, value: cosignView(batch.value, lines.value, run.value, season.value.season) };
    },
    async getApprovalPayload(slug, role) {
      const path = `/v1/runs/${encodeURIComponent(slug)}`;
      const [approval, batch, lines] = await Promise.all([
        call<Pick<ApprovalPayloadDTO, "payload" | "jcs">>("GET", `${path}/approval-payload?role=${role}`),
        call<BatchView>("GET", `${path}/batch`),
        call<LineList>("GET", `${path}/lines`),
      ]);
      if (!approval.ok) return approval;
      if (!batch.ok) return batch;
      if (!lines.ok) return lines;
      return {
        ok: true,
        value: {
          ...approval.value,
          senderBatchId: batch.value.senderBatchId,
          items: batch.value.items,
          lines: digestLines(batch.value, lines.value),
        },
      };
    },
    async postApproval(slug, body) {
      const r = await call<unknown>("POST", `/v1/runs/${encodeURIComponent(slug)}/approvals`, body);
      return r.ok ? { ok: true, value: { accepted: true } } : r;
    },
    declineApproval: (slug, body) =>
      call<{ runState: "IN_REVIEW" }>("POST", `/v1/runs/${encodeURIComponent(slug)}/approvals/decline`, body),
    registerDeviceKey: (body) => call<{ ok: true }>("POST", "/v1/device-keys", body), // shim-defined
    postReviewRequest: (body, o) =>
      call<{ id: string }>(
        "POST",
        "/v1/review-requests",
        body,
        o?.idempotencyKey ? { "Idempotency-Key": o.idempotencyKey } : undefined,
      ),
    postPresence: (body) => call<{ ok: true }>("POST", "/v1/presence", body),
    registerPushToken: (body) => call<{ ok: true }>("POST", "/v1/push-tokens", body), // shim-defined
    captureUrl: () => `${origin}/v1/captures`,
    async uploadCapture(meta, body) {
      let res: Response;
      try {
        res = await doFetch(`${origin}/v1/captures`, {
          method: "POST",
          headers: headers({
            "Content-Type": meta.mime,
            "Idempotency-Key": meta.id,
            "Content-Digest": contentDigestHeader(meta.sha256Hex),
            "X-Capture-Meta": JSON.stringify({
              capturedAt: meta.capturedAt,
              station: meta.station,
              memberHint: meta.memberHint ?? null,
              bytes: meta.bytes,
            }),
          }),
          body: body as BodyInit,
        });
      } catch {
        return { ok: false, code: "NETWORK" };
      }
      if (!res.ok) return { ok: false, code: await errorCode(res), status: res.status };
      return { ok: true, value: (await res.json()) as CaptureUploadResult };
    },
    subscribe(scope, onEvent, sopts) {
      return subscribeSse({
        url: `${origin}${scopePath(scope)}`,
        fetch: opts.streamingFetch ?? doFetch,
        getBearer: opts.getBearer,
        onEvent,
        ...sopts,
      });
    },
  };
}

/**
 * SSE streams (S3.7): `run:<runSlug>` and `ws:<workspaceId>` for officers and the clerk, `line:<lineId>` for a member
 * (a member's credential sees only her own line), `proof:<runId>` for the public aggregate counters.
 */
export function scopePath(scope: string): string {
  const at = scope.indexOf(":");
  const kind = at > 0 ? scope.slice(0, at) : "";
  const id = at > 0 ? scope.slice(at + 1) : "";
  if (!id) throw new RangeError(`Unknown subscription scope: ${scope}`);
  const enc = encodeURIComponent(id);
  if (kind === "run") return `/v1/runs/${enc}/events`;
  if (kind === "ws") return `/v1/workspaces/${enc}/events`;
  if (kind === "line") return `/v1/lines/${enc}/events`;
  if (kind === "proof") return `/v1/proof/${enc}/events`;
  throw new RangeError(`Unknown subscription scope: ${scope}`);
}

/* ------------------------------------------------------------------ Content-Digest (RFC 9530) */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63];
    out += B64[(n >> 12) & 63];
    out += b === undefined ? "=" : B64[(n >> 6) & 63];
    out += c === undefined ? "=" : B64[n & 63];
  }
  return out;
}

/** `sha-256=:<base64>:` for a lowercase hex sha256. */
export function contentDigestHeader(sha256Hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256Hex)) throw new RangeError("sha256 must be 64 lowercase hex characters");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) bytes[i] = Number.parseInt(sha256Hex.slice(i * 2, i * 2 + 2), 16);
  return `sha-256=:${base64(bytes)}:`;
}

/* ------------------------------------------------------------------ SSE */

export interface SubscribeOptions {
  lastEventId?: string | null;
  /** Called with `true` when the stream is up and `false` while reconnecting. */
  onStatus?: (connected: boolean) => void;
  /** Backoff from 0.5 s to 8 s (S3.7). Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
}

interface SseInternal extends SubscribeOptions {
  url: string;
  fetch: typeof fetch;
  getBearer: () => string | null;
  onEvent: (e: RunEvent) => void;
}

export const SSE_BACKOFF_MS = [500, 1000, 2000, 4000, 8000] as const;

/**
 * fetch + eventsource-parser, so the bearer token rides in a header (EventSource cannot set one) and native can use
 * `expo/fetch` streaming. Reconnects with backoff and replays from Last-Event-ID.
 */
export function subscribeSse(o: SseInternal): () => void {
  let stopped = false;
  let lastId = o.lastEventId ?? null;
  let controller: AbortController | null = null;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));

  (async () => {
    let attempt = 0;
    while (!stopped) {
      controller = new AbortController();
      try {
        const h: Record<string, string> = { Accept: "text/event-stream" };
        const bearer = o.getBearer();
        if (bearer) h.Authorization = `Bearer ${bearer}`;
        if (lastId) h["Last-Event-ID"] = lastId;
        const res = await o.fetch(o.url, { headers: h, signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        attempt = 0;
        o.onStatus?.(true);
        const parser = createParser({
          onEvent(msg: EventSourceMessage) {
            if (msg.id) lastId = msg.id;
            if (!msg.data) return;
            try {
              o.onEvent(JSON.parse(msg.data) as RunEvent);
            } catch {
              // A malformed frame is skipped; the next one carries on.
            }
          },
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done || stopped) break;
          parser.feed(decoder.decode(value, { stream: true }));
        }
      } catch {
        // Dropped streams are normal (deploys, Render's request cap); replay hides them.
      }
      if (stopped) break;
      o.onStatus?.(false);
      await sleep(SSE_BACKOFF_MS[Math.min(attempt, SSE_BACKOFF_MS.length - 1)] ?? 8000);
      attempt++;
    }
  })();

  return () => {
    stopped = true;
    controller?.abort();
  };
}
