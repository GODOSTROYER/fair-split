// The auth folder on embedded Postgres: pairing (createPairing / claimPairing, every listed error), stage
// frame tokens, operator login, member and brand links with revocation, and GET /v1/credential.
import { ApiError, ClaimPairingResponse, CreatePairingResponse } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashOperatorPassword } from "../../credentials/issue/index.js";
import { code6Digest } from "../../credentials/issue/pairing.js";
import { JUDGE_COOKIE, OPERATOR_COOKIE } from "../../credentials/verify/index.js";
import { createTestApp, type TestApp } from "../../test/index.js";

type PairingBody = ReturnType<typeof CreatePairingResponse.parse>;
type ClaimBody = ReturnType<typeof ClaimPairingResponse.parse>;

let t: TestApp;
const PASSWORD = "correct horse battery staple, sandbox only";

beforeAll(async () => {
  t = await createTestApp({
    db: "postgres",
    clock: new Date(),
    env: { FS_OPERATOR_PASSWORD_SCRYPT: await hashOperatorPassword(PASSWORD, { ln: 10 }) },
  });
});
afterAll(async () => t.close());
beforeEach(() => t.deps.rateLimits.reset());

interface Session {
  sessionId: string;
  workspaceId: string;
  runId: string;
  consoleToken: string;
  cookie: string;
}

let ipSeq = 0;
async function session(): Promise<Session> {
  ipSeq++;
  const r = await t.json<Omit<Session, "cookie">>("/v1/judge/sessions", {
    method: "POST",
    body: {},
    headers: { "true-client-ip": `198.51.100.${ipSeq}` },
  });
  expect(r.status).toBe(201);
  const m = /fs_js=([^;]+)/.exec(r.headers.get("set-cookie") ?? "");
  return { ...r.body, cookie: m?.[1] ?? "" };
}

const judge = (s: Session) => t.credentials.judge(s.cookie);
const bearer = (token: string) => t.credentials.bearer(token);

async function pair(s: Session, body: Record<string, unknown>, as = bearer(s.consoleToken)) {
  return t.json<PairingBody & ApiError>("/v1/pairing", { method: "POST", body, as });
}

