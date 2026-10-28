import { randomUUID } from "node:crypto";
import { ApiClientError, isNotImplemented as isNotImplementedError } from "@fairsplit/api-client";
import { API_COMMANDS, type ApiCommandName, ApiError, apiPath } from "@fairsplit/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isNotImplemented, notImplemented } from "../lib/command.js";
import { COMMAND_FOLDER, ROUTE_FOLDERS, type RouteFolder } from "../lib/commands.js";
import { contentDigestOf } from "../lib/digest.js";
import { defineRouteFolder } from "../lib/slice.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { mountRegistry, ROUTE_FOLDER_MODULES } from "./registry.js";

const SAMPLE_PARAMS: Record<string, string> = {
  runSlug: "2026A-r37",
  holdId: "0192f8a0-0000-7000-8000-000000000001",
  fieldId: "0192f8a0-0000-7000-8000-000000000002",
  lineId: "0192f8a0-0000-7000-8000-000000000003",
  id: "0192f8a0-0000-7000-8000-000000000004",
  ws: "0192f8a0-0000-7000-8000-000000000005",
};

function urlOf(name: ApiCommandName): string {
  const cmd = API_COMMANDS[name];
  const path = apiPath(cmd.path, SAMPLE_PARAMS);
  return name === "approvalPayload" ? `${path}?role=treasurer` : path;
}

const PAYLOAD = {
  v: 1,
  runId: "0192f8a0-0000-7000-8000-000000000010",
  seasonId: "0192f8a0-0000-7000-8000-000000000011",
  rateCardSha256: "7f3a".repeat(16),
  batchSha256: "91c2".repeat(16),
  itemCount: 8,
  totalCents: 36_839,
  currency: "USD",
  role: "treasurer",
  approverId: "treasurer:analyn",
  nonce: "nonce-0001",
  exp: "2026-10-28T02:30:00.000Z",
};

/** A body the contract accepts, so the 501 is about the handler, not validation. */
const VALID_BODIES: Partial<Record<ApiCommandName, unknown>> = {
  createJudgeSession: {},
  markPaid: {},
  payCash: {},
  submitApproval: { role: "treasurer", keyId: "fs-analyn-w1", signature: "ab".repeat(64), payload: PAYLOAD },
  resend: {
    newReceiver: "rhea@example.com",
    keyId: "fs-analyn-w1",
    signature: "ab".repeat(64),
    payload: PAYLOAD,
  },
  capture: {
    captureId: "0192f8a0-0000-7000-8000-000000000042",
    sha256: "a".repeat(64),
    mime: "image/jpeg",
    bytes: 1024,
    station: "BODEGA",
    capturedAt: "2026-10-28T01:59:00.000Z",
  },
  resolveHold: { resolution: "COUNT_ONCE" },
  enterField: { value: "64.80" },
  addDeduction: { label: "Multa", amountText: "₱200" },
  declineApproval: { role: "chair", reason: "Not today" },
  createPairing: { persona: "ernesto", role: "board" },
  claimPairing: { code6: "123456" },
  presence: { view: "W-TR-07" },
  createReviewRequest: { lineId: "0192f8a0-0000-7000-8000-000000000003" },
  setFlag: { flag: "kill_payouts", on: true },
};

/** The commands a slice has filled in; every other non-SSE command still answers the shell's 501 placeholder. */
const FILLED_IN: ReadonlySet<string> = new Set(
  ROUTE_FOLDER_MODULES.flatMap((mod) =>
    Object.entries(mod.commands as Record<string, unknown>)
      .filter(([, handler]) => !isNotImplemented(handler))
      .map(([name]) => name),
  ),
);

