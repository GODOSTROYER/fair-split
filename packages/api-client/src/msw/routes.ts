// msw handlers for the judge and auth routes outside IC-01 (`JUDGE_ROUTES`), answered from the same MockWorld as
// the commands, with the same boundary: auth classes (401 without a credential; `operator` routes need the
// `fs_ops` cookie, Reset, "Try to break it" and frame tokens need the judge cookie of this session), request
// validation (400 VALIDATION_FAILED with located issues), IC-01 ApiError bodies, `X-Request-Id` and `X-FS-Rail`.
// Everything here is synthetic and labelled like the rest of the mock: tampers are simulated, nothing pays.
import type { Role } from "@fairsplit/contracts";
import { delay, type HttpHandler, HttpResponse, http } from "msw";
import type { z } from "zod";
import { uuidv7 } from "../bytes.js";
import { compilePath } from "../http.js";
import { JUDGE_ROUTES, type JudgeRouteName, type RouteSpec, type TamperKind } from "../routes.js";
import {
  baseHeaders,
  callerOf,
  checkParams,
  type MockHandlerOptions,
  problemResponse,
  urlPattern,
  validationProblem,
} from "./handlers.js";
import { mockHex } from "./ids.js";
import { MOCK_SESSION_ID, type MockCaller, MockProblem } from "./world.js";

const HOUR = 60 * 60_000;
const OPS_COOKIE = "fs_ops=mock-operator-session";

const TAMPER_LABEL: Readonly<Record<TamperKind, string>> = {
  amount: "Simulated tamper: Claude's draft overcharges Lantern Bay by US$1,000.00",
  offsetting: "Simulated tamper: shipping 50.00 offset by a 50.00 discount (same total)",
  recipient: "Simulated tamper: an extra recipient gets a copy of the invoice",
  change_payout: "Simulated tamper: one payout changes by 1 cent after both keys",
};

interface RouteCall {
  params: Record<string, string>;
  body: unknown;
  caller: MockCaller | null;
  /** The request carries the mock operator cookie. */
  operator: boolean;
  /** The bearer token, when one was sent. */
  bearer: string | null;
}