describe("POST /v1/pairing (createPairing)", () => {
  it("201: a single-use QR url (token in the fragment) and a 6-digit code, 10 minutes", async () => {
    const s = await session();
    const r = await pair(s, { persona: "ernesto", role: "board" });
    expect(r.status).toBe(201);
    const body = CreatePairingResponse.parse(r.body);
    expect(body.url).toMatch(/^http:\/\/localhost:8787\/app\/pair#t=fsp_[A-Za-z0-9_-]{43}$/);
    expect(body.code6).toMatch(/^\d{6}$/);
    expect(Date.parse(body.expiresAt) - t.clock.nowMs()).toBe(10 * 60_000);
    // stored as digests only: neither the token nor the code is in the database
    const rows = await t.deps.db
      .select({ token: schema.pairingTokens.tokenSha256, code: schema.pairingTokens.code6Sha256 })
      .from(schema.pairingTokens)
      .where(eq(schema.pairingTokens.workspaceId, s.workspaceId));
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(body.url.split("#t=")[1] as string);
    expect(rows[0]?.code).toBe(code6Digest(t.deps.credentials.keys, body.code6));
    expect(rows[0]?.code).not.toBe(
      (await import("node:crypto")).createHash("sha256").update(body.code6).digest("hex"),
    );
  });

  it("the judge cookie may pair too; a member persona is named by member number", async () => {
    const s = await session();
    const r = await pair(s, { persona: "M-014", role: "member", memberNo: "M-014" }, judge(s));
    expect(r.status).toBe(201);
  });

  it("403 FORBIDDEN: a member's, clerk's or Chair's token cannot pair a phone", async () => {
    const s = await session();
    const frame = await t.json<{ token: string }>(`/v1/judge/sessions/${s.sessionId}/frames`, {
      method: "POST",
      body: { persona: "board:ernesto" },
      as: judge(s),
    });
    const r = await pair(s, { persona: "jessie", role: "clerk" }, bearer(frame.body.token));
    expect(r.status).toBe(403);
    expect(ApiError.parse(r.body).code).toBe("FORBIDDEN");
  });

  it("403 FORBIDDEN: judge and operator are never paired; unknown officers and members are refused", async () => {
    const s = await session();
    for (const body of [
      { persona: "judge", role: "judge" },
      { persona: "ops", role: "operator" },
      { persona: "nobody", role: "board" },
      { persona: "M-999", role: "member", memberNo: "M-999" },
    ]) {
      const r = await pair(s, body);
      expect(r.status, JSON.stringify(body)).toBe(403);
      expect(ApiError.parse(r.body).code).toBe("FORBIDDEN");
    }
  });

  it("400 VALIDATION_FAILED: a member without a number, a mismatched persona, an officer with a number", async () => {
    const s = await session();
    for (const body of [
      { persona: "celing", role: "member" },
      { persona: "celing", role: "member", memberNo: "M-014" },
      { persona: "ernesto", role: "board", memberNo: "M-014" },
      { persona: "Ernesto!", role: "board" },
    ]) {
      const r = await pair(s, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(ApiError.parse(r.body).code).toBe("VALIDATION_FAILED");
    }
  });

  it("401 UNAUTHENTICATED without a credential; 401 FRAME_TOKEN_EXPIRED once the session was reset", async () => {
    const s = await session();
    const none = await t.json<ApiError>("/v1/pairing", {
      method: "POST",
      body: { persona: "ernesto", role: "board" },
    });
    expect(none.status).toBe(401);
    expect(ApiError.parse(none.body).code).toBe("UNAUTHENTICATED");
    await t.json(`/v1/judge/sessions/${s.sessionId}/reset`, { method: "POST", body: {}, as: judge(s) });
    const after = await pair(s, { persona: "ernesto", role: "board" }, judge(s));
    expect(after.status).toBe(401);
    expect(ApiError.parse(after.body).code).toBe("FRAME_TOKEN_EXPIRED");
  });

  it("replays an Idempotency-Key retry instead of making a second pairing", async () => {
    const s = await session();
    const headers = { "idempotency-key": "pair-retry-1" };
    const body = { persona: "jessie", role: "clerk" };
    const a = await t.json<PairingBody>("/v1/pairing", {
      method: "POST",
      body,
      headers,
      as: bearer(s.consoleToken),
    });
    const b = await t.json<PairingBody>("/v1/pairing", {
      method: "POST",
      body,
      headers,
      as: bearer(s.consoleToken),
    });
    expect(b.headers.get("idempotent-replayed")).toBe("true");
    expect(b.body).toEqual(a.body);
    const rows = await t.deps.db
      .select({ id: schema.pairingTokens.id })
      .from(schema.pairingTokens)
      .where(eq(schema.pairingTokens.workspaceId, s.workspaceId));
    expect(rows).toHaveLength(1);
  });
});

describe("POST /v1/pairing/claim (claimPairing)", () => {
  it("200 by QR token: a device token for that persona in that workspace, impersonated by the session", async () => {
    const s = await session();
    const p = CreatePairingResponse.parse((await pair(s, { persona: "ernesto", role: "board" })).body);
    const token = p.url.split("#t=")[1] as string;
    const r = await t.json<ClaimBody>("/v1/pairing/claim", { method: "POST", body: { token } });
    expect(r.status).toBe(200);
    const body = ClaimPairingResponse.parse(r.body);
    expect(body).toMatchObject({ role: "board", persona: "ernesto", workspaceId: s.workspaceId });
    expect(body.token).toMatch(/^fsd_/);
    // never past the workspace's own end (24 h after the press)
    expect(Date.parse(body.expiresAt)).toBeLessThanOrEqual(t.clock.nowMs() + 24 * 3_600_000);
    const who = await t.json<{ actor: string; impersonatedBy: string; kind: string }>("/v1/credential", {
      as: bearer(body.token),
    });
    expect(who.body).toMatchObject({
      kind: "device",
      actor: "board:ernesto",
      impersonatedBy: `judge_session:${s.sessionId}`,
    });
    const ledger = await t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, s.workspaceId),
          eq(schema.ledgerEntries.kind, "credential.paired"),
        ),
      );
    expect(ledger).toHaveLength(1);
    expect(JSON.stringify(ledger)).not.toContain(body.token);
  });

  it("200 by 6-digit code, then 410 PAIRING_TOKEN_INVALID: single use", async () => {
    const s = await session();
    const p = CreatePairingResponse.parse(
      (await pair(s, { persona: "M-014", role: "member", memberNo: "M-014" })).body,
    );
    const ok = await t.json<ClaimBody>("/v1/pairing/claim", { method: "POST", body: { code6: p.code6 } });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ role: "member", persona: "M-014" });
    const again = await t.json<ApiError>("/v1/pairing/claim", { method: "POST", body: { code6: p.code6 } });
    expect(again.status).toBe(410);
    expect(ApiError.parse(again.body).code).toBe("PAIRING_TOKEN_INVALID");
    const byToken = await t.json<ApiError>("/v1/pairing/claim", {
      method: "POST",
      body: { token: p.url.split("#t=")[1] },
    });
    expect(byToken.status).toBe(410);
  });

  it("inv.i5.cas: two phones racing for one code: exactly one wins (compare-and-set)", async () => {
    const s = await session();
    const p = CreatePairingResponse.parse((await pair(s, { persona: "jessie", role: "clerk" })).body);
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        t.json("/v1/pairing/claim", {
          method: "POST",
          body: { code6: p.code6 },
          headers: { "true-client-ip": `192.0.2.${i}` },
        }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 410, 410]);
  });

  it("410 PAIRING_TOKEN_INVALID after 10 minutes, for an unknown token, and once the session ended", async () => {
    const s = await session();
    const p = CreatePairingResponse.parse((await pair(s, { persona: "ernesto", role: "board" })).body);
    const unknown = await t.json<ApiError>("/v1/pairing/claim", {
      method: "POST",
      body: { token: `fsp_${"A".repeat(43)}` },
    });
    expect(unknown.status).toBe(410);
    const notOurs = await t.json<ApiError>("/v1/pairing/claim", {
      method: "POST",
      body: { token: "x".repeat(20) },
    });
    expect(notOurs.status).toBe(410);
    t.clock.advance(10 * 60_000 + 1);
    const late = await t.json<ApiError>("/v1/pairing/claim", { method: "POST", body: { code6: p.code6 } });
    expect(late.status).toBe(410);
    expect(ApiError.parse(late.body).code).toBe("PAIRING_TOKEN_INVALID");
    const s2 = await session();
    const p2 = CreatePairingResponse.parse((await pair(s2, { persona: "ernesto", role: "board" })).body);
    await t.json(`/v1/judge/sessions/${s2.sessionId}/reset`, { method: "POST", body: {}, as: judge(s2) });
    const ended = await t.json<ApiError>("/v1/pairing/claim", {
      method: "POST",
      body: { token: p2.url.split("#t=")[1] },
    });
    expect(ended.status).toBe(410);
  });

  it("400 VALIDATION_FAILED for a body that is neither a token nor a 6-digit code", async () => {
    const r = await t.json<ApiError>("/v1/pairing/claim", { method: "POST", body: { code6: "12345" } });
    expect(r.status).toBe(400);
    expect(ApiError.parse(r.body).code).toBe("VALIDATION_FAILED");
  });

  it("429 RATE_LIMITED: ten claims a minute per network, and sixty 6-digit guesses a minute in all", async () => {
    for (let i = 0; i < 10; i++) {
      await t.json("/v1/pairing/claim", {
        method: "POST",
        body: { code6: "000000" },
        headers: { "true-client-ip": "192.0.2.77" },
      });
    }
    const r = await t.json<ApiError>("/v1/pairing/claim", {
      method: "POST",
      body: { code6: "000000" },
      headers: { "true-client-ip": "192.0.2.77" },
    });
    expect(r.status).toBe(429);
    expect(ApiError.parse(r.body).code).toBe("RATE_LIMITED");
    t.deps.rateLimits.reset();
    // many networks guessing codes together hit the global budget; a QR token is never blocked by it
    for (let i = 0; i < 60; i++) {
      await t.json("/v1/pairing/claim", {
        method: "POST",
        body: { code6: String(i).padStart(6, "0") },
        headers: { "true-client-ip": `10.0.${Math.floor(i / 9)}.${i % 9}` },
      });
    }
    const guessed = await t.json<ApiError>("/v1/pairing/claim", {
      method: "POST",
      body: { code6: "999999" },
      headers: { "true-client-ip": "10.9.9.9" },
    });
    expect(guessed.status).toBe(429);
    const s = await session();
    const p = CreatePairingResponse.parse((await pair(s, { persona: "ernesto", role: "board" })).body);
    const qr = await t.json("/v1/pairing/claim", {
      method: "POST",
      body: { token: p.url.split("#t=")[1] },
      headers: { "true-client-ip": "10.9.9.10" },
    });
    expect(qr.status).toBe(200);
  });
});

