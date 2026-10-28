// The judge and auth routes through the typed client against the msw mock: every route in JUDGE_ROUTES is
// served at its method and path, its success body parses with the route's schema, and the boundary refuses what
// fs-api refuses (no credential, another session, the console token where the judge cookie is needed, a wrong
// operator password, an operator route without the operator cookie).
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApiClient } from "./client.js";
import { ApiClientError } from "./errors.js";
import { createMockApi, MOCK_CONSOLE_TOKEN, MOCK_SESSION_ID } from "./msw/index.js";
import { JUDGE_ROUTES, type JudgeRouteName, judgeRoutes } from "./routes.js";

const BASE = "http://localhost:8787";
const mock = createMockApi({
  stage: "approve",
  pace: "manual",
  baseUrl: BASE,
  judgeCode: "lantern-42",
  operatorPassword: "sandbox only",
});
const server = setupServer(...mock.handlers);

const COOKIE = { cookie: "fs_js=mock-judge-cookie" };
const stage = judgeRoutes(createApiClient({ baseUrl: BASE, headers: COOKIE }));
const console_ = judgeRoutes(createApiClient({ baseUrl: BASE, token: MOCK_CONSOLE_TOKEN }));
const anonymous = judgeRoutes(createApiClient({ baseUrl: BASE }));

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => {
  server.close();
  mock.world.dispose();
});

async function refusal(p: Promise<unknown>): Promise<ApiClientError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(ApiClientError);
  return e as ApiClientError;
}

