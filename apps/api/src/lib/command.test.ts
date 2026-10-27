import { randomUUID } from "node:crypto";
import { ApiError, type HoldDTO, ProofResponse } from "@fairsplit/contracts";
import { getProof } from "@fairsplit/seed";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createTestApp, type TestApp } from "../test/index.js";
import { notImplemented, reply } from "./command.js";
import { contentDigestOf } from "./digest.js";
import { ApiProblem } from "./problem.js";
import { defineRouteFolder } from "./slice.js";

const WS = randomUUID();

function holdDto(over: Partial<HoldDTO> = {}): HoldDTO {
  return {
    id: randomUUID(),
    workspaceId: WS,
    runId: randomUUID(),
    label: "H1",
    key: "dup:0457",
    lineId: randomUUID(),
    memberNo: "M-007",
    kind: "DUPLICATE_SLIP",
    gate: "BLOCKS_APPROVAL",
    state: "RESOLVED",
    engineParams: { serial: "0457" },
    engineLine: "Slip 0457 appears twice.",
    claudeLine: null,
    evidence: [],
    resolution: { kind: "COUNT_ONCE", by: "treasurer:analyn", at: "2026-10-28T02:00:00.000Z", reason: null },
    provenance: "seeded",
    ...over,
  };
}

const resolveHold = vi.fn();
const capture = vi.fn();
const approvalPayload = vi.fn();
const proof = vi.fn();
const createJudgeSession = vi.fn();

const folders = [
  defineRouteFolder({ folder: "holds", commands: { resolveHold: (ctx) => resolveHold(ctx) } }),
  defineRouteFolder({ folder: "slips", commands: { capture: (ctx) => capture(ctx) } }),
  defineRouteFolder({
    folder: "approvals",
    commands: {
      approvalPayload: (ctx) => approvalPayload(ctx),
      submitApproval: notImplemented,
      declineApproval: notImplemented,
    },
  }),
  defineRouteFolder({
    folder: "proof",
    commands: { proof: (ctx) => proof(ctx), proofJson: notImplemented, proofExport: notImplemented },
  }),
  defineRouteFolder({
    folder: "judge",
    commands: { createJudgeSession: (ctx) => createJudgeSession(ctx), presence: notImplemented },
  }),
  defineRouteFolder({
    folder: "ops",
    commands: {},
    routes: (r) => {
      r.route(
        {
          method: "GET",
          path: "/v1/ops/outbox",
          auth: "operator",
          name: "outbox",
          response: z.strictObject({ queued: z.int() }),
        },
        () => ({ queued: 3 }),
      );
      r.route(
        {
          method: "POST",
          path: "/v1/ops/workspaces/:ws/note",
          auth: "frame_or_session",
          name: "note",
          request: z.strictObject({ text: z.string().min(1) }),
          response: z.strictObject({ ws: z.string(), text: z.string() }),
          success: [201],
        },
        (ctx) => reply(201, { ws: ctx.params.ws, text: ctx.input.text }),
      );
    },
  }),
];

let t: TestApp;
let token: string;

async function setup() {
  t = await createTestApp({ folders });
  t.credentials.registerWorkspace(WS);
  token = await t.credentials.frameToken({ workspaceId: WS, role: "treasurer", persona: "analyn" });
}

afterEach(async () => {
  vi.resetAllMocks();
  await t?.close();
});

const holdPath = (id = randomUUID()) => `/v1/holds/${id}/resolve`;