describe("stage frame tokens", () => {
  it("201: a 2 h frame token for a persona of this session (member, Chair, clerk, brand)", async () => {
    const s = await session();
    for (const [persona, role] of [
      ["member:M-014", "member"],
      ["board:ernesto", "board"],
      ["clerk:jessie", "clerk"],
      ["brand:dana", "brand"],
    ] as const) {
      const r = await t.json<{ token: string; role: string; persona: string; expiresAt: string }>(
        `/v1/judge/sessions/${s.sessionId}/frames`,
        { method: "POST", body: { persona }, as: judge(s) },
      );
      expect(r.status, persona).toBe(201);
      expect(r.body.role).toBe(role);
      expect(r.body.token).toMatch(/^fst_/);
      expect(Date.parse(r.body.expiresAt) - t.clock.nowMs()).toBe(2 * 3_600_000);
    }
    const member = await t.json<{ token: string }>(`/v1/judge/sessions/${s.sessionId}/frames`, {
      method: "POST",
      body: { persona: "member:M-014" },
      as: judge(s),
    });
    const who = await t.json<{ actor: string }>("/v1/credential", { as: bearer(member.body.token) });
    expect(who.body.actor).toBe("member:M-014");
  });

  it("403 for another session, a frame token, judge or operator personas; 400 for an unreadable persona", async () => {
    const a = await session();
    const b = await session();
    const other = await t.json<ApiError>(`/v1/judge/sessions/${b.sessionId}/frames`, {
      method: "POST",
      body: { persona: "board:ernesto" },
      as: judge(a),
    });
    expect(other.status).toBe(403);
    const viaToken = await t.json<ApiError>(`/v1/judge/sessions/${a.sessionId}/frames`, {
      method: "POST",
      body: { persona: "board:ernesto" },
      as: bearer(a.consoleToken),
    });
    expect(viaToken.status).toBe(403);
    const judgeRole = await t.json<ApiError>(`/v1/judge/sessions/${a.sessionId}/frames`, {
      method: "POST",
      body: { persona: "judge:judge" },
      as: judge(a),
    });
    expect(judgeRole.status).toBe(403);
    const bad = await t.json<ApiError>(`/v1/judge/sessions/${a.sessionId}/frames`, {
      method: "POST",
      body: { persona: "ernesto" },
      as: judge(a),
    });
    expect(bad.status).toBe(400);
  });
});