describe("route registry", () => {
  let t: TestApp;
  let token: string;
  const ws = SAMPLE_PARAMS.ws as string;

  beforeAll(async () => {
    t = await createTestApp();
    t.credentials.registerWorkspace(ws);
    token = await t.credentials.frameToken({ workspaceId: ws });
  });
  afterAll(async () => t.close());

  it("places every IC-01 command in exactly one folder (or the shell's SSE)", () => {
    const names = Object.keys(API_COMMANDS).sort();
    expect(Object.keys(COMMAND_FOLDER).sort()).toEqual(names);
    for (const [name, folder] of Object.entries(COMMAND_FOLDER)) {
      if (folder === "shell:sse")
        expect((API_COMMANDS[name as ApiCommandName] as { sse?: boolean }).sse).toBe(true);
      else expect(Object.keys(ROUTE_FOLDERS)).toContain(folder);
    }
  });

  it("mounts every folder once, each implementing exactly its commands", () => {
    expect(ROUTE_FOLDER_MODULES.map((m) => m.folder).sort()).toEqual(Object.keys(ROUTE_FOLDERS).sort());
    for (const mod of ROUTE_FOLDER_MODULES) {
      const expected = Object.entries(COMMAND_FOLDER)
        .filter(([, f]) => f === mod.folder)
        .map(([n]) => n)
        .sort();
      expect(Object.keys(mod.commands).sort(), mod.folder).toEqual(expected);
    }
  });

  it("reports every IC-01 command once, and which ones a slice has filled in", () => {
    const statuses = t.app.registry.commands;
    expect(statuses.map((c) => c.name).sort()).toEqual(Object.keys(API_COMMANDS).sort());
    const sse = statuses.filter((c) => c.slice === "shell").map((c) => c.name);
    expect(sse.sort()).toEqual(["runEvents", "workspaceEvents"]);
    for (const c of statuses) {
      if (c.slice === "shell") {
        expect(c.implemented, c.name).toBe(true);
        continue;
      }
      expect(c.slice, c.name).toBe(ROUTE_FOLDERS[c.folder as RouteFolder]);
      expect(c.implemented, c.name).toBe(FILLED_IN.has(c.name));
    }
  });

  for (const name of Object.keys(API_COMMANDS) as ApiCommandName[]) {
    const cmd = API_COMMANDS[name];
    if ("sse" in cmd && cmd.sse) continue;
    const send = async () => {
      expect(cmd.method === "GET" || VALID_BODIES[name] !== undefined, `${name} needs a sample body`).toBe(
        true,
      );
      const text = JSON.stringify(VALID_BODIES[name] ?? {});
      const init =
        cmd.method === "POST"
          ? {
              method: "POST",
              body: text,
              ...(name === "capture"
                ? { headers: { "idempotency-key": "k-registry-1", "content-digest": contentDigestOf(text) } }
                : {}),
            }
          : {};
      const as = cmd.auth === "frame_or_session" ? { as: t.credentials.bearer(token) } : {};
      return t.json<ApiError>(urlOf(name), { ...init, ...as });
    };

    if (FILLED_IN.has(name)) {
      it(`${cmd.method} ${cmd.path} (${name}) is routed to its slice's handler, never the 501 placeholder`, async () => {
        const r = await send();
        expect(r.status, JSON.stringify(r.body)).not.toBe(501);
        if (r.status < 400) return; // the shell already checked the body against the contract's response schema
        // this app has no database, so a handler that needs one fails: as an ApiError, from its own route
        const body = ApiError.parse(r.body);
        expect(body.status).toBe(r.status);
        expect(body.details?.reason).not.toBe("NOT_IMPLEMENTED");
        expect(
          r.status === 404 && body.message.startsWith("No route for"),
          "the command's route is mounted",
        ).toBe(false);
      });
      continue;
    }

    it(`${cmd.method} ${cmd.path} (${name}) is routed and answers 501 NOT_IMPLEMENTED as an ApiError`, async () => {
      const r = await send();
      expect(r.status, JSON.stringify(r.body)).toBe(501);
      const body = ApiError.parse(r.body);
      expect(body).toMatchObject({
        code: "INTERNAL",
        status: 501,
        details: { reason: "NOT_IMPLEMENTED", command: name },
      });
      const folder = COMMAND_FOLDER[name] as RouteFolder;
      expect(body.details?.slice).toBe(ROUTE_FOLDERS[folder]);
    });
  }

  it("inv.i6.human-gate: every frame_or_session command refuses a request without a person's credential", async () => {
    for (const name of Object.keys(API_COMMANDS) as ApiCommandName[]) {
      const cmd = API_COMMANDS[name];
      if (cmd.auth !== "frame_or_session") continue;
      const r = await t.json<ApiError>(
        urlOf(name),
        cmd.method === "POST" ? { method: "POST", body: VALID_BODIES[name] ?? {} } : {},
      );
      expect(r.status, name).toBe(401);
      expect(ApiError.parse(r.body).code).toBe("UNAUTHENTICATED");
      // a read-only member link is not a person acting in the workspace
      const link = t.credentials.memberLink({ workspaceId: ws, lineId: SAMPLE_PARAMS.lineId as string });
      const ro = await t.json<ApiError>(urlOf(name), {
        ...(cmd.method === "POST" ? { method: "POST", body: VALID_BODIES[name] ?? {} } : {}),
        as: t.credentials.bearer(link),
      });
      expect(ro.status, name).toBe(403);
    }
  });

  it("inv.i8.rail-label: every /v1 answer names its PayPal rail; the typed client reads it and the 501", async () => {
    for (const name of Object.keys(API_COMMANDS) as ApiCommandName[]) {
      const cmd = API_COMMANDS[name];
      if ("sse" in cmd && cmd.sse) continue;
      const r = await t.request(urlOf(name), {
        ...(cmd.method === "POST" ? { method: "POST", body: JSON.stringify(VALID_BODIES[name] ?? {}) } : {}),
      });
      expect(r.headers.get("x-fs-rail"), name).toBe("simulated");
    }
    // the placeholder seen through the typed client, on a stand-in runs folder (still true once RUNS fills it in)
    const stub = await createTestApp({
      folders: [
        defineRouteFolder({
          folder: "runs",
          commands: { markPaid: notImplemented, setFlag: notImplemented },
        }),
      ],
    });
    try {
      stub.credentials.registerWorkspace(ws);
      const api = stub.client(await stub.credentials.frameToken({ workspaceId: ws }));
      const r = await api.result("markPaid", { params: { runSlug: "2026A-r37" } });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(isNotImplementedError(r.error)).toBe(true);
      expect(r.error).toBeInstanceOf(ApiClientError);
      expect((r.error as ApiClientError).rail).toBe("simulated");
      expect((r.error as ApiClientError).details).toMatchObject({ command: "markPaid", slice: "runs" });
    } finally {
      await stub.close();
    }
  });

  it("refuses a folder that handles another folder's command, and a task claimed twice", () => {
    const rogue = defineRouteFolder({ folder: "print", commands: {} });
    (rogue.commands as Record<string, unknown>).resolveHold = notImplemented;
    expect(() => mountRegistry({ app: t.app.app, catalog: undefined as never }, [rogue])).toThrow(
      /assigns elsewhere/,
    );
    const a = defineRouteFolder({
      folder: "media",
      commands: {},
      tasks: () => ({ explain: async () => undefined }),
    });
    const b = defineRouteFolder({
      folder: "brand",
      commands: {},
      tasks: () => ({ explain: async () => undefined }),
    });
    const reg = mountRegistry({ app: t.app.app, catalog: undefined as never }, [a, b]);
    expect(() => reg.taskHandlers(t.deps)).toThrow(/claimed by both media and brand/);
  });

  it("marks the placeholder handler", () => {
    expect(isNotImplemented(notImplemented)).toBe(true);
    expect(isNotImplemented(async () => undefined)).toBe(false);
  });

  it("unknown /v1 routes are ApiError 404s, never the SPA", async () => {
    const r = await t.json<ApiError>(`/v1/holds/${randomUUID()}/nope`, { method: "POST", body: {} });
    expect(r.status).toBe(404);
    expect(ApiError.parse(r.body).code).toBe("NOT_FOUND");
  });
});
