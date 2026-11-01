import { describe, expect, it, vi } from "vitest";
import { createHttpApi } from "../../_shims/api-client";
import { checkApprovalPayload, checkCosignRequest, cosign } from "../../lib/signing";
import { buildDemoApproval, buildDemoCosign } from "../../services/demo-fixtures";
import { boardApiMode } from "./api-mode";
import {
  EMPTY_MEMORY,
  payloadPlan,
  rememberPayload,
  rememberRequest,
  requestStatus,
  whyKey,
} from "./cosign-model";

const now = new Date();
const dto = buildDemoCosign({ now, treasurerSigned: true });
const approval = buildDemoApproval(dto, {
  role: "chair",
  nonce: "test-phone-nonce",
  exp: new Date(now.getTime() + 30 * 60_000).toISOString(),
});

function server(tamper: false | true | "netCents" | "rail" = false) {
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const path = String(url).replace("http://localhost", "");
    let body: unknown;
    if (path === "/v1/pairing/claim") {
      expect(JSON.parse(String(init?.body))).toEqual({ code6: "123456" });
      body = {
        token: "runtime-device-token",
        role: "board",
        persona: "ernesto",
        workspaceId: "ws",
        expiresAt: dto.expiresAt,
      };
    } else if (path.endsWith("/approval-payload?role=chair"))
      body = { payload: approval.payload, jcs: approval.jcs };
    else if (path.endsWith("/batch"))
      body = {
        ...dto,
        runState: "AWAITING_BOARD",
        memberLines: dto.lines.map(({ memberNo, lineSha256 }) => ({ memberNo, lineSha256 })),
        chairReasons: ["BATCH_OVER_THRESHOLD"],
        blocking: [],
        unpayable: [],
        rail: "simulated",
      };
    else if (path.endsWith("/lines"))
      body = {
        runSlug: dto.runSlug,
        lines: dto.lines.map((l) => ({
          ...l.canonical,
          canonical: l.canonical,
          ...(l.rail === "CASH" && tamper === "netCents" ? { netCents: l.netCents + 1 } : {}),
          ...(l.rail === "CASH" && tamper === "rail" ? { rail: "PAYPAL" } : {}),
          lineSha256: tamper === true ? "f".repeat(64) : l.lineSha256,
          runId: dto.runId,
          provenance: "seeded",
        })),
      };
    else if (path.endsWith(`/runs/${dto.runSlug}`))
      body = {
        run: {
          id: dto.runId,
          seasonId: dto.seasonId,
          runSlug: dto.runSlug,
          state: "AWAITING_BOARD",
          provenance: "seeded",
        },
        approvals: [{ role: "treasurer", keyId: "key-one", signedAt: now.toISOString(), voidedAt: null }],
        rail: "simulated",
      };
    else if (path.startsWith("/v1/seasons/"))
      body = { season: { cosignBatchCents: 30000, cosignLineCents: 15000 } };
    else return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });
    return Response.json(body);
  });
  return {
    fetch,
    api: createHttpApi({
      origin: "http://localhost",
      getBearer: () => null,
      fetch: fetch as typeof globalThis.fetch,
    }),
  };
}