describe("operator login", () => {
  it("a correct password sets the HttpOnly fs_ops cookie (8 h), which then acts as the operator", async () => {
    const r = await t.json<{ ok: boolean; expiresAt: string }>("/v1/ops/login", {
      method: "POST",
      body: { password: PASSWORD },
    });
    expect(r.status).toBe(200);
    expect(Date.parse(r.body.expiresAt) - t.clock.nowMs()).toBeLessThanOrEqual(8 * 3_600_000);
    const set = r.headers.get("set-cookie") ?? "";
    expect(set).toMatch(/^fs_ops=/);
    expect(set).toMatch(/HttpOnly/i);
    const value = /fs_ops=([^;]+)/.exec(set)?.[1] as string;
    const who = await t.json<{ kind: string; role: string }>("/v1/credential", {
      as: t.credentials.operator(value),
    });
    expect(who.body).toMatchObject({ kind: "operator", role: "operator" });
    const out = await t.json("/v1/ops/logout", { method: "POST", body: {} });
    expect(out.headers.get("set-cookie") ?? "").toMatch(new RegExp(`^${OPERATOR_COOKIE.name}=;`));
  });

  it("401 for a wrong password, 429 after five tries a minute, 403 when no hash is configured", async () => {
    const wrong = await t.json<ApiError>("/v1/ops/login", { method: "POST", body: { password: "not it" } });
    expect(wrong.status).toBe(401);
    expect(ApiError.parse(wrong.body).code).toBe("UNAUTHENTICATED");
    expect(wrong.headers.get("set-cookie")).toBeNull();
    for (let i = 0; i < 4; i++) await t.json("/v1/ops/login", { method: "POST", body: { password: "x" } });
    const limited = await t.json<ApiError>("/v1/ops/login", { method: "POST", body: { password: PASSWORD } });
    expect(limited.status).toBe(429);
    const bare = await createTestApp({ db: "none" });
    try {
      const r = await bare.json<ApiError>("/v1/ops/login", { method: "POST", body: { password: PASSWORD } });
      expect(r.status).toBe(403);
      expect(ApiError.parse(r.body).code).toBe("FORBIDDEN");
    } finally {
      await bare.close();
    }
  });
});

