// A printed member link is a credential like any other: the QR on the 80 mm slip (the main way a member gets a
// link) is recorded in the ledger the first time it is printed (`link.issued`, ids and expiry only), so it can be
// revoked through the same route as an issued link, and a lost slip is revoked by its line. A revoked printed
// link stops on every route at once (statement, /v1/credential, the line stream, an open stream within a ping),
// and the day's next print carries the next generation.
import type { ApiError } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyLink } from "../../credentials/verify/index.js";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { issueDayOf, type PrintSlip, printLinkJti } from "../../statements/print.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
let w: ShowcaseWorld;
let treasurer: string;

beforeAll(async () => {
  // 20 ms pings: an open stream's credential re-check is observable within the test
  t = await createTestApp({ db: "postgres", sse: { pingMs: 20 } });
  w = await loadShowcase(t.deps.db);
  treasurer = await t.credentials.frameToken({
    workspaceId: w.workspaceId,
    role: "treasurer",
    persona: "analyn",
    expiresAt: new Date("2026-12-30T00:00:00.000Z"),
  });
});
afterAll(async () => t.close());

const path = (no: string) => `/v1/print/${w.runSlug}/members/${no}?lang=en`;
const tokenOf = (p: PrintSlip) => p.memberLink.url.split("/s/")[1] as string;
const jtiOf = (token: string) => {
  const v = verifyLink(t.deps.credentials.keys.linkPublicKeyHex, token, t.clock.nowMs());
  if (!v.ok) throw new Error(`not a link: ${v.reason}`);
  return v.payload.jti;
};

async function print(no: string): Promise<PrintSlip> {
  const r = await t.json<PrintSlip>(path(no), { as: t.credentials.bearer(treasurer) });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}

async function issuedEntries(jti: string) {
  return t.deps.db
    .select({ payload: schema.ledgerEntries.payload })
    .from(schema.ledgerEntries)
    .where(
      and(
        eq(schema.ledgerEntries.workspaceId, w.workspaceId),
        eq(schema.ledgerEntries.kind, "link.issued"),
        sql`${schema.ledgerEntries.payload}->>'jti' = ${jti}`,
      ),
    );
}

