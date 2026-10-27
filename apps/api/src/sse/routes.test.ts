// Who may open the credentialed streams (S3.7 + S3.8): the run and workspace streams carry member-level events
// (line.state, item.updated, hold.*, extract.*), so they take the same readers as the run reads (treasurer,
// board, clerk, judge). A brand or member token reads a run nowhere, so it streams none either; a member token
// streams only its own line, and the brand none.
import { ApiError } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import type { FixtureWorkspace } from "@fairsplit/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CAN } from "../runs/access.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { STREAM_READERS } from "./routes.js";

const WS = "0192f8a0-0000-7000-8000-0000000000aa";

it("streams take the same readers as the run reads (no drift from CAN.readRuns)", () => {
  expect([...STREAM_READERS].sort()).toEqual([...CAN.readRuns].sort());
});

describe("SSE readers (no database: the role check runs before any lookup)", () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await createTestApp();
    t.credentials.registerWorkspace(WS);
  });
  afterAll(async () => t.close());

  for (const role of ["brand", "member"] as const) {
    it(`a ${role} token opens neither the workspace stream nor a run stream (403)`, async () => {
      const token = await t.credentials.frameToken({ workspaceId: WS, role, persona: `${role}-1` });
      for (const path of [`/v1/workspaces/${WS}/events`, "/v1/runs/2026A-r37/events"]) {
        const { response } = await t.sse(path, { as: t.credentials.bearer(token) });
        expect(response.status, path).toBe(403);
        expect(ApiError.parse(await response.json()).code).toBe("FORBIDDEN");
      }
    });
  }

  for (const role of ["treasurer", "board", "clerk"] as const) {
    it(`a ${role} token opens its workspace stream`, async () => {
      const token = await t.credentials.frameToken({ workspaceId: WS, role, persona: `${role}-1` });
      const { response, reader } = await t.sse(`/v1/workspaces/${WS}/events`, {
        as: t.credentials.bearer(token),
      });
      expect(response.status).toBe(200);
      await reader.close();
    });
  }

  it("the judge cookie opens its workspace stream", async () => {
    const cookie = t.credentials.judgeCookie({ workspaceId: WS });
    const { response, reader } = await t.sse(`/v1/workspaces/${WS}/events`, {
      as: t.credentials.judge(cookie),
    });
    expect(response.status).toBe(200);
    await reader.close();
  });
});

describe("SSE line stream readers (postgres)", () => {
  let t: TestApp;
  let fx: FixtureWorkspace;
  const lines: string[] = [];

  beforeAll(async () => {
    t = await createTestApp({ db: "postgres" });
    fx = await t.fixture({ withRun: true, members: 2 });
    const owner = t.pg?.owner.db;
    if (!owner || !fx.runId) throw new Error("fixture without a run");
    for (const memberId of fx.memberIds.slice(0, 2)) {
      const [row] = await owner
        .insert(schema.memberLines)
        .values({
          workspaceId: fx.workspaceId,
          runId: fx.runId,
          memberId,
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
          provenance: "seeded",
        })
        .returning({ id: schema.memberLines.id });
      if (row) lines.push(row.id);
    }
  });
  afterAll(async () => t.close());

  it("a member token streams its own line and gets 404 for another member's line", async () => {
    const token = await t.credentials.frameToken({
      workspaceId: fx.workspaceId,
      role: "member",
      persona: "member-1",
      memberId: fx.memberIds[0] as string,
    });
    const own = await t.sse(`/v1/lines/${lines[0]}/events`, { as: t.credentials.bearer(token) });
    expect(own.response.status).toBe(200);
    await own.reader.close();
    const other = await t.sse(`/v1/lines/${lines[1]}/events`, { as: t.credentials.bearer(token) });
    expect(other.response.status).toBe(404);
  });

  it("a brand token streams no line (403); the treasurer streams any line of the workspace", async () => {
    const brand = await t.credentials.frameToken({
      workspaceId: fx.workspaceId,
      role: "brand",
      persona: "b",
    });
    const refused = await t.sse(`/v1/lines/${lines[0]}/events`, { as: t.credentials.bearer(brand) });
    expect(refused.response.status).toBe(403);
    const treasurer = await t.credentials.frameToken({
      workspaceId: fx.workspaceId,
      role: "treasurer",
      persona: "analyn",
    });
    for (const id of lines) {
      const ok = await t.sse(`/v1/lines/${id}/events`, { as: t.credentials.bearer(treasurer) });
      expect(ok.response.status).toBe(200);
      await ok.reader.close();
    }
  });
});