describe("member and brand links", () => {
  async function lineIn(s: Session): Promise<string> {
    const [member] = await t.deps.db
      .select({ id: schema.members.id })
      .from(schema.members)
      .where(and(eq(schema.members.workspaceId, s.workspaceId), eq(schema.members.memberNo, "M-014")));
    const db = t.pg?.owner.db;
    if (!db) throw new Error("no database");
    const [line] = await db
      .insert(schema.memberLines)
      .values({
        workspaceId: s.workspaceId,
        runId: s.runId,
        memberId: member?.id as string,
        state: "READY",
        rail: "ON",
        currency: "USD",
        verifiedG: 1000n,
        grade1G: 1000n,
        premiumCents: 3000n,
        bonusCents: 1500n,
        deductionsCents: 131n,
        creditsCents: 0n,
        netCents: 4369n,
        deductions: [],
        provenance: "replay",
      })
      .returning({ id: schema.memberLines.id });
    return line?.id as string;
  }

  it("issues a statement link that opens as a read-only member credential, and revokes it", async () => {
    const s = await session();
    const lineId = await lineIn(s);
    const r = await t.json<{ url: string; jti: string; kind: string }>("/v1/links/member", {
      method: "POST",
      body: { lineId },
      as: bearer(s.consoleToken),
    });
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/^http:\/\/localhost:8787\/s\/fsm_/);
    const token = r.body.url.split("/s/")[1] as string;
    const who = await t.json<{ kind: string; memberNo: string; lineId: string; runSlug: string }>(
      "/v1/credential",
      {
        as: bearer(token),
      },
    );
    expect(who.status).toBe(200);
    expect(who.body).toMatchObject({ kind: "member_link", memberNo: "M-014", lineId });
    // read-only: a member link cannot act (presence is frame_or_session)
    const act = await t.json<ApiError>("/v1/presence", {
      method: "POST",
      body: { view: "M-MB-01" },
      as: bearer(token),
    });
    expect(act.status).toBe(403);
    // the shell forwards the printed link to the app
    const opened = await t.request(`/s/${token}`, { redirect: "manual" });
    expect([302, 404]).toContain(opened.status); // 404 when this app serves no static pages
    const revoke = await t.json<{ revoked: boolean }>("/v1/links/member/revoke", {
      method: "POST",
      body: { jti: r.body.jti },
      as: bearer(s.consoleToken),
    });
    expect(revoke.body).toEqual({ revoked: true, jti: r.body.jti });
    const again = await t.json<{ revoked: boolean }>("/v1/links/member/revoke", {
      method: "POST",
      body: { jti: r.body.jti },
      as: bearer(s.consoleToken),
    });
    expect(again.body.revoked).toBe(false);
    const after = await t.json<ApiError>("/v1/credential", { as: bearer(token) });
    expect(after.status).toBe(401);
    expect(ApiError.parse(after.body).message).toMatch(/revoked/);
    const ledger = await t.deps.db
      .select({ kind: schema.ledgerEntries.kind, payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, s.workspaceId),
          sql`${schema.ledgerEntries.kind} like 'link.%'`,
        ),
      )
      .orderBy(schema.ledgerEntries.seq);
    expect(ledger.map((l) => l.kind)).toEqual(["link.issued", "link.revoked"]);
    expect(JSON.stringify(ledger)).not.toContain(token);
  });

  it("404 for a line of another workspace or a link never issued here; 403 for a member's token", async () => {
    const a = await session();
    const b = await session();
    const lineOfB = await lineIn(b);
    const r = await t.json<ApiError>("/v1/links/member", {
      method: "POST",
      body: { lineId: lineOfB },
      as: bearer(a.consoleToken),
    });
    expect(r.status).toBe(404);
    const revoke = await t.json<ApiError>("/v1/links/member/revoke", {
      method: "POST",
      body: { jti: "never-issued-here" },
      as: bearer(a.consoleToken),
    });
    expect(revoke.status).toBe(404);
    const frame = await t.json<{ token: string }>(`/v1/judge/sessions/${a.sessionId}/frames`, {
      method: "POST",
      body: { persona: "member:M-014" },
      as: judge(a),
    });
    const lineOfA = await lineIn(a);
    const asMember = await t.json<ApiError>("/v1/links/member", {
      method: "POST",
      body: { lineId: lineOfA },
      as: bearer(frame.body.token),
    });
    expect(asMember.status).toBe(403);
  });

  it("brand links are the operator's: 201 for a live workspace, 403 for anyone else, 404 for an unknown workspace", async () => {
    const s = await session();
    const login = await t.json("/v1/ops/login", { method: "POST", body: { password: PASSWORD } });
    const ops = /fs_ops=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] as string;
    const r = await t.json<{ url: string; kind: string }>("/v1/links/brand", {
      method: "POST",
      body: { workspaceId: s.workspaceId },
      as: t.credentials.operator(ops),
    });
    expect(r.status).toBe(201);
    expect(r.body.url).toMatch(/\/b\/fsb_/);
    const token = r.body.url.split("/b/")[1] as string;
    const who = await t.json<{ kind: string; brand: string; runSlug: string }>("/v1/credential", {
      as: bearer(token),
    });
    expect(who.body).toMatchObject({ kind: "brand_link", brand: "lantern-bay" });
    expect(who.body.runSlug).toMatch(/^2026A-r\d+$/);
    const notOps = await t.json<ApiError>("/v1/links/brand", {
      method: "POST",
      body: { workspaceId: s.workspaceId },
      as: judge(s),
    });
    expect(notOps.status).toBe(403);
    const unknown = await t.json<ApiError>("/v1/links/brand", {
      method: "POST",
      body: { workspaceId: "0192f8a0-0000-7000-8000-00000000dead" },
      as: t.credentials.operator(ops),
    });
    expect(unknown.status).toBe(404);
  });
});

describe("GET /v1/credential", () => {
  it("describes a judge cookie, refuses none (401) and a forged token (401)", async () => {
    const s = await session();
    const who = await t.json<{ kind: string; persona: string; sessionId: string; workspaceId: string }>(
      "/v1/credential",
      {
        as: t.credentials.judge(s.cookie),
      },
    );
    expect(who.body).toMatchObject({
      kind: "judge_session",
      persona: "judge",
      sessionId: s.sessionId,
      workspaceId: s.workspaceId,
    });
    expect((await t.json<ApiError>("/v1/credential")).status).toBe(401);
    const forged = await t.json<ApiError>("/v1/credential", { as: bearer(`fst_${"A".repeat(43)}`) });
    expect(forged.status).toBe(401);
    const tampered = await t.json<ApiError>("/v1/credential", {
      headers: { cookie: `${JUDGE_COOKIE.name}=${s.cookie}x` },
    });
    expect(tampered.status).toBe(401);
  });
});