describe("printed member links are revocable", () => {
  it("each printed link is recorded once (link.issued: ids and expiry, never the token), however often it is printed", async () => {
    const a = await print("M-014");
    const b = await print("M-014");
    const c = await print("M-014");
    expect(b.memberLink).toEqual(a.memberLink);
    expect(c.memberLink).toEqual(a.memberLink);
    const lineId = must(w.lineIds.get("M-014"));
    const day = issueDayOf(t.clock.now());
    // the print names its link's id, so the console can revoke exactly the link it printed
    expect(a.memberLink.jti).toBe(printLinkJti(t.deps.credentials.keys, w.workspaceId, lineId, day, 0));
    expect(a.memberLink.jti).toBe(jtiOf(tokenOf(a)));
    const entries = await issuedEntries(a.memberLink.jti);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.payload).toEqual({
      kind: "member",
      jti: a.memberLink.jti,
      exp: a.memberLink.expiresAt,
      lineId,
      via: "print",
    });
    expect(JSON.stringify(entries)).not.toContain(tokenOf(a));
  });

  it("revoked through POST /v1/links/member/revoke: 401 on the statement, /v1/credential and the line stream; an open stream ends; the next print carries generation 1", async () => {
    const lineId = must(w.lineIds.get("M-007"));
    const day = issueDayOf(t.clock.now());
    const first = await print("M-007");
    const token = tokenOf(first);
    const as = t.credentials.bearer(token);
    expect(first.memberLink.jti).toBe(printLinkJti(t.deps.credentials.keys, w.workspaceId, lineId, day, 0));
    expect((await t.json(`/v1/statements/${lineId}`, { as })).status).toBe(200);
    expect((await t.json("/v1/credential", { as })).status).toBe(200);
    const open = await t.sse(`/v1/lines/${lineId}/events`, { as });
    expect(open.response.status).toBe(200);

    const r = await t.json<{ revoked: boolean; jti: string }>("/v1/links/member/revoke", {
      method: "POST",
      body: { jti: first.memberLink.jti },
      as: t.credentials.bearer(treasurer),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toEqual({ revoked: true, jti: first.memberLink.jti });

    await expect(open.reader.next(2_000)).rejects.toThrow(/stream ended/);
    for (const p of [`/v1/statements/${lineId}`, "/v1/credential"]) {
      const refused = await t.json<ApiError>(p, { as });
      expect(refused.status, p).toBe(401);
    }
    expect((await t.sse(`/v1/lines/${lineId}/events`, { as })).response.status).toBe(401);

    const next = await print("M-007");
    expect(next.memberLink.url).not.toBe(first.memberLink.url);
    expect(next.memberLink.jti).toBe(printLinkJti(t.deps.credentials.keys, w.workspaceId, lineId, day, 1));
    expect(jtiOf(tokenOf(next))).toBe(next.memberLink.jti);
    expect(
      (await t.json(`/v1/statements/${lineId}`, { as: t.credentials.bearer(tokenOf(next)) })).status,
    ).toBe(200);
    // revoking again names it as already revoked; a judge acting as the treasurer may revoke too
    const judge = t.credentials.judgeCookie({ workspaceId: w.workspaceId });
    const again = await t.json<{ revoked: boolean }>("/v1/links/member/revoke", {
      method: "POST",
      body: { jti: first.memberLink.jti },
      as: t.credentials.judge(judge),
    });
    expect(again.status).toBe(200);
    expect(again.body.revoked).toBe(false);
  });

  it("a lost slip: POST /v1/links/member/revoke-line revokes every live link of the line (printed on any day, or issued) and no other line's", async () => {
    const lineId = must(w.lineIds.get("M-022"));
    const other = await print("M-060");
    const dayOne = await print("M-022");
    t.clock.advance(24 * 60 * 60_000);
    const dayTwo = await print("M-022");
    expect(dayTwo.memberLink.jti).not.toBe(dayOne.memberLink.jti);
    const issued = await t.json<{ jti: string; url: string }>("/v1/links/member", {
      method: "POST",
      body: { lineId },
      as: t.credentials.bearer(treasurer),
    });
    expect(issued.status).toBe(201);
    const tokens = [tokenOf(dayOne), tokenOf(dayTwo), issued.body.url.split("/s/")[1] as string];
    for (const tk of tokens) {
      expect((await t.json(`/v1/statements/${lineId}`, { as: t.credentials.bearer(tk) })).status).toBe(200);
    }

    const r = await t.json<{ lineId: string; jtis: string[] }>("/v1/links/member/revoke-line", {
      method: "POST",
      body: { lineId },
      as: t.credentials.bearer(treasurer),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.lineId).toBe(lineId);
    expect([...r.body.jtis].sort()).toEqual(
      [dayOne.memberLink.jti, dayTwo.memberLink.jti, issued.body.jti].sort(),
    );
    for (const tk of tokens) {
      expect((await t.json(`/v1/statements/${lineId}`, { as: t.credentials.bearer(tk) })).status).toBe(401);
    }
    // another line's printed link is untouched
    const otherLine = must(w.lineIds.get("M-060"));
    expect(
      (await t.json(`/v1/statements/${otherLine}`, { as: t.credentials.bearer(tokenOf(other)) })).status,
    ).toBe(200);
    // nothing live is left: a second press revokes nothing; the next print is a fresh generation
    const again = await t.json<{ jtis: string[] }>("/v1/links/member/revoke-line", {
      method: "POST",
      body: { lineId },
      as: t.credentials.bearer(treasurer),
    });
    expect(again.body.jtis).toEqual([]);
    const fresh = await print("M-022");
    expect(fresh.memberLink.jti).not.toBe(dayTwo.memberLink.jti);
    expect(
      (await t.json(`/v1/statements/${lineId}`, { as: t.credentials.bearer(tokenOf(fresh)) })).status,
    ).toBe(200);
  });

  it("revoke-line: the treasurer or a judge only (FORBIDDEN otherwise); NOT_FOUND for a line of another workspace", async () => {
    const lineId = must(w.lineIds.get("M-014"));
    const clerk = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "clerk",
      persona: "jessie",
    });
    const refused = await t.json<ApiError>("/v1/links/member/revoke-line", {
      method: "POST",
      body: { lineId },
      as: t.credentials.bearer(clerk),
    });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe("FORBIDDEN");
    const fx = await t.fixture();
    const outsider = await t.credentials.frameToken({ workspaceId: fx.workspaceId, role: "treasurer" });
    const missing = await t.json<ApiError>("/v1/links/member/revoke-line", {
      method: "POST",
      body: { lineId },
      as: t.credentials.bearer(outsider),
    });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("NOT_FOUND");
  });
});
