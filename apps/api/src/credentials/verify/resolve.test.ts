import { randomUUID } from "node:crypto";
import type { Db } from "@fairsplit/db";
import { describe, expect, it } from "vitest";
import { createFakeClock } from "../../lib/clock.js";
import {
  generateOpaqueToken,
  JUDGE_COOKIE,
  OPERATOR_COOKIE,
  opaqueTokenSha256,
  signCookie,
  signLink,
} from "./codec.js";
import { createCredentialKeys } from "./keys.js";
import { createCredentialResolver, dbCredentialStore, memoryCredentialStore } from "./resolve.js";
import { actorOf, scopeOf } from "./types.js";

function setup() {
  const clock = createFakeClock("2026-10-28T02:00:00Z");
  const keys = createCredentialKeys({ cookieSecret: "k".repeat(40), linkSigningKey: "4c".repeat(32) });
  const store = memoryCredentialStore();
  const resolver = createCredentialResolver({ store, keys, clock });
  const ws = randomUUID();
  store.workspaces.set(ws, null);
  const nowS = Math.floor(clock.nowMs() / 1000);
  function token(
    o: {
      kind?: "frame" | "device";
      expiresInMs?: number;
      revoked?: boolean;
      sessionId?: string | null;
      workspaceId?: string;
    } = {},
  ) {
    const t = generateOpaqueToken(o.kind ?? "frame");
    const workspaceId = o.workspaceId ?? ws;
    store.tokens.set(opaqueTokenSha256(t), {
      id: randomUUID(),
      workspaceId,
      persona: "analyn",
      role: "treasurer",
      memberId: null,
      sessionId: o.sessionId === undefined ? randomUUID() : o.sessionId,
      expiresAt: new Date(clock.nowMs() + (o.expiresInMs ?? 7_200_000)),
      revokedAt: o.revoked ? clock.now() : null,
      workspaceExpiresAt: store.workspaces.get(workspaceId) ?? null,
    });
    return t;
  }
  return { clock, keys, store, resolver, ws, nowS, token };
}

