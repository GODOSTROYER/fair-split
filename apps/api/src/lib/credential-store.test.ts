// The store fs-api boots with (server.ts and the harness share `appCredentialStore`): a revoked member link
// stops verifying on every route the shell resolves, not only on the judge slice's own checks.
import { ApiError } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
