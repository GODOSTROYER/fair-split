/**
 * Demo mode: the whole FairSplitApi in memory, for running the app without fs-api (no EXPO_PUBLIC_API_ORIGIN).
 * It behaves like the server where it matters: it registers a key only under its kind's ID shape, verifies the
 * Ed25519 co-signature against the registered key, recomputes the batch digest and the lines digest from its own
 * record (WS-CORE's functions, as `executeApproved` does) and checks the nonce, and only ever moves item statuses
 * forward. Every screen shows "Demo data" while it is in use (I8).
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import type {
  ApprovalSubmission,
  CosignRequestDTO,
  FairSplitApi,
  RunEventListener,
} from "../_shims/api-client";
import type {
  ApprovalPayload,
  ApprovalRole,
  ItemStatus,
  ItemUpdatedPayload,
  LineState,
  RunEvent,
} from "../_shims/contracts";
import { deviceKeyIdFitsKind } from "../_shims/contracts";
import { batchDigest, jcs, linesDigest } from "../_shims/domain";
import { heroLine, people, runId, runSlug } from "../_shims/seed";
import { buildDemoApproval, buildDemoCosign, buildDemoStatement, type DemoStage } from "./demo-fixtures";
import { DEMO_BEARER, type PairedSession } from "./session";

/** fs-api refuses an `exp` more than 30 minutes ahead (S3.8); one minute of clock skew is allowed. */
const MAX_EXP_AHEAD_MS = 31 * 60_000;

/**
 * The server's own check, written independently of the phone's (`lib/signing.ts`), so the demo server tests the
 * client rather than agreeing with it: the submitted payload must be byte-for-byte the one this server issued for
 * that nonce (JCS), its batch hash and lines digest must be the ones it computes from the items and member lines on
 * record (I4), and it must not have expired.
 */
function serverCheck(
  sub: ApprovalSubmission,
  issued: ApprovalPayload,
  onRecord: CosignRequestDTO,
  now: Date,
): "ok" | "mismatch" | "expired" {
  if (jcs(sub.payload) !== jcs(issued)) return "mismatch";
  if (batchDigest(onRecord, onRecord.items).batchSha256 !== sub.payload.batchSha256) return "mismatch";
  if (linesDigest(onRecord.lines) !== sub.payload.linesDigest) return "mismatch";
  const exp = Date.parse(sub.payload.exp);
  if (!(exp > now.getTime())) return "expired";
  if (exp - now.getTime() > MAX_EXP_AHEAD_MS) return "mismatch";
  return "ok";
}

/** Ed25519 over the UTF-8 bytes of the payload's JCS form, against the registered public key only. */
function signatureValid(sub: ApprovalSubmission, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sub.signature), utf8ToBytes(jcs(sub.payload)), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export interface DemoController {
  stage(): DemoStage;
  /**
   * Simulates the run's next event: approve-and-send (201, PENDING), PayPal's SUCCEEDED or UNCLAIMED, the
   * treasurer moving a parked line to cash, or the clerk recording the cash received.
   */
  advance(to: DemoStage): void;
  subscribe(cb: () => void): () => void;
}

export interface DemoApi extends FairSplitApi {
  readonly demo: DemoController;
}

export function demoSession(role: "member" | "clerk" | "board", now: Date): PairedSession {
  const persona = role === "member" ? "member:M-014" : role === "board" ? "board:ernesto" : "clerk:jessie";
  const displayName =
    role === "member" ? heroLine.displayName : role === "board" ? people.chair.name : people.clerk.name;
  return {
    kind: "frame",
    bearer: DEMO_BEARER,
    expiresAt: new Date(now.getTime() + 7 * 24 * 3600_000).toISOString(),
    workspaceId: "ws_demo_local",
    persona,
    role,
    memberNo: role === "member" ? heroLine.memberNo : null,
    displayName,
    lang: role === "member" ? heroLine.lang : null,
    pairedAt: now.toISOString(),
  };
}

