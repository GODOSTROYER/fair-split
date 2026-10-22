/**
 * Demo mode: the whole FairSplitApi in memory, for running the app without fs-api (no EXPO_PUBLIC_API_ORIGIN).
 * It behaves like the server where it matters: it verifies the Ed25519 co-signature against the registered key,
 * re-checks the batch digest and the nonce, and only ever moves item statuses forward. Every screen shows
 * "Demo data" while it is in use (I8).
 */
import { bytesToHex } from "@noble/hashes/utils.js";
import type { FairSplitApi, RunEventListener } from "../_shims/api-client";
import type { ApprovalPayload, ItemStatus, ItemUpdatedPayload, RunEvent } from "../_shims/contracts";
import { heroLine, people, runId, runSlug, season } from "../_shims/seed";
import type { PairedSession } from "../lib/pairing";
import { checkApprovalPayload, verifyApproval } from "../lib/signing";
import { buildDemoCosign, buildDemoStatement, type DemoStage } from "./demo-fixtures";

export interface DemoController {
  stage(): DemoStage;
  /** Simulates the run's next event: approve-and-send (201, PENDING), PayPal's SUCCEEDED, or an UNCLAIMED. */
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
    bearer: "demo-session",
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
  const keys = new Map<string, string>();
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
      if (slug !== runSlug) return { ok: false, code: "PAIRING_INVALID", status: 404 };
      const dto = buildDemoCosign({ now: deps.now(), treasurerSigned: true });
      return { ok: true, value: chairSigned ? { ...dto, state: "signed" } : dto };
    },
    async getApprovalPayload(slug, role) {
      const dto = buildDemoCosign({ now: deps.now(), treasurerSigned: true });
      if (slug !== runSlug) return { ok: false, code: "PAIRING_INVALID", status: 404 };
      const payload: ApprovalPayload = {
        v: 1,
        runId: dto.runId,
        seasonId: season.id,
        rateCardSha256: dto.rateCardSha256,
        batchSha256: dto.batchSha256,
        itemCount: dto.itemCount,
        totalCents: dto.totalCents,
        currency: "USD",
        role,
        approverId: role === "CHAIR" ? people.chair.approverId : "treasurer:analyn",
        nonce: bytesToHex(deps.randomBytes(12)),
        exp: new Date(deps.now().getTime() + 15 * 60_000).toISOString(),
      };
      issued.set(payload.nonce, payload);
      return { ok: true, value: payload };
    },
    async postApproval(_slug, body) {
      const pk = keys.get(body.keyId);
      if (!pk) return { ok: false, code: "UNAUTHENTICATED", status: 401 };
      const dto = buildDemoCosign({ now: deps.now(), treasurerSigned: true });
      const check = checkApprovalPayload(body.payload, { ...dto, role: body.role }, deps.now());
      if (!check.ok) {
        return {
          ok: false,
          code: check.problem === "expired" ? "APPROVAL_EXPIRED" : "DIGEST_MISMATCH",
          status: 409,
        };
      }
      if (!issued.has(body.payload.nonce) || usedNonces.has(body.payload.nonce)) {
        return { ok: false, code: "NONCE_REUSED", status: 409 };
      }
      if (!verifyApproval(body, pk)) return { ok: false, code: "DIGEST_MISMATCH", status: 409 };
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
    declineApproval: () => ok({ ok: true as const }),
    async registerDeviceKey(body) {
      keys.set(body.keyId, body.publicKey);
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