describe("judgeRoutes: the judge and auth routes outside IC-01", () => {
  it("covers every route the table declares, each with a typed method", () => {
    expect(Object.keys(stage).sort()).toEqual(Object.keys(JUDGE_ROUTES).sort());
    for (const [name, route] of Object.entries(JUDGE_ROUTES)) {
      expect(route.path.startsWith("/v1/"), name).toBe(true);
      expect(route.success.length, name).toBeGreaterThan(0);
    }
  });

  it("the stage reads its session and the public lane; no credential is a 401", async () => {
    const status = await console_.judgeSession();
    expect(status).toMatchObject({ sessionId: MOCK_SESSION_ID, runSlug: mock.world.runSlug });
    expect(status.rail.rail).toBe("simulated");
    const lane = await anonymous.judgeLane();
    expect(lane.lane.depth).toBe(0);
    expect((await refusal(anonymous.judgeSession())).code).toBe("UNAUTHENTICATED");
  });

  it("frame tokens are minted for the stage's phones by the judge cookie only, and act as that persona", async () => {
    const minted = await stage.frameToken({
      params: { sid: MOCK_SESSION_ID },
      body: { persona: "board:ernesto" },
    });
    expect(minted).toMatchObject({ role: "board", persona: "ernesto", workspaceId: mock.world.workspaceId });
    const who = await judgeRoutes(createApiClient({ baseUrl: BASE, token: minted.token })).whoami();
    expect(who).toMatchObject({ kind: "frame", role: "board", persona: "ernesto", actor: "board:ernesto" });
    // the console token is not the stage; another session id is not this one
    const byToken = await refusal(
      console_.frameToken({ params: { sid: MOCK_SESSION_ID }, body: { persona: "clerk:jessie" } }),
    );
    expect(byToken.code).toBe("FORBIDDEN");
    const other = await refusal(
      stage.frameToken({
        params: { sid: "0192f8a0-0000-7000-8000-0000000000ff" },
        body: { persona: "clerk:jessie" },
      }),
    );
    expect(other.code).toBe("FORBIDDEN");
  });

  it("'Try to break it' is simulated and labelled: a draft tamper is denied, the 1-cent change is armed once", async () => {
    const denied = await stage.tamper({ params: { sid: MOCK_SESSION_ID }, body: { kind: "amount" } });
    expect(denied).toMatchObject({
      simulated: true,
      verdict: "DENY",
      paypalCalls: 0,
      modelCalls: 0,
      armed: false,
    });
    expect(denied.label).toMatch(/^Simulated tamper/);
    const armed = await stage.tamper({ params: { sid: MOCK_SESSION_ID }, body: { kind: "change_payout" } });
    expect(armed).toMatchObject({ armed: true, verdict: null });
    expect((await stage.judgeSession()).tamper.changePayoutArmed).toBe(true);
    const twice = await refusal(
      stage.tamper({ params: { sid: MOCK_SESSION_ID }, body: { kind: "change_payout" } }),
    );
    expect(twice.code).toBe("INVALID_TRANSITION");
  });

  it("the judge code and a demo key", async () => {
    expect((await refusal(stage.judgeCode({ body: { code: "nope" } }))).code).toBe("FORBIDDEN");
    expect(await stage.judgeCode({ body: { code: "lantern-42" } })).toEqual({
      ok: true,
      bucket: "judge_code",
    });
    expect((await stage.judgeSession()).rail.quota.coded).toBe(true);
    const key = await console_.registerDemoKey({
      body: { publicKeyHex: "ab".repeat(32), signatureHex: "cd".repeat(64) },
    });
    expect(key.keyId).toMatch(/^fs-analyn-demo-[a-z0-9]{6}$/);
    expect(key).toMatchObject({ kind: "web_demo", approverId: "treasurer:analyn" });
  });

  it("operator sign-in, pairing an officer's phone and a brand link; operator routes need the cookie", async () => {
    expect((await refusal(anonymous.opsLogin({ body: { password: "guess" } }))).code).toBe("UNAUTHENTICATED");
    expect(
      (await refusal(anonymous.issueBrandLink({ body: { workspaceId: mock.world.workspaceId } }))).code,
    ).toBe("UNAUTHENTICATED");
    const login = await fetch(`${BASE}${JUDGE_ROUTES.opsLogin.path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: "sandbox only" }),
    });
    expect(login.status).toBe(200);
    const cookie = /(fs_ops=[^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "";
    expect(cookie).not.toBe("");
    const ops = judgeRoutes(createApiClient({ baseUrl: BASE, headers: { cookie } }));
    expect((await ops.whoami()).kind).toBe("operator");
    const pairing = await ops.opsPairing({
      body: { workspaceId: mock.world.workspaceId, persona: "ernesto", role: "board" },
    });
    expect(pairing.code6).toMatch(/^\d{6}$/);
    const brand = await ops.issueBrandLink({ body: { workspaceId: mock.world.workspaceId } });
    expect(brand.url).toMatch(/\/b\/fsb_/);
    const brandWho = await judgeRoutes(
      createApiClient({ baseUrl: BASE, token: brand.url.split("/b/")[1] ?? "" }),
    ).whoami();
    expect(brandWho.kind).toBe("brand_link");
    expect(await ops.opsLogout()).toEqual({ ok: true });
  });

  it("a member's statement link is issued for a line of this run and revoked once", async () => {
    const line = mock.world.lines()[0];
    if (!line) throw new Error("the seeded world has no lines");
    const link = await console_.issueMemberLink({ body: { lineId: line.id } });
    expect(link.kind).toBe("member");
    const token = link.url.split("/s/")[1] ?? "";
    const member = judgeRoutes(createApiClient({ baseUrl: BASE, token }));
    expect(await member.whoami()).toMatchObject({
      kind: "member_link",
      lineId: line.id,
      memberNo: line.memberNo,
    });
    expect(await console_.revokeMemberLink({ body: { jti: link.jti } })).toEqual({
      revoked: true,
      jti: link.jti,
    });
    expect(await console_.revokeMemberLink({ body: { jti: link.jti } })).toEqual({
      revoked: false,
      jti: link.jti,
    });
    expect((await refusal(member.whoami())).code).toBe("UNAUTHENTICATED");
  });

  it("a lost slip: every live link of a line is revoked at once, and only that line's", async () => {
    const [line, other] = mock.world.lines();
    if (!line || !other) throw new Error("the seeded world has too few lines");
    const a = await console_.issueMemberLink({ body: { lineId: line.id } });
    const b = await console_.issueMemberLink({ body: { lineId: line.id } });
    const keep = await console_.issueMemberLink({ body: { lineId: other.id } });
    const r = await console_.revokeLineLinks({ body: { lineId: line.id } });
    expect(r.lineId).toBe(line.id);
    expect([...r.jtis].sort()).toEqual([a.jti, b.jti].sort());
    expect(await console_.revokeLineLinks({ body: { lineId: line.id } })).toEqual({
      lineId: line.id,
      jtis: [],
    });
    const kept = judgeRoutes(createApiClient({ baseUrl: BASE, token: keep.url.split("/s/")[1] ?? "" }));
    expect(await kept.whoami()).toMatchObject({ kind: "member_link", lineId: other.id });
  });

  it("refuses a body the route's schema refuses (400 VALIDATION_FAILED, located)", async () => {
    const e = await refusal(
      stage.tamper({ params: { sid: MOCK_SESSION_ID }, body: { kind: "everything" as unknown as "amount" } }),
    );
    expect(e.code).toBe("VALIDATION_FAILED");
    expect(JSON.stringify(e.details ?? e.body)).toContain("body.kind");
  });

  it("Reset: only the stage that started the session; the world starts over", async () => {
    expect((await refusal(console_.resetJudgeSession({ params: { sid: MOCK_SESSION_ID } }))).code).toBe(
      "FORBIDDEN",
    );
    const out = await stage.resetJudgeSession({ params: { sid: MOCK_SESSION_ID } });
    expect(out).toMatchObject({ reset: true, sessionId: MOCK_SESSION_ID });
    expect(mock.world.stage).toBe("invoiced");
    expect((await stage.judgeSession()).tamper.changePayoutArmed).toBe(false);
  });

  it("every route answers at its declared method and path (no unhandled request)", async () => {
    const served = new Set<JudgeRouteName>();
    for (const name of Object.keys(JUDGE_ROUTES) as JudgeRouteName[]) {
      const route = JUDGE_ROUTES[name];
      const path = route.path.replace(":sid", MOCK_SESSION_ID);
      const r = await fetch(`${BASE}${path}`, {
        method: route.method,
        headers: { "content-type": "application/json", ...COOKIE },
        ...(route.method === "POST" ? { body: "{}" } : {}),
      });
      // routed: an answer from this route (a success, a refusal or a validation error), never msw's passthrough
      expect(r.headers.get("x-fs-rail"), name).toBe("simulated");
      served.add(name);
    }
    expect(served.size).toBe(Object.keys(JUDGE_ROUTES).length);
  });
});
