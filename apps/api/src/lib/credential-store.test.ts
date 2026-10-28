// The store fs-api boots with (server.ts and the harness share `appCredentialStore`): a revoked member link
// stops verifying on every route the shell resolves, not only on the judge slice's own checks.
import { randomUUID } from "node:crypto";
import { ApiError } from "@fairsplit/contracts";
import { schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { revokeLink } from "../credentials/issue/links.js";
import { createTestApp, type TestApp } from "../test/index.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
});
afterAll(async () => t.close());

interface Started {
  workspaceId: string;
  runId: string;
  consoleToken: string;
}

async function memberLine(s: Started): Promise<string> {
  const [member] = await t.deps.db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(and(eq(schema.members.workspaceId, s.workspaceId), eq(schema.members.memberNo, "M-014")));
  const owner = t.pg?.owner.db;
  if (!owner || !member) throw new Error("the judge world has no member M-014");
  const [line] = await owner
    .insert(schema.memberLines)
    .values({
      workspaceId: s.workspaceId,
      runId: s.runId,
      memberId: member.id,
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
  if (!line) throw new Error("no line inserted");
  return line.id;
}

describe("appCredentialStore: link revocation is wired into the shared resolver", () => {
  it("a revoked member link is refused by the shell's own routes (line stream), not only by /v1/credential", async () => {
    const started = await t.json<Started>("/v1/judge/sessions", { method: "POST", body: {} });
    expect(started.status).toBe(201);
    const s = started.body;
    const lineId = await memberLine(s);
    const console_ = t.credentials.bearer(s.consoleToken);

    const issued = await t.json<{ url: string; jti: string }>("/v1/links/member", {
      method: "POST",
      body: { lineId },
      as: console_,
    });
    expect(issued.status).toBe(201);
    const link = t.credentials.bearer(issued.body.url.split("/s/")[1] as string);

    const before = await t.sse(`/v1/lines/${lineId}/events`, { as: link });
    expect(before.response.status).toBe(200);
    await before.reader.close();

    const revoked = await t.json<{ revoked: boolean }>("/v1/links/member/revoke", {
      method: "POST",
      body: { jti: issued.body.jti },
      as: console_,
    });
    expect(revoked.body.revoked).toBe(true);

    const after = await t.sse(`/v1/lines/${lineId}/events`, { as: link });
    expect(after.response.status).toBe(401);
    const body = ApiError.parse(await after.response.json());
    expect(body.code).toBe("UNAUTHENTICATED");
    expect(body.message).toMatch(/revoked/i);
  });
});

describe("a revoked link is refused by every route that reads it", () => {
  async function revoke(workspaceId: string, jti: string): Promise<void> {
    const scope = systemScope(workspaceId, { kind: "human", id: "operator" });
    await withWorkspaceTx(t.deps.db, scope, async (tx) => {
      expect(await revokeLink(tx, scope, { jti, at: t.clock.now() })).toBe(true);
    });
  }

  async function refusedAsRevoked(path: string, as: ReturnType<typeof t.credentials.bearer>) {
    const r = await t.request(path, { as });
    expect(r.status, path).toBe(401);
    const body = ApiError.parse(await r.json());
    expect(body.code, path).toBe("UNAUTHENTICATED");
    expect(body.message, path).toMatch(/revoked/i);
  }

  it("a brand link: the brand view, its CSV export and /v1/credential", async () => {
    const started = await t.json<Started & { runSlug: string }>("/v1/judge/sessions", {
      method: "POST",
      body: {},
    });
    expect(started.status).toBe(201);
    const s = started.body;
    const jti = randomUUID();
    const link = t.credentials.bearer(t.credentials.brandLink({ workspaceId: s.workspaceId, jti }));
    expect((await t.json(`/v1/brand/${s.runSlug}`, { as: link })).status).toBe(200);
    expect((await t.json("/v1/credential", { as: link })).status).toBe(200);
    await revoke(s.workspaceId, jti);
    for (const path of [`/v1/brand/${s.runSlug}`, `/v1/brand/${s.runSlug}/export.csv`, "/v1/credential"]) {
      await refusedAsRevoked(path, link);
    }
  });

  it("a member link: its statement, the statement's audio and /v1/credential", async () => {
    const started = await t.json<Started>("/v1/judge/sessions", { method: "POST", body: {} });
    expect(started.status).toBe(201);
    const s = started.body;
    const lineId = await memberLine(s);
    const jti = randomUUID();
    const link = t.credentials.bearer(t.credentials.memberLink({ workspaceId: s.workspaceId, lineId, jti }));
    expect((await t.json("/v1/credential", { as: link })).status).toBe(200);
    await revoke(s.workspaceId, jti);
    for (const path of [`/v1/statements/${lineId}`, `/v1/media/audio/${lineId}`, "/v1/credential"]) {
      await refusedAsRevoked(path, link);
    }
  });
});