describe("command builder", () => {
  it("runs the handler with typed input, params and the credential's scope, and answers the default status", async () => {
    await setup();
    const id = randomUUID();
    resolveHold.mockImplementation(async (ctx) => {
      expect(ctx.input).toEqual({ resolution: "COUNT_ONCE" });
      expect(ctx.params).toEqual({ holdId: id });
      expect(ctx.scope.workspaceId).toBe(WS);
      expect(ctx.credential.kind).toBe("frame");
      expect(ctx.rail).toEqual({ label: "simulated", provenance: "simulated_rail" });
      expect(ctx.now().toISOString()).toBe("2026-10-28T02:00:00.000Z");
      return {
        hold: holdDto({ id }),
        resolution: "COUNT_ONCE",
        runVersion: 4,
        recomputed: true,
        needsChair: false,
      };
    });
    const r = await t.json(holdPath(id), {
      method: "POST",
      body: { resolution: "COUNT_ONCE" },
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(200);
    expect(resolveHold).toHaveBeenCalledOnce();
  });

  it("maps a thrown ApiProblem to its IC-01 body", async () => {
    await setup();
    resolveHold.mockRejectedValue(new ApiProblem("HOLD_NOT_OPEN", "H1 is already resolved."));
    const r = await t.json<ApiError>(holdPath(), {
      method: "POST",
      body: { resolution: "COUNT_ONCE" },
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(409);
    expect(ApiError.parse(r.body)).toMatchObject({
      code: "HOLD_NOT_OPEN",
      status: 409,
      message: "H1 is already resolved.",
    });
    expect(r.body.requestId).toBe(r.headers.get("x-request-id"));
  });

  it("refuses a body that breaks the response contract (contract drift fails tests)", async () => {
    await setup();
    resolveHold.mockResolvedValue({ hold: { not: "a hold" } });
    const r = await t.json<ApiError>(holdPath(), {
      method: "POST",
      body: { resolution: "COUNT_ONCE" },
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(500);
    expect(r.body.code).toBe("INTERNAL");
    expect(r.body.message).toMatch(/contract/);
  });

  it("validates path params, JSON and the request schema with located issues", async () => {
    await setup();
    const bad = await t.json<ApiError>("/v1/holds/H1/resolve", {
      method: "POST",
      body: { resolution: "COUNT_ONCE" },
      as: t.credentials.bearer(token),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.details?.issues).toEqual([expect.objectContaining({ path: "params.holdId" })]);
    const json = await t.json<ApiError>(holdPath(), {
      method: "POST",
      body: "{nope",
      as: t.credentials.bearer(token),
    });
    expect(json.status).toBe(400);
    expect(json.body.message).toMatch(/not valid JSON/);
    const schema = await t.json<ApiError>(holdPath(), {
      method: "POST",
      body: { resolution: "TWO_DELIVERIES" },
      as: t.credentials.bearer(token),
    });
    expect(schema.status).toBe(400);
    expect(schema.body.details?.issues).toEqual([expect.objectContaining({ path: "body.reason" })]);
    const type = await t.json<ApiError>(holdPath(), {
      method: "POST",
      body: "resolution=COUNT_ONCE",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      as: t.credentials.bearer(token),
    });
    expect(type.status).toBe(400);
    expect(resolveHold).not.toHaveBeenCalled();
  });

  it("checks credentials before anything else", async () => {
    await setup();
    const none = await t.json<ApiError>(holdPath(), { method: "POST", body: { resolution: "NOPE" } });
    expect(none.status).toBe(401);
    expect(none.body.code).toBe("UNAUTHENTICATED");
    const link = t.credentials.memberLink({ workspaceId: WS, lineId: randomUUID() });
    const readOnly = await t.json<ApiError>(holdPath(), {
      method: "POST",
      body: { resolution: "COUNT_ONCE" },
      as: t.credentials.bearer(link),
    });
    expect(readOnly.status).toBe(403);
    expect(readOnly.body.code).toBe("FORBIDDEN");
  });

  it("GET commands parse the query with the request schema", async () => {
    await setup();
    approvalPayload.mockImplementation(async (ctx) => {
      expect(ctx.input).toEqual({ role: "chair" });
      throw new ApiProblem("BLOCKING_HOLDS_OPEN", "H2 is still open.");
    });
    const r = await t.json<ApiError>("/v1/runs/2026A-r37/approval-payload?role=chair", {
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("BLOCKING_HOLDS_OPEN");
    const missing = await t.json<ApiError>("/v1/runs/2026A-r37/approval-payload", {
      as: t.credentials.bearer(token),
    });
    expect(missing.status).toBe(400);
    expect(missing.body.details?.issues).toEqual([expect.objectContaining({ path: "query.role" })]);
  });

  describe("captures: Content-Digest and Idempotency-Key (S3.10)", () => {
    const body = () => ({
      captureId: "0192f8a0-0000-7000-8000-000000000042",
      sha256: "a".repeat(64),
      mime: "image/jpeg",
      bytes: 123_456,
      station: "BODEGA",
      capturedAt: "2026-10-28T01:59:00.000Z",
    });
    const accepted = {
      documentId: "0192f8a0-0000-7000-8000-000000000099",
      status: "accepted",
      exactDuplicateOf: null,
    };

    it("requires both headers and refuses a body that does not match its digest", async () => {
      await setup();
      const text = JSON.stringify(body());
      const noDigest = await t.json<ApiError>("/v1/captures", {
        method: "POST",
        body: text,
        headers: { "idempotency-key": "k-1-aaaaaaaa" },
        as: t.credentials.bearer(token),
      });
      expect(noDigest.status).toBe(400);
      const wrong = await t.json<ApiError>("/v1/captures", {
        method: "POST",
        body: text,
        headers: { "idempotency-key": "k-1-aaaaaaaa", "content-digest": contentDigestOf(`${text} `) },
        as: t.credentials.bearer(token),
      });
      expect(wrong.status).toBe(422);
      expect(wrong.body.code).toBe("CONTENT_DIGEST_MISMATCH");
      const noKey = await t.json<ApiError>("/v1/captures", {
        method: "POST",
        body: text,
        headers: { "content-digest": contentDigestOf(text) },
        as: t.credentials.bearer(token),
      });
      expect(noKey.status).toBe(400);
      expect(capture).not.toHaveBeenCalled();
    });

    it("runs once per key: a retry replays the stored response, another body is refused", async () => {
      await setup();
      capture.mockImplementation(async () => reply(201, accepted));
      const text = JSON.stringify(body());
      const headers = {
        "idempotency-key": "0192f8a0-0000-7000-8000-000000000042",
        "content-digest": contentDigestOf(text),
      };
      const first = await t.json("/v1/captures", {
        method: "POST",
        body: text,
        headers,
        as: t.credentials.bearer(token),
      });
      expect(first.status).toBe(201);
      expect(first.body).toEqual(accepted);
      const again = await t.json("/v1/captures", {
        method: "POST",
        body: text,
        headers,
        as: t.credentials.bearer(token),
      });
      expect(again.status).toBe(201);
      expect(again.body).toEqual(accepted);
      expect(again.headers.get("idempotent-replayed")).toBe("true");
      expect(capture).toHaveBeenCalledOnce();
      const other = JSON.stringify({ ...body(), bytes: 1 });
      const reused = await t.json<ApiError>("/v1/captures", {
        method: "POST",
        body: other,
        headers: { ...headers, "content-digest": contentDigestOf(other) },
        as: t.credentials.bearer(token),
      });
      expect(reused.status).toBe(422);
      expect(reused.body.code).toBe("IDEMPOTENCY_KEY_REUSED");
    });

    it("the digest covers the exact bytes received, checked before the body is decoded", async () => {
      await setup();
      // 0xC3 0x28 is not UTF-8: a body mangled in transit must read as a digest mismatch (422, retry),
      // and a correctly digested but undecodable body as a validation failure (400), never a crash.
      const bytes = new Uint8Array([...new TextEncoder().encode('{"captureId":"'), 0xc3, 0x28, 0x22, 0x7d]);
      const send = (digest: string) =>
        t.request("/v1/captures", {
          method: "POST",
          body: bytes,
          headers: {
            "content-type": "application/json",
            "idempotency-key": "k-bytes-aaaaaaaa",
            "content-digest": digest,
          },
          as: t.credentials.bearer(token),
        });
      const mangled = await send(contentDigestOf(new TextDecoder().decode(bytes)));
      expect(mangled.status).toBe(422);
      expect(((await mangled.json()) as ApiError).code).toBe("CONTENT_DIGEST_MISMATCH");
      const undecodable = await send(contentDigestOf(bytes));
      expect(undecodable.status).toBe(400);
      expect(((await undecodable.json()) as ApiError).details).toMatchObject({
        issues: [{ path: "body", code: "invalid_utf8" }],
      });
      expect(capture).not.toHaveBeenCalled();
    });

    it("an undocumented success status is a server error", async () => {
      await setup();
      capture.mockResolvedValue(reply(202, accepted));
      const text = JSON.stringify(body());
      const r = await t.json<ApiError>("/v1/captures", {
        method: "POST",
        body: text,
        headers: { "idempotency-key": "k-2-aaaaaaaa", "content-digest": contentDigestOf(text) },
        as: t.credentials.bearer(token),
      });
      expect(r.status).toBe(500);
    });
  });

  it("public commands run anonymous, with a failed credential reported to the handler", async () => {
    await setup();
    proof.mockImplementation(async (ctx) => ({
      bundle: getProof(),
      provenance: "seeded",
      redacted: ctx.credential === null,
      ...(ctx.credentialProblem ? {} : {}),
    }));
    const anon = await t.json("/v1/proof/2026A-r37");
    expect(anon.status).toBe(200);
    expect(ProofResponse.parse(anon.body).redacted).toBe(true);
    expect(proof.mock.calls[0]?.[0].credentialProblem).toBeNull();
    const expiredLink = t.credentials.brandLink({ workspaceId: WS, ttlMs: 1000 });
    t.clock.advance(2000);
    const r = await t.json("/v1/proof/2026A-r37", { as: t.credentials.bearer(expiredLink) });
    expect(r.status).toBe(200);
    expect(proof.mock.calls[1]?.[0].credentialProblem?.code).toBe("FRAME_TOKEN_EXPIRED");
  });

  it("`none` commands still see a judge cookie (session resume)", async () => {
    await setup();
    createJudgeSession.mockImplementation(async (ctx) => {
      expect(ctx.credential?.kind).toBe("judge_session");
      throw new ApiProblem("QUEUED", "You're next.", { retryAfterMs: 40_000 });
    });
    const cookie = t.credentials.judgeCookie({ workspaceId: WS });
    const r = await t.json<ApiError>("/v1/judge/sessions", {
      method: "POST",
      body: {},
      as: t.credentials.judge(cookie),
    });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: "QUEUED", retryAfterMs: 40_000 });
    expect(r.headers.get("retry-after")).toBe("40");
  });

  it("slice routes get the same policy and are documented under their folder", async () => {
    await setup();
    expect((await t.json("/v1/ops/outbox")).status).toBe(401);
    expect((await t.json("/v1/ops/outbox", { as: t.credentials.bearer(token) })).status).toBe(403);
    const ok = await t.json("/v1/ops/outbox", { as: t.credentials.operator(t.credentials.operatorCookie()) });
    expect(ok).toMatchObject({ status: 200, body: { queued: 3 } });
    const note = await t.json(`/v1/ops/workspaces/${WS}/note`, {
      method: "POST",
      body: { text: "hi" },
      as: t.credentials.bearer(token),
    });
    expect(note).toMatchObject({ status: 201, body: { ws: WS, text: "hi" } });
    const doc = t.app.openapi();
    expect(doc.paths?.["/v1/ops/outbox"]?.get?.operationId).toBe("ops.outbox");
    expect(doc.paths?.["/v1/ops/workspaces/{ws}/note"]?.post?.operationId).toBe("ops.note");
    expect(t.app.registry.routes.map((r) => r.name)).toEqual(["ops.outbox", "ops.note"]);
  });
});