export function createDemoApi(deps: { now: () => Date; randomBytes: (n: number) => Uint8Array }): DemoApi {
  let stage: DemoStage = "checking";
  let sentAt: string | null = null;
  let seq = 1000;
  const listeners = new Set<RunEventListener>();
  const watchers = new Set<() => void>();
  /**
   * The officer key registry (`device_keys`): keyId → the public key and the officer it was registered for. Like the
   * server, a signature is checked against the registered key for the payload's role and approver, never against a
   * key the request carries. Only the board phone registers keys here, so every key belongs to the Chair.
   */
  const keys = new Map<string, { publicKey: string; role: ApprovalRole; approverId: string }>();
  const usedNonces = new Set<string>();
  const issued = new Map<string, ApprovalPayload>();
  let chairSigned = false;

  const emit = (e: RunEvent) => {
    for (const l of listeners) l(e);
  };
  const itemEvent = (status: ItemStatus): RunEvent<"item.updated", ItemUpdatedPayload> => ({
    id: String(++seq),
    ws: "ws_demo_local",
    runId,
    type: "item.updated",
    at: deps.now().toISOString(),
    actor: { kind: "paypal", id: "paypal" },
    provenance: "seeded",
    payload: {
      senderItemId: heroLine.senderItemId,
      memberNo: heroLine.memberNo,
      status,
      source: "webhook",
      signature: "dev_mock",
    },
  });

  const lineEvent = (state: LineState): RunEvent<"line.state", { lineId: string; state: LineState }> => ({
    id: String(++seq),
    ws: "ws_demo_local",
    runId,
    type: "line.state",
    at: deps.now().toISOString(),
    actor: { kind: "human", id: state === "OFF_RAIL_PAID" ? "clerk:jessie" : "treasurer:analyn" },
    provenance: "seeded",
    payload: { lineId: "line_2026A_r37_M-014", state },
  });

  const demo: DemoController = {
    stage: () => stage,
    advance(to) {
      stage = to;
      if (to === "sent") {
        sentAt = deps.now().toISOString();
        emit(itemEvent("PENDING"));
      } else if (to === "paid") {
        sentAt ??= deps.now().toISOString();
        emit(itemEvent("SUCCESS"));
      } else if (to === "unclaimed") {
        sentAt ??= deps.now().toISOString();
        emit(itemEvent("UNCLAIMED"));
      } else if (to === "cash-due" || to === "cash-received") {
        // The co-op's own cancel returns the item (RETURNED is never taken from an event alone, I5); the line
        // moves to the bodega and the phone refetches its statement.
        sentAt ??= deps.now().toISOString();
        emit(lineEvent(to === "cash-due" ? "OFF_RAIL_DUE" : "OFF_RAIL_PAID"));
      } else {
        sentAt = null;
      }
      for (const w of watchers) w();
    },
    subscribe(cb) {
      watchers.add(cb);
      return () => watchers.delete(cb);
    },
  };

  const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

  return {
    mode: "demo",
    demo,
    claimPairing: async () => ({ ok: false, code: "PAIRING_INVALID", status: 404 }),
    getStatement: () =>
      ok(buildDemoStatement({ stage, now: deps.now().toISOString(), sentAt: sentAt ?? undefined })),
    getStatementByLink: () =>
      ok(buildDemoStatement({ stage, now: deps.now().toISOString(), sentAt: sentAt ?? undefined })),
    async getCosignRequest(slug) {
      if (slug !== runSlug) return { ok: false, code: "NOT_FOUND", status: 404 };
      const dto = buildDemoCosign({ now: deps.now(), treasurerSigned: true });
      return { ok: true, value: chairSigned ? { ...dto, state: "signed" } : dto };
    },
    async getApprovalPayload(slug, role) {
      if (slug !== runSlug) return { ok: false, code: "NOT_FOUND", status: 404 };
      const approval = buildDemoApproval(buildDemoCosign({ now: deps.now(), treasurerSigned: true }), {
        role,
        nonce: bytesToHex(deps.randomBytes(12)),
        exp: new Date(deps.now().getTime() + 15 * 60_000).toISOString(),
      });
      issued.set(approval.payload.nonce, approval.payload);
      return { ok: true, value: approval };
    },
    async postApproval(_slug, body) {
      // The codes and statuses are contracts' `ErrorCode` and `ERROR_HTTP_STATUS`, as fs-api answers.
      const key = keys.get(body.keyId);
      if (!key) return { ok: false, code: "KEY_NOT_REGISTERED", status: 403 };
      // A registered key signs only for its own officer: the Chair's key cannot approve as the treasurer.
      if (key.role !== body.role || key.approverId !== body.payload?.approverId) {
        return { ok: false, code: "APPROVER_MISMATCH", status: 403 };
      }
      const nonce = typeof body.payload?.nonce === "string" ? body.payload.nonce : "";
      const original = issued.get(nonce);
      if (!original || usedNonces.has(nonce)) return { ok: false, code: "NONCE_REUSED", status: 409 };
      const dto = buildDemoCosign({ now: deps.now(), treasurerSigned: true });
      const check = serverCheck(body, original, dto, deps.now());
      if (check === "expired") return { ok: false, code: "APPROVAL_EXPIRED", status: 422 };
      if (check !== "ok") return { ok: false, code: "DIGEST_MISMATCH", status: 409 };
      if (!signatureValid(body, key.publicKey)) return { ok: false, code: "SIGNATURE_INVALID", status: 422 };
      usedNonces.add(body.payload.nonce);
      chairSigned = true;
      emit({
        id: String(++seq),
        ws: "ws_demo_local",
        runId,
        type: "approval.signed",
        at: deps.now().toISOString(),
        actor: { kind: "human", id: people.chair.approverId },
        provenance: "seeded",
        payload: { role: body.role, keyId: body.keyId, approverId: body.payload.approverId },
      });
      return { ok: true, value: { accepted: true } };
    },
    declineApproval: () => ok({ runState: "IN_REVIEW" as const }),
    async registerDeviceKey(body) {
      // A key's ID has its kind's shape (contracts `deviceKeyIdFitsKind`), so a demo key never takes an app key's ID.
      if (!deviceKeyIdFitsKind(body.kind, body.keyId))
        return { ok: false, code: "VALIDATION_FAILED", status: 400 };
      // An ID verifies what it signed for good: it is never registered again with another public key.
      const held = keys.get(body.keyId);
      if (held && held.publicKey !== body.publicKey)
        return { ok: false, code: "VERSION_CONFLICT", status: 409 };
      keys.set(body.keyId, { publicKey: body.publicKey, role: "chair", approverId: people.chair.approverId });
      return { ok: true, value: { ok: true } };
    },
    postReviewRequest: () => ok({ id: `rr_demo_${++seq}` }),
    postPresence: () => ok({ ok: true as const }),
    registerPushToken: () => ok({ ok: true as const }),
    captureUrl: () => "demo://captures",
    uploadCapture: async () =>
      ok({ documentId: `demo-doc-${++seq}`, exactDuplicateOf: null, rowsRead: null, serial: null }),
    subscribe(_scope, onEvent) {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
  };
}
