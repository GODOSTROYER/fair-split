import { CreateJudgeSessionResponse } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { fixtureWorkspace } from "@fairsplit/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTestApp, type TestApp, walkRun } from "../test/index.js";
import { purgeExpiredJudgeWorkspaces } from "./pool.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
});
afterAll(async () => t.close());

async function session(ip: string) {
  const r = await t.json("/v1/judge/sessions", {
    method: "POST",
    body: {},
    headers: { "cf-connecting-ip": ip },
  });
  expect(r.status).toBe(201);
  const body = CreateJudgeSessionResponse.parse(r.body);
  const cookie = /fs_js=([^;]+)/.exec(r.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new Error("No session cookie");
  return { ...body, as: t.credentials.judge(cookie) };
}

it("inv.i5.frame-reset-race: queued frame mints cannot outlive a Reset", async () => {
  if (!t.pg) throw new Error("Postgres required");
  const pg = t.pg;
  const s = await session("203.0.113.201");
  const lock = await t.pg.owner.sql.reserve();
  const waiting = async (n: number) => {
    await expect
      .poll(
        async () => {
          const [r] = await pg.owner.sql<{ n: number }[]>`
        select count(*)::int as n from pg_stat_activity
         where datname = current_database() and wait_event = 'advisory'`;
          return r?.n ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBeGreaterThanOrEqual(n);
  };
  let reset: ReturnType<typeof t.json> | undefined;
  const mints: ReturnType<typeof t.json<{ token: string }>>[] = [];
  try {
    await lock`begin`;
    await lock`select pg_advisory_xact_lock(hashtextextended(${`fs:ws-log:${s.workspaceId}`}, 0))`;
    reset = t.json(`/v1/judge/sessions/${s.sessionId}/reset`, {
      method: "POST",
      body: {},
      as: s.as,
    });
    await waiting(1);
    for (let i = 0; i < 4; i++) {
      mints.push(
        t.json<{ token: string }>(`/v1/judge/sessions/${s.sessionId}/frames`, {
          method: "POST",
          body: { persona: "board:ernesto" },
          as: s.as,
        }),
      );
    }
    await waiting(5);
  } finally {
    await lock`commit`;
    lock.release();
  }
  expect((await reset)?.status).toBe(200);
  const minted = await Promise.all(mints);
  for (const r of minted) {
    if (r.status === 201) {
      expect(
        (
          await t.json("/v1/credential", {
            as: t.credentials.bearer(r.body.token),
          })
        ).status,
      ).toBe(401);
    }
    expect(r.status).toBe(401);
  }
  const rows = await t.pg.owner.db
    .select()
    .from(schema.frameTokens)
    .where(eq(schema.frameTokens.workspaceId, s.workspaceId));
  expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
});

it("inv.i5.ended-workspace: even an unrevoked bearer refuses a cleared judge claim", async () => {
  const s = await session("203.0.113.202");
  expect(
    (
      await t.json(`/v1/judge/sessions/${s.sessionId}/reset`, {
        method: "POST",
        body: {},
        as: s.as,
      })
    ).status,
  ).toBe(200);
  for (const kind of ["frame", "device"] as const) {
    const token = await t.credentials.frameToken({
      workspaceId: s.workspaceId,
      sessionId: s.sessionId,
      kind,
    });
    expect((await t.json("/v1/credential", { as: t.credentials.bearer(token) })).status).toBe(401);
  }
});

it("purge orders deferred workspaces after removable workspaces before applying the pass limit", async () => {
  if (!t.pg) throw new Error("Postgres required");
  const ids: string[] = [];
  for (let i = 0; i < 20; i++) {
    const ws = await fixtureWorkspace(t.pg.owner.db, {
      kind: "judge",
      withRun: true,
      expiresAt: new Date(Date.now() - 120_000),
    });
    if (!ws.runId) throw new Error("No fixture run");
    await walkRun(t.pg.owner.sql, ws.runId, "POSTING");
    ids.push(ws.workspaceId);
  }
  const free = await fixtureWorkspace(t.pg.owner.db, {
    kind: "judge",
    expiresAt: new Date(Date.now() - 60_000),
  });
  const out = await purgeExpiredJudgeWorkspaces(t.deps.db, 20, [...ids, free.workspaceId]);
  expect(out.purged).toContain(free.workspaceId);
  expect(out.deferred).toHaveLength(19);
});
