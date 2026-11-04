import { randomUUID } from "node:crypto";
import { appendLedger, ledgerHead, schema, systemScope, withWorkspaceTx } from "@fairsplit/db";
import { entryHash as hashEntry } from "@fairsplit/domain";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { hashedClientIp } from "../lib/client-ip.js";
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

it("HD6-3: five member tiers, the public tier and exports share a completed head build", async () => {
  t.clock.advance(2_001);
  t.deps.rateLimits.reset();
  const build = vi.spyOn(bundle, "buildProofBundle");
  try {
    const links = [...world.lineIds.values()]
      .slice(0, 5)
      .map((lineId) => t.credentials.memberLink({ workspaceId: world.workspaceId, lineId }));
    for (let round = 0; round < 2; round++) {
      for (const link of links) {
        const r = await t.json(`/v1/proof/${world.runSlug}`, { as: t.credentials.bearer(link) });
        expect(r.status).toBe(200);
        expect(r.headers.get("x-fs-proof-tier")).toBe("member");
      }
      expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
    }
    const token = await t.credentials.frameToken({
      workspaceId: world.workspaceId,
      role: "treasurer",
      persona: "analyn",
    });
    for (let i = 0; i < 10; i++) {
      expect(
        (await t.json(`/v1/proof/${world.runSlug}/export`, { as: t.credentials.bearer(token) })).status,
      ).toBe(200);
    }
    expect(build).toHaveBeenCalledTimes(1);
  } finally {
    build.mockRestore();
  }
});

it("HD6-3: cache freshness starts when a slow build completes", async () => {
  t.clock.advance(2_001);
  t.deps.rateLimits.reset();
  const original = bundle.buildProofBundle;
  const build = vi.spyOn(bundle, "buildProofBundle").mockImplementation(async (...args) => {
    const result = await original(...args);
    t.clock.advance(2_001);
    return result;
  });
  try {
    expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
    expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
    expect(build).toHaveBeenCalledTimes(1);
  } finally {
    build.mockRestore();
  }
});

it("HD6-3: exports spend a per-network budget before any build", async () => {
  t.deps.rateLimits.reset();
  const token = await t.credentials.frameToken({
    workspaceId: world.workspaceId,
    role: "treasurer",
    persona: "analyn",
  });
  const as = t.credentials.bearer(token);
  const path = `/v1/proof/${world.runSlug}/export`;
  for (let i = 0; i < 120; i++) expect((await t.request(path, { as })).status).toBe(200);
  expect((await t.request(path, { as })).status).toBe(429);
  expect((await t.request(path, { as, headers: { "cf-connecting-ip": "198.51.100.18" } })).status).toBe(200);
});

it("HD6-3: cold builds have a network budget while a hot head remains readable", async () => {
  t.clock.advance(2_001);
  t.deps.rateLimits.reset();
  expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
  const network = hashedClientIp(t.deps.credentials.keys, null, t.clock.now());
  for (let i = 0; i < 60; i++)
    t.deps.rateLimits.take({ name: "proofBuildNetwork", limit: 60, windowMs: 60_000 }, network);
  // Expensive-build exhaustion must not refuse an already completed head.
  expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(200);
  t.clock.advance(2_001);
  const build = vi.spyOn(bundle, "buildProofBundle");
  try {
    expect((await t.json(`/v1/proof/${world.runSlug}`)).status).toBe(429);
    expect(build).not.toHaveBeenCalled();
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
  const [run] = await t.deps.db
    .select({ rateCardId: schema.payRuns.rateCardId })
    .from(schema.payRuns)
    .where(eq(schema.payRuns.id, world.runId));
  const edit = await t.json<{ code: string }>(`/v1/rate-cards/${run?.rateCardId}/deductions`, {
    method: "POST",
    body: { label: "Private edit", amountText: "1.00" },
    as,
  });
  expect(edit.status).toBe(429);
  expect(edit.body.code).toBe("RATE_LIMITED");
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