describe("credential resolution", () => {
  it("HD6-11 checks a signed link's revocation only in its own workspace", async () => {
    const s = setup();
    const jti = randomUUID();
    const otherWs = randomUUID();
    const revoked = new Set([`${otherWs}:${jti}`]);
    const calls: unknown[][] = [];
    const resolver = createCredentialResolver({
      ...s,
      store: {
        ...s.store,
        async isLinkRevoked(...args: [string, string]) {
          calls.push(args);
          return revoked.has(`${args[0]}:${args[1]}`);
        },
      },
    });
    const link = signLink(s.keys.linkPrivateKey, {
      v: 1,
      k: "member",
      ws: s.ws,
      lineId: randomUUID(),
      jti,
      exp: s.nowS + 600,
    });
    expect((await resolver.resolve({ authorization: `Bearer ${link}` })).kind).toBe("ok");
    expect(calls).toEqual([[s.ws, jti]]);
    revoked.add(`${s.ws}:${jti}`);
    expect((await resolver.resolve({ authorization: `Bearer ${link}` })).kind).toBe("invalid");
  });
  it("resolves a frame token to the acting persona; the workspace comes from the token", async () => {
    const s = setup();
    const t = s.token();
    const r = await s.resolver.resolve({ authorization: `Bearer ${t}` });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok" || r.credential.kind !== "frame") throw new Error("expected a frame credential");
    expect(r.credential.workspaceId).toBe(s.ws);
    expect(actorOf(r.credential)).toEqual({
      kind: "human",
      id: "treasurer:analyn",
      impersonatedBy: `judge_session:${r.credential.sessionId}`,
    });
    expect(scopeOf(r.credential)?.workspaceId).toBe(s.ws);
    expect(scopeOf(r.credential)?.via).toBe("frame_token");
  });

  it("device tokens resolve as `device`", async () => {
    const s = setup();
    const r = await s.resolver.resolve({
      authorization: `Bearer ${s.token({ kind: "device", sessionId: null })}`,
    });
    expect(r.kind === "ok" && r.credential.kind).toBe("device");
    expect(r.kind === "ok" && actorOf(r.credential).impersonatedBy).toBeNull();
  });

  it("refuses unknown, revoked and expired tokens with the right codes", async () => {
    const s = setup();
    const unknown = await s.resolver.resolve({ authorization: `Bearer ${generateOpaqueToken("frame")}` });
    expect(unknown.kind === "invalid" && unknown.problem.code).toBe("UNAUTHENTICATED");
    const revoked = await s.resolver.resolve({ authorization: `Bearer ${s.token({ revoked: true })}` });
    expect(revoked.kind === "invalid" && revoked.problem.code).toBe("UNAUTHENTICATED");
    const t = s.token({ expiresInMs: 1000 });
    s.clock.advance(1000);
    const expired = await s.resolver.resolve({ authorization: `Bearer ${t}` });
    expect(expired.kind === "invalid" && expired.problem.code).toBe("FRAME_TOKEN_EXPIRED");
    const junk = await s.resolver.resolve({ authorization: "Bearer not-a-token" });
    expect(junk.kind === "invalid" && junk.problem.code).toBe("UNAUTHENTICATED");
    const basic = await s.resolver.resolve({ authorization: "Basic dXNlcjpwYXNz" });
    expect(basic.kind === "invalid" && basic.problem.code).toBe("UNAUTHENTICATED");
  });

  it("a token outlives nothing: an expired judge workspace ends its tokens", async () => {
    const s = setup();
    const ws = randomUUID();
    s.store.workspaces.set(ws, new Date(s.clock.nowMs() + 60_000));
    const t = s.token({ workspaceId: ws });
    expect((await s.resolver.resolve({ authorization: `Bearer ${t}` })).kind).toBe("ok");
    s.clock.advance(60_000);
    const r = await s.resolver.resolve({ authorization: `Bearer ${t}` });
    expect(r.kind === "invalid" && r.problem.code).toBe("FRAME_TOKEN_EXPIRED");
  });

  it("the judge cookie acts as the judge in its own workspace", async () => {
    const s = setup();
    const sid = randomUUID();
    const value = signCookie(s.keys.hmacKey(JUDGE_COOKIE.purpose), {
      v: 1,
      sid,
      ws: s.ws,
      iat: s.nowS,
      exp: s.nowS + 60,
    });
    const r = await s.resolver.resolve({ cookies: { [JUDGE_COOKIE.name]: value } });
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.credential).toMatchObject({
      kind: "judge_session",
      sessionId: sid,
      workspaceId: s.ws,
      role: "judge",
    });
    expect(actorOf(r.credential)).toEqual({
      kind: "human",
      id: "judge",
      impersonatedBy: `judge_session:${sid}`,
    });
    s.clock.advance(60_000);
    const later = await s.resolver.resolve({ cookies: { [JUDGE_COOKIE.name]: value } });
    expect(later.kind === "invalid" && later.problem.code).toBe("FRAME_TOKEN_EXPIRED");
  });

  it("a judge cookie for a purged workspace no longer works", async () => {
    const s = setup();
    const value = signCookie(s.keys.hmacKey(JUDGE_COOKIE.purpose), {
      v: 1,
      sid: randomUUID(),
      ws: randomUUID(),
      iat: s.nowS,
      exp: s.nowS + 60,
    });
    const r = await s.resolver.resolve({ cookies: { [JUDGE_COOKIE.name]: value } });
    expect(r.kind === "invalid" && r.problem.code).toBe("FRAME_TOKEN_EXPIRED");
  });

  it("an explicit bearer wins over the judge cookie", async () => {
    const s = setup();
    const cookie = signCookie(s.keys.hmacKey(JUDGE_COOKIE.purpose), {
      v: 1,
      sid: randomUUID(),
      ws: s.ws,
      iat: s.nowS,
      exp: s.nowS + 60,
    });
    const r = await s.resolver.resolve({
      authorization: `Bearer ${s.token()}`,
      cookies: { [JUDGE_COOKIE.name]: cookie },
    });
    expect(r.kind === "ok" && r.credential.kind).toBe("frame");
  });

  it("the operator cookie has no workspace", async () => {
    const s = setup();
    const value = signCookie(s.keys.hmacKey(OPERATOR_COOKIE.purpose), {
      v: 1,
      sub: "operator",
      iat: s.nowS,
      exp: s.nowS + 60,
    });
    const r = await s.resolver.resolve({ cookies: { [OPERATOR_COOKIE.name]: value } });
    expect(r.kind === "ok" && r.credential.kind).toBe("operator");
    if (r.kind === "ok") expect(scopeOf(r.credential)).toBeNull();
  });

  it("member and brand links verify, expire and can be revoked", async () => {
    const s = setup();
    const lineId = randomUUID();
    const jti = randomUUID();
    const member = signLink(s.keys.linkPrivateKey, {
      v: 1,
      k: "member",
      ws: s.ws,
      lineId,
      jti,
      exp: s.nowS + 600,
    });
    const r = await s.resolver.resolve({ authorization: `Bearer ${member}` });
    expect(r.kind === "ok" && r.credential).toMatchObject({
      kind: "member_link",
      lineId,
      workspaceId: s.ws,
      role: "member",
    });
    if (r.kind === "ok") expect(scopeOf(r.credential)?.via).toBe("signed_link");
    s.store.revokedLinks.add(`${s.ws}:${jti}`);
    const revoked = await s.resolver.resolve({ authorization: `Bearer ${member}` });
    expect(revoked.kind === "invalid" && revoked.problem.code).toBe("UNAUTHENTICATED");

    const brand = signLink(s.keys.linkPrivateKey, {
      v: 1,
      k: "brand",
      ws: s.ws,
      brand: "lantern-bay",
      jti: randomUUID(),
      exp: s.nowS + 600,
    });
    const b = await s.resolver.resolve({ authorization: `Bearer ${brand}` });
    expect(b.kind === "ok" && b.credential).toMatchObject({ kind: "brand_link", brand: "lantern-bay" });
    s.clock.advance(600_000);
    const expired = await s.resolver.resolve({ authorization: `Bearer ${brand}` });
    expect(expired.kind === "invalid" && expired.problem.code).toBe("FRAME_TOKEN_EXPIRED");
  });

  it("no credential at all is `none`, not an error", async () => {
    const s = setup();
    expect(await s.resolver.resolve({})).toEqual({ kind: "none" });
    expect(await s.resolver.resolve({ cookies: { unrelated: "x" } })).toEqual({ kind: "none" });
  });
});