describe("fs-api phone adapter", () => {
  it.each(["DIGEST_MISMATCH", "APPROVAL_EXPIRED", "NONCE_REUSED"])(
    "preserves fs-api's top-level %s refusal",
    async (code) => {
      const api = createHttpApi({
        origin: "http://localhost",
        getBearer: () => null,
        fetch: async () => Response.json({ code, status: 409, message: "Refused" }, { status: 409 }),
      });
      expect(
        await api.postApproval(dto.runSlug, {
          role: "chair",
          keyId: "fs-ernesto-demo-abc123",
          payload: approval.payload,
          signature: "0".repeat(128),
        }),
      ).toMatchObject({ ok: false, code, status: 409 });
    },
  );
  it("uses the server's line trigger without treating its line threshold as a batch threshold", () => {
    expect(whyKey({ reason: "line-over-threshold", totalCents: 20000, thresholdCents: 15000 })).toBe(
      "M-BD-01.why.line",
    );
  });
  it("claims only the frozen token/code body and reads the server token", async () => {
    const { api } = server();
    const r = await api.claimPairing({ code6: "123456", device: { platform: "web", appVersion: "1" } });
    expect(r).toMatchObject({
      ok: true,
      value: { bearer: "runtime-device-token", persona: "board:ernesto", role: "board" },
    });
  });
  it("builds and checks the request and approval from batch and flat lines", async () => {
    const { api, fetch } = server();
    const r = await api.getCosignRequest(dto.runSlug);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.code);
    expect(checkCosignRequest(r.value).ok).toBe(true);
    expect(r.value).toMatchObject({ rail: "simulated" });
    const memory = rememberRequest(EMPTY_MEMORY, r.value, false);
    expect(
      requestStatus({
        ...memory,
        loading: false,
        loadError: null,
        online: true,
        now: now.getTime(),
        sentBack: false,
        chairSigned: false,
      }),
    ).toBe("loading");
    const p = await api.getApprovalPayload(dto.runSlug, "chair");
    expect(p).toMatchObject({
      ok: true,
      value: { payload: approval.payload, senderBatchId: dto.senderBatchId },
    });
    if (!p.ok || !memory.check?.ok) throw new Error("No valid signing request");
    const checked = rememberPayload(
      memory,
      memory.check.expected,
      checkApprovalPayload(p.value, memory.check.expected, now),
    );
    expect(payloadPlan(checked, now).kind).toBe("fetch");
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/cosign"))).toBe(false);
  });
  it("inv.i4.flat-lines-mismatch: altered line hashes never reach a key or submission", async () => {
    const { api } = server(true);
    const p = await api.getApprovalPayload(dto.runSlug, "chair");
    const sign = vi.fn();
    const submit = vi.fn();
    const result = await cosign(
      p.ok ? p.value : null,
      {
        runId: dto.runId,
        seasonId: dto.seasonId,
        approverId: "board:ernesto",
        rateCardSha256: dto.rateCardSha256,
        batchSha256: dto.batchSha256,
        linesDigest: dto.linesDigest,
        totalCents: dto.totalCents,
        itemCount: dto.itemCount,
        role: "chair",
      },
      { now: () => now, online: () => true, sign, submit, isRegistered: () => false, register: vi.fn() },
    );
    expect(result).toMatchObject({ ok: false, state: "mismatch" });
    expect(sign).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });
  it("keeps frames on labelled demo until a board token arrives; reset returns to demo", () => {
    expect(boardApiMode("http://localhost", true, null)).toBe("demo");
    expect(boardApiMode("http://localhost", true, { role: "board", bearer: "frame-token" })).toBe("live");
    expect(boardApiMode("http://localhost", true, { role: "clerk", bearer: "frame-token" })).toBe("live");
    expect(boardApiMode(null, true, { role: "board", bearer: "frame-token" })).toBe("demo");
    expect(boardApiMode("http://localhost", false, null)).toBe("live");
  });
  it.each(["netCents", "rail"] as const)(
    "inv.i4.cash-%s: refuses /lines display tampering with unchanged hashes",
    async (field) => {
      const { api } = server(field);
      const request = await api.getCosignRequest(dto.runSlug);
      if (!request.ok) throw new Error(request.code);
      expect(checkCosignRequest(request.value).ok).toBe(false);
      const p = await api.getApprovalPayload(dto.runSlug, "chair");
      const sign = vi.fn();
      const register = vi.fn();
      const submit = vi.fn();
      expect(
        await cosign(
          p.ok ? p.value : null,
          {
            runId: dto.runId,
            seasonId: dto.seasonId,
            approverId: "board:ernesto",
            rateCardSha256: dto.rateCardSha256,
            batchSha256: dto.batchSha256,
            linesDigest: dto.linesDigest,
            totalCents: dto.totalCents,
            itemCount: dto.itemCount,
            role: "chair",
          },
          { now: () => now, online: () => true, sign, register, submit, isRegistered: () => false },
        ),
      ).toMatchObject({ ok: false, state: "mismatch" });
      expect(sign).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
      expect(submit).not.toHaveBeenCalled();
    },
  );
});