interface Answer {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

interface IssuedLink {
  kind: "member" | "brand";
  jti: string;
  lineId: string | null;
  revoked: boolean;
}

function hasCookie(request: Request, cookie: string): boolean {
  return (request.headers.get("cookie") ?? "").split(/;\s*/).includes(cookie);
}

function bearerOf(request: Request): string | null {
  return /^Bearer[ ]+(\S+)$/i.exec(request.headers.get("authorization") ?? "")?.[1] ?? null;
}

/** The judge and auth routes' handlers over `o.world`. */
export function createRouteHandlers(o: MockHandlerOptions): HttpHandler[] {
  const { world } = o;
  const judgeCode = o.judgeCode ?? "judge-code";
  const operatorPassword = o.operatorPassword ?? "operator";
  const links = new Map<string, IssuedLink>();
  let armed = false;
  let codeEntered = false;
  let demoKeys = 0;

  const iso = (offsetMs = 0) => new Date(world.now().getTime() + offsetMs).toISOString();

  const railView = () => ({
    mode: "live" as const,
    reason: null,
    label: world.rail === "sandbox" ? "Live on the PayPal sandbox (mock)" : "Simulated PayPal rail (mock)",
    rail: world.rail,
    quota: {
      dailyCap: 30,
      used24h: 0,
      hourlyCap: 6,
      usedThisHour: 0,
      sessionCap: 3,
      sessionUsed: 0,
      publicCap: 20,
      publicUsed: 0,
      coded: codeEntered,
      balance: { cents: 10_000_000, source: "simulator_opening" as const, at: null },
    },
  });

  const requireCaller = (call: RouteCall): MockCaller => {
    if (!call.caller)
      throw new MockProblem("UNAUTHENTICATED", "Sign in again: this request carries no valid credential.");
    return call.caller;
  };
  /** Reset, tampers and frame tokens: only the judge stage that started this session (its cookie). */
  const requireOwnSession = (call: RouteCall): void => {
    const caller = requireCaller(call);
    if (caller.token !== null || caller.role !== "judge") {
      throw new MockProblem("FORBIDDEN", "Only the judge stage that started this session can do this.");
    }
    if ((call.params.sid ?? "").toLowerCase() !== MOCK_SESSION_ID) {
      throw new MockProblem("FORBIDDEN", "This is another judge session.");
    }
  };
  const requireOperator = (call: RouteCall): void => {
    if (!call.operator) throw new MockProblem("UNAUTHENTICATED", "Sign in to /ops first.");
  };
  const requireRole = (call: RouteCall, roles: readonly Role[], what: string): MockCaller => {
    const caller = requireCaller(call);
    if (!roles.includes(caller.role))
      throw new MockProblem("FORBIDDEN", `${what} needs the ${roles.join(" or ")} role.`);
    return caller;
  };
  const issueLink = (kind: "member" | "brand", lineId: string | null): Answer => {
    const jti = mockHex(`link:${kind}:${links.size + 1}`, 16);
    links.set(jti, { kind, jti, lineId, revoked: false });
    const token = `${kind === "member" ? "fsm_" : "fsb_"}${jti}.mock`;
    return {
      status: 201,
      body: {
        kind,
        url: `${world.origin}/${kind === "member" ? "s" : "b"}/${token}`,
        jti,
        expiresAt: iso(30 * 24 * HOUR),
      },
    };
  };

  const answers: { readonly [K in JudgeRouteName]: (call: RouteCall) => Answer } = {
    judgeSession: (call) => {
      requireCaller(call);
      return {
        status: 200,
        body: {
          sessionId: MOCK_SESSION_ID,
          workspaceId: world.workspaceId,
          runId: world.runId,
          runSlug: world.runSlug,
          runState: world.run.state,
          sessionExpiresAt: iso(24 * HOUR),
          rail: railView(),
          lane: { position: null, etaMs: null, depth: 0, holderStep: null },
          tamper: { changePayoutArmed: armed },
        },
      };
    },
    judgeLane: () => ({ status: 200, body: { lane: { depth: 0, holderStep: null }, rail: railView() } }),
    resetJudgeSession: (call) => {
      requireOwnSession(call);
      const revokedTokens = 1 + demoKeys;
      armed = false;
      world.reset("invoiced");
      return {
        status: 200,
        body: {
          reset: true,
          sessionId: MOCK_SESSION_ID,
          workspaceId: world.workspaceId,
          endedAt: iso(),
          revokedTokens,
        },
      };
    },
    tamper: (call) => {
      requireOwnSession(call);
      const kind = (call.body as { kind: TamperKind }).kind;
      const label = TAMPER_LABEL[kind];
      if (kind === "change_payout") {
        if (armed) throw new MockProblem("INVALID_TRANSITION", "The 1-cent change is already armed.");
        armed = true;
      }
      const decidedBy = kind === "recipient" ? ["recipientInBrandAllowlist"] : ["invoiceEqualsQuote"];
      return {
        status: 200,
        body: {
          kind,
          label,
          simulated: true,
          runSlug: world.runSlug,
          verdict: kind === "change_payout" ? null : "DENY",
          decidedBy: kind === "change_payout" ? [] : decidedBy,
          reasons: [label],
          armed: kind === "change_payout",
          paypalCalls: 0,
          modelCalls: 0,
        },
      };
    },
    judgeCode: (call) => {
      requireCaller(call);
      if ((call.body as { code: string }).code.trim() !== judgeCode) {
        throw new MockProblem("FORBIDDEN", "That judge code is not valid.");
      }
      codeEntered = true;
      return { status: 200, body: { ok: true, bucket: "judge_code" } };
    },
    registerDemoKey: (call) => {
      const caller = requireCaller(call);
      const persona =
        caller.persona === "judge" ? "analyn" : caller.persona.replace(/[^a-z]/g, "") || "judge";
      demoKeys++;
      // C-13: a web_demo key is fs-{persona}-demo-{6 of [a-z0-9]} (contracts DeviceKey), never a real key's shape
      const suffix = mockHex(`demo-key:${demoKeys}`, 3);
      return {
        status: 201,
        body: {
          keyId: `fs-${persona}-demo-${suffix}`,
          approverId: caller.role === "judge" ? "treasurer:analyn" : `${caller.role}:${caller.persona}`,
          kind: "web_demo",
          label: "Demo key in this browser (Judge Mode only)",
          publicKeyHex: (call.body as { publicKeyHex: string }).publicKeyHex,
        },
      };
    },
    frameToken: (call) => {
      requireOwnSession(call);
      const [role = "", persona = ""] = (call.body as { persona: string }).persona.split(":");
      if (!["treasurer", "board", "clerk", "member", "brand"].includes(role) || !persona) {
        throw validationProblem("Use `{role}:{persona}`.", [
          { path: "body.persona", message: "not a persona of this workspace", code: "invalid_persona" },
        ]);
      }
      const token = world.mintToken("fst_", { persona, role: role as Role });
      return {
        status: 201,
        body: { token, role, persona, workspaceId: world.workspaceId, expiresAt: iso(2 * HOUR) },
      };
    },
    opsLogin: (call) => {
      if ((call.body as { password: string }).password !== operatorPassword) {
        throw new MockProblem("UNAUTHENTICATED", "That password is not right.");
      }
      return {
        status: 200,
        body: { ok: true, expiresAt: iso(8 * HOUR) },
        headers: { "Set-Cookie": `${OPS_COOKIE}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800` },
      };
    },
    opsLogout: () => ({
      status: 200,
      body: { ok: true },
      headers: { "Set-Cookie": "fs_ops=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" },
    }),
    opsPairing: (call) => {
      requireOperator(call);
      const { workspaceId: _ws, ...input } = call.body as {
        workspaceId: string;
        persona: string;
        role: Role;
      };
      const out = world.execute("createPairing", {
        params: {},
        input: input as never,
        caller: { token: null, persona: "operator", role: "operator" },
        headers: { idempotencyKey: null },
      });
      return { status: 201, body: out.body };
    },
    whoami: (call) => {
      const expiresAt = iso(2 * HOUR);
      if (call.bearer && /^fs[mb]_/.test(call.bearer)) {
        const link = links.get(call.bearer.slice(4).split(".")[0] ?? "");
        if (!link) throw new MockProblem("UNAUTHENTICATED", "This link is not valid.");
        if (link.revoked) throw new MockProblem("UNAUTHENTICATED", "This link was revoked.");
        const line = link.lineId ? world.line(link.lineId) : undefined;
        return {
          status: 200,
          body: {
            kind: link.kind === "member" ? "member_link" : "brand_link",
            role: link.kind,
            persona: link.kind === "member" ? (line?.memberNo ?? "member") : "brand",
            actor: link.kind === "member" ? `member-link:${link.jti}` : "brand:lantern-bay",
            impersonatedBy: null,
            workspaceId: world.workspaceId,
            sessionId: null,
            lineId: link.lineId,
            memberNo: line?.memberNo ?? null,
            brand: link.kind === "brand" ? "lantern-bay" : null,
            runSlug: world.runSlug,
            expiresAt: iso(30 * 24 * HOUR),
          },
        };
      }
      if (call.caller) {
        const judge = call.caller.token === null;
        return {
          status: 200,
          body: {
            kind: judge ? "judge_session" : call.caller.token?.startsWith("fsd_") ? "device" : "frame",
            role: call.caller.role,
            persona: call.caller.persona,
            actor: judge ? "judge" : `${call.caller.role}:${call.caller.persona}`,
            impersonatedBy: `judge_session:${MOCK_SESSION_ID}`,
            workspaceId: world.workspaceId,
            sessionId: MOCK_SESSION_ID,
            lineId: null,
            memberNo: null,
            brand: null,
            runSlug: world.runSlug,
            expiresAt,
          },
        };
      }
      if (call.operator) {
        return {
          status: 200,
          body: {
            kind: "operator",
            role: "operator",
            persona: "operator",
            actor: "operator",
            impersonatedBy: null,
            workspaceId: null,
            sessionId: null,
            lineId: null,
            memberNo: null,
            brand: null,
            runSlug: null,
            expiresAt: iso(8 * HOUR),
          },
        };
      }
      throw new MockProblem("UNAUTHENTICATED", "No credential was presented.");
    },
    issueMemberLink: (call) => {
      requireRole(call, ["treasurer", "judge"], "A statement link");
      const lineId = (call.body as { lineId: string }).lineId;
      if (!world.line(lineId)) throw new MockProblem("NOT_FOUND", "No such line in this workspace.");
      return issueLink("member", lineId);
    },
    revokeMemberLink: (call) => {
      requireRole(call, ["treasurer", "judge"], "Revoking a statement link");
      const jti = (call.body as { jti: string }).jti;
      const link = links.get(jti);
      if (link?.kind !== "member") throw new MockProblem("NOT_FOUND", "No such statement link.");
      const revoked = !link.revoked;
      link.revoked = true;
      return { status: 200, body: { revoked, jti } };
    },
    revokeLineLinks: (call) => {
      requireRole(call, ["treasurer", "judge"], "Revoking a line's statement links");
      const lineId = (call.body as { lineId: string }).lineId;
      if (!world.line(lineId)) throw new MockProblem("NOT_FOUND", "No such line in this workspace.");
      const jtis: string[] = [];
      for (const link of links.values()) {
        if (link.kind !== "member" || link.revoked || link.lineId !== lineId) continue;
        link.revoked = true;
        jtis.push(link.jti);
      }
      return { status: 200, body: { lineId, jtis } };
    },
    issueBrandLink: (call) => {
      requireOperator(call);
      return issueLink("brand", null);
    },
  };

  return (Object.keys(JUDGE_ROUTES) as JudgeRouteName[]).map((name) => {
    const route: RouteSpec = JUDGE_ROUTES[name];
    const compiled = compilePath(route.path);
    const method = route.method === "GET" ? http.get : http.post;
    return method(urlPattern(route.path, o.baseUrl), async ({ request }) => {
      const requestId = uuidv7();
      if (o.latency !== undefined) await delay(o.latency);
      try {
        const url = new URL(request.url);
        const params = compiled.match(url.pathname);
        if (!params) throw new MockProblem("NOT_FOUND", `No route for ${route.method} ${url.pathname}`);
        checkParams(route.path, params);
        const call: RouteCall = {
          params,
          body: await readBody(route, request),
          caller: callerOf(world, request),
          operator: hasCookie(request, OPS_COOKIE),
          bearer: bearerOf(request),
        };
        if (route.auth === "frame_or_session" && (o.auth ?? "required") === "required") requireCaller(call);
        const out = answers[name](call);
        return HttpResponse.json(out.body as object, {
          status: out.status,
          headers: { ...baseHeaders(world, requestId), ...(out.headers ?? {}) },
        });
      } catch (err) {
        if (err instanceof MockProblem) return problemResponse(world, err, requestId);
        const message = err instanceof Error ? err.message : String(err);
        return problemResponse(
          world,
          new MockProblem("INTERNAL", `mock ${name} failed: ${message}`),
          requestId,
        );
      }
    });
  });
}

async function readBody(route: RouteSpec, request: Request): Promise<unknown> {
  if (route.method !== "POST") return undefined;
  const text = await request.text();
  let json: unknown = {};
  if (text !== "") {
    try {
      json = JSON.parse(text);
    } catch {
      throw validationProblem("The body is not valid JSON.", [
        { path: "body", message: "not valid JSON", code: "invalid_json" },
      ]);
    }
  }
  if (!route.request) return json;
  const parsed = (route.request as z.ZodType).safeParse(json);
  if (!parsed.success) {
    throw validationProblem(
      "The request does not match the route's schema.",
      parsed.error.issues.map((i) => ({
        path: ["body", ...i.path.map(String)].join("."),
        message: i.message,
        code: i.code,
      })),
    );
  }
  return parsed.data;
}