describe("link revocation fails closed", () => {
  // a store answering "never revoked" by omission would honour every revoked statement and brand link
  const db = {} as unknown as Db;

  it("dbCredentialStore refuses to be built without a revocation check", () => {
    expect(() => dbCredentialStore(db, {} as never)).toThrow(/isLinkRevoked/);
    expect(() => dbCredentialStore(db, undefined as never)).toThrow(/isLinkRevoked/);
    expect(() => dbCredentialStore(db, { isLinkRevoked: true } as never)).toThrow(/isLinkRevoked/);
    expect(dbCredentialStore(db, { isLinkRevoked: async () => true }).isLinkRevoked).toBeTypeOf("function");
  });

  it("the resolver refuses a store without one", () => {
    const s = setup();
    const { isLinkRevoked: _omitted, ...store } = s.store;
    expect(() => createCredentialResolver({ store: store as never, keys: s.keys, clock: s.clock })).toThrow(
      /isLinkRevoked/,
    );
  });

  it("a revocation check that fails never opens the link", async () => {
    const s = setup();
    const resolver = createCredentialResolver({
      store: {
        ...s.store,
        isLinkRevoked: async () => {
          throw new Error("ledger unreachable");
        },
      },
      keys: s.keys,
      clock: s.clock,
    });
    const link = signLink(s.keys.linkPrivateKey, {
      v: 1,
      k: "brand",
      ws: s.ws,
      brand: "lantern-bay",
      jti: randomUUID(),
      exp: s.nowS + 600,
    });
    await expect(resolver.resolve({ authorization: `Bearer ${link}` })).rejects.toThrow(/ledger unreachable/);
  });
});
