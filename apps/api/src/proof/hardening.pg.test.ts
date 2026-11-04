import { randomUUID } from "node:crypto";
import { appendLedger, ledgerHead, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { entryHash as hashEntry } from "@fairsplit/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { createTestApp, type TestApp } from "../test/index.js";
import * as bundle from "./bundle.js";
import { loadShowcase, type ShowcaseWorld } from "./testing/world.js";

let t: TestApp;
let world: ShowcaseWorld;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres", clock: new Date() });
  if (!t.pg) throw new Error("Postgres required");
  world = await loadShowcase(t.pg.owner.db, {
    kind: "judge",
    expiresAt: new Date(t.clock.nowMs() + 86_400_000),
  });
  await t.pg.owner.db
    .update(schema.workspaces)
    .set({ claimedAt: t.clock.now() })
    .where(eq(schema.workspaces.id, world.workspaceId));
});
afterAll(async () => {
  vi.restoreAllMocks();
  await t.close();
});

async function growLedgerTo(target: number) {
  await withWorkspaceTx(t.deps.db, world.workspaceId, async (tx) => {
    const head = await ledgerHead(tx, world.workspaceId);
    let prevHash = head.entryHash;
    for (let seq = head.seq + 1; seq <= target; ) {
      const rows: (typeof schema.ledgerEntries.$inferInsert)[] = [];
      for (let n = 0; n < 100 && seq <= target; n++, seq++) {
        const fact = {
          seq,
          kind: "hd6.load",
          actorKind: "system" as const,
          actorId: "hd6-test",
          impersonatedBy: null,
          payload: {},
          at: t.clock.now().toISOString(),
        };
        const entryHash = hashEntry(prevHash, seq, fact);
        rows.push({ ...fact, at: t.clock.now(), workspaceId: world.workspaceId, prevHash, entryHash });
        prevHash = entryHash;
      }
      await tx.insert(schema.ledgerEntries).values(rows);
    }
  });
}

it("HD6-3: ten public reads and verification share one build until a ledger append", async () => {
  const build = vi.spyOn(bundle, "buildProofBundle");
  try {
    for (let i = 0; i < 10; i++) {
      expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
    }
    expect((await t.json(`/v1/proof/${world.runSlug}/verification`)).status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
    await withWorkspaceTx(t.deps.db, world.workspaceId, (tx) =>
      appendLedger(tx, systemScope(world.workspaceId, { kind: "system", id: "hd6-test" }), {
        kind: "hd6.cache.invalidated",
        payload: {},
        at: t.clock.now(),
      }),
    );
    expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
    expect(build).toHaveBeenCalledTimes(2);
    t.clock.advance(2_001);
    expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
    expect(build).toHaveBeenCalledTimes(3);
  } finally {
    build.mockRestore();
  }
});

it("HD6-3: three frame tokens in a session share sixty link issues", async () => {
  t.deps.rateLimits.reset();
  const sessionId = randomUUID();
  const tokens = await Promise.all(
    [0, 1, 2].map(() =>
      t.credentials.frameToken({
        workspaceId: world.workspaceId,
        sessionId,
        role: "treasurer",
        persona: "analyn",
      }),
    ),
  );
  const lineId = world.lineIds.get("M-014");
  if (!lineId) throw new Error("No line");
  for (let i = 0; i < 61; i++) {
    const response = await t.json("/v1/links/member", {
      method: "POST",
      body: { lineId },
      as: t.credentials.bearer(tokens[i % 3] ?? ""),
    });
    expect(response.status, `link ${i + 1}`).toBe(i < 60 ? 201 : 429);
  }
});

it("HD6-3: judge ledger cap refuses optional link and flag appends while system money facts continue", async () => {
  t.deps.rateLimits.reset();
  if (!t.pg) throw new Error("Postgres required");
  await growLedgerTo(5000);
  const token = await t.credentials.frameToken({
    workspaceId: world.workspaceId,
    role: "treasurer",
    persona: "analyn",
    sessionId: randomUUID(),
  });
  const as = t.credentials.bearer(token);
  const link = await t.json<{ code: string }>("/v1/links/member", {
    method: "POST",
    body: { lineId: world.lineIds.get("M-014") },
    as,
  });
  expect(link.status).toBe(429);
  expect(link.body.code).toBe("RATE_LIMITED");
  const flag = await t.json<{ code: string }>("/v1/flags", {
    method: "POST",
    body: { flag: "kill_ai_live", on: true },
    as,
  });
  expect(flag.status).toBe(429);
  expect(flag.body.code).toBe("RATE_LIMITED");
  await expect(
    withWorkspaceTx(t.deps.db, world.workspaceId, (tx) =>
      appendLedger(tx, systemScope(world.workspaceId, { kind: "system", id: "money" }), {
        kind: "payout.progress",
        payload: { runId: world.runId },
        at: t.clock.now(),
      }),
    ),
  ).resolves.toBeDefined();
}, 120_000);

it("HD6-3: an oversized head gets a non-500 refusal", async () => {
  if (!t.pg) throw new Error("Postgres required");
  await growLedgerTo(20_001);
  const r = await t.json<{ code: string }>(`/v1/proof/${world.runSlug}`);
  expect(r.status).toBe(429);
  expect(r.body.code).toBe("RATE_LIMITED");
}, 120_000);
