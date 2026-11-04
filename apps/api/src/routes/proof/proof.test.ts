// The Proof commands at the HTTP boundary, on embedded Postgres with the seed's showcase run (IC-03 figures):
// proof, proofJson, proofExport (every listed error), tiers (C-23), the signed checkpoint, and the invariants a
// Proof exists to show (I3 conservation, I4 the signed digest is the payout, I8 labels).
import {
  type ApiError,
  type ChainVerification,
  type ProofBundle,
  ProofResponse,
  type PublishedKeys,
} from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { invoiceReference, verifyChain } from "@fairsplit/domain";
import { getProof, getRun } from "@fairsplit/seed";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ledgerKeyOf, SAMPLE_LEDGER_KEY_ID, SERVER_LEDGER_KEY_ID } from "../../ledger/keys.js";
import { buildProofBundle, findRunBySlug, loadProofFacts, type ProofRun } from "../../proof/bundle.js";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { WITHHELD_RECEIVER } from "../../proof/tier.js";
import { createTestApp, type TestApp } from "../../test/index.js";

const SERVER_SEED = "5e".repeat(32);

async function keysFor(t: TestApp, runSlug: string): Promise<PublishedKeys> {
  const r = await t.json<PublishedKeys>(`/.well-known/fairsplit-keys.json?run=${runSlug}`);
  expect(r.status).toBe(200);
  return r.body;
}

function plates(v: ChainVerification) {
  return Object.fromEntries(Object.entries(v.plates).map(([k, p]) => [k, p.ok]));
}

describe("Proof of the seeded showcase (seeded keys: Sample)", () => {
  let t: TestApp;
  let w: ShowcaseWorld;

  beforeAll(async () => {
    t = await createTestApp({ db: "postgres" });
    w = await loadShowcase(t.deps.db);
  });
  afterAll(async () => t.close());

  it("serves the public tier to anyone: member IDs, amounts and hashes, every receiver withheld (C-23)", async () => {
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.headers.get("x-fs-proof-tier")).toBe("public");
    expect(r.headers.get("x-fs-rail")).toBe("simulated");
    const body = ProofResponse.parse(r.body);
    expect(body.redacted).toBe(true);
    expect(body.bundle.batch.items).toHaveLength(getRun().items.length);
    for (const i of body.bundle.batch.items) expect(i.receiver).toBe(WITHHELD_RECEIVER);
    const text = JSON.stringify(body);
    for (const it of getRun().items) expect(text).not.toContain(it.receiver);
    expect(text).not.toContain("Consolacion");
    expect(body.bundle.lines.map((l) => l.memberNo)).toContain("M-014");
  });

  it("inv.i8.labels: the bundle is labelled by its least-real part (a seeded run reads seeded)", async () => {
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`);
    expect(ProofResponse.parse(r.body).provenance).toBe("seeded");
  });

  it("rebuilds the snapshot's bundle from the database, plate for plate", async () => {
    const link = t.credentials.brandLink({ workspaceId: w.workspaceId });
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as: t.credentials.bearer(link) });
    expect(r.status).toBe(200);
    expect(r.headers.get("x-fs-proof-tier")).toBe("full");
    const { bundle, redacted } = ProofResponse.parse(r.body);
    const seed = getProof();
    expect(redacted).toBe(false);
    const { checkpoint: _a, ...ours } = bundle;
    const { checkpoint: _b, ...theirs } = seed;
    expect({ ...ours, documents: sortDocs(ours.documents) }).toEqual({
      ...theirs,
      documents: sortDocs(theirs.documents),
    });
  });

  it("builds from the run as its own snapshot reads it, never from the caller's earlier lookup", async () => {
    const run = must(await findRunBySlug(t.deps.db, w.runSlug, t.clock.now()));
    // what a lookup made just before a transition committed would still say
    const stale: ProofRun = {
      ...run,
      state: "POSTED",
      rateCardSha256: "0".repeat(64),
      batchSha256: "1".repeat(64),
    };
    const built = await buildProofBundle(t.deps.db, stale, { key: ledgerKeyOf(t.deps), now: t.clock.now() });
    expect(built.facts.run).toEqual(run);
    expect(built.bundle.batch.rateCardSha256).toBe(w.rateCardSha256);
    expect(built.bundle.invoice.reference).toBe(invoiceReference(w.rateCardSha256));
    expect((await loadProofFacts(t.deps.db, stale)).run).toEqual(run);
  });

  it("the full tier verifies in demo mode as a Sample, all six plates, against the published keys", async () => {
    const link = t.credentials.brandLink({ workspaceId: w.workspaceId });
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as: t.credentials.bearer(link) });
    const { bundle } = ProofResponse.parse(r.body);
    const keys = await keysFor(t, w.runSlug);
    const demo = verifyChain(bundle, keys, { demoMode: true });
    expect(plates(demo)).toEqual({
      paid: true,
      ratified: true,
      read: true,
      computed: true,
      twoKeys: true,
      payoutItems: true,
    });
    expect(demo.checkpoint).toMatchObject({ ok: true, keyId: SAMPLE_LEDGER_KEY_ID });
    expect(demo.status).toBe("sample");
    // never "verified": seeded officer keys and a sample ledger key
    const strict = verifyChain(bundle, keys);
    expect(strict.status).toBe("failed");
    expect(strict.ok).toBe(false);
  });

  it("the public tier verifies everything but the receiver binding, which the server attests", async () => {
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`);
    const keys = await keysFor(t, w.runSlug);
    const v = verifyChain(ProofResponse.parse(r.body).bundle, keys, { demoMode: true });
    expect(plates(v)).toMatchObject({
      paid: true,
      ratified: true,
      read: true,
      computed: true,
      twoKeys: true,
    });
    expect(v.plates.payoutItems.ok).toBe(false);
    const att = await t.json<{ attestedBy: string; verification: ChainVerification }>(
      `/v1/proof/${w.runSlug}/verification`,
    );
    expect(att.status).toBe(200);
    expect(att.body.attestedBy).toBe("fs-api");
    expect(att.body.verification.status).toBe("sample");
    expect(att.body.verification.plates.payoutItems.ok).toBe(true);
  });

  it("inv.i2.rules-before-facts: the card was ratified before the first slip, by date and in chain order", async () => {
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`);
    const { bundle } = ProofResponse.parse(r.body);
    expect(bundle.rateCard.ratifiedAt.slice(0, 10) <= bundle.firstSlipDate).toBe(true);
    const ratified = must(bundle.ledger.find((e) => e.kind === "rate_card.ratified"));
    const accepted = bundle.ledger.filter((e) => e.kind === "rows.accepted");
    expect(accepted.length).toBe(bundle.documents.length);
    expect(accepted.every((e) => e.seq > ratified.seq)).toBe(true);
    expect((ratified.payload as { rateCardSha256: string }).rateCardSha256).toBe(bundle.rateCard.sha256);
  });

  it("signs a checkpoint over the ledger head, never dated before it (the clock is behind the film's timeline)", async () => {
    expect(t.clock.now().toISOString() < must(getProof().ledger.at(-1)).at).toBe(true);
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`);
    const { bundle } = ProofResponse.parse(r.body);
    const head = must(bundle.ledger.at(-1));
    expect(bundle.checkpoint).toMatchObject({ runId: w.runId, seq: head.seq, entryHash: head.entryHash });
    expect(Date.parse(bundle.checkpoint.at)).toBeGreaterThanOrEqual(Date.parse(head.at));
  });

  it("proofJson is the same bundle, as a download", async () => {
    const r = await t.request(`/v1/proof/${w.runSlug}.json`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-disposition")).toBe(`attachment; filename="FS-${w.runSlug}.proof.json"`);
    const body = ProofResponse.parse(await r.json());
    expect(body.redacted).toBe(true);
    expect(body.bundle.runSlug).toBe(w.runSlug);
  });

  it("a member link sees its own receiver and nobody else's", async () => {
    const link = t.credentials.memberLink({
      workspaceId: w.workspaceId,
      lineId: must(w.lineIds.get("M-014")),
    });
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as: t.credentials.bearer(link) });
    expect(r.headers.get("x-fs-proof-tier")).toBe("member");
    const body = ProofResponse.parse(r.body);
    expect(body.redacted).toBe(true);
    const own = body.bundle.batch.items.find((i) => i.senderItemId.endsWith("-M-014"));
    expect(own?.receiver).toBe(getRun().items.find((i) => i.memberNo === "M-014")?.receiver);
    for (const i of body.bundle.batch.items.filter((x) => !x.senderItemId.endsWith("-M-014"))) {
      expect(i.receiver).toBe(WITHHELD_RECEIVER);
    }
  });

  it("a credential for another workspace, an expired link or the operator gets only the public tier", async () => {
    const other = t.credentials.brandLink({ workspaceId: (await t.fixture()).workspaceId });
    const expired = t.credentials.brandLink({ workspaceId: w.workspaceId, ttlMs: 1 });
    t.clock.advance(5);
    for (const as of [
      t.credentials.bearer(other),
      t.credentials.bearer(expired),
      t.credentials.operator(t.credentials.operatorCookie()),
    ]) {
      const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as });
      expect(r.status).toBe(200);
      expect(r.headers.get("x-fs-proof-tier")).toBe("public");
      expect(ProofResponse.parse(r.body).redacted).toBe(true);
    }
  });

  it("proof and proofJson: NOT_FOUND for an unknown run and for a run not yet posted", async () => {
    for (const path of ["/v1/proof/2026A-r999999", "/v1/proof/2026A-r999999.json"]) {
      const r = await t.json<ApiError>(path);
      expect(r.status).toBe(404);
      expect(r.body.code).toBe("NOT_FOUND");
    }
    const fx = await t.fixture({ withRun: true, runState: "IN_REVIEW" });
    const [run] = await t.deps.db
      .select({ slug: schema.payRuns.runSlug })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, must(fx.runId)));
    const r = await t.json<ApiError>(`/v1/proof/${must(run).slug}`);
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({
      code: "NOT_FOUND",
      details: { reason: "PROOF_NOT_READY", runState: "IN_REVIEW" },
    });
  });

  it("a judge workspace that has expired (Reset) is gone for everyone, before the hourly purge", async () => {
    const fx = await t.fixture({
      kind: "judge",
      withRun: true,
      runState: "IN_REVIEW",
      expiresAt: new Date(t.clock.nowMs() - 1_000),
    });
    const [run] = await t.deps.db
      .select({ slug: schema.payRuns.runSlug })
      .from(schema.payRuns)
      .where(eq(schema.payRuns.id, must(fx.runId)));
    const r = await t.json<ApiError>(`/v1/proof/${must(run).slug}`);
    expect(r.status).toBe(404);
    expect(r.body.details).toBeUndefined();
  });

  it("RATE_LIMITED: anonymous reads are budgeted per hashed IP (120 a minute), with Retry-After", async () => {
    const headers = { "cf-connecting-ip": "198.51.100.23" };
    for (let i = 0; i < 120; i++) {
      expect((await t.request("/v1/proof/2026A-r999998", { headers })).status).toBe(404);
    }
    const r = await t.request(`/v1/proof/${w.runSlug}`, { headers });
    expect(r.status).toBe(429);
    expect(((await r.json()) as ApiError).code).toBe("RATE_LIMITED");
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    // another address is unaffected
    const other = await t.request(`/v1/proof/${w.runSlug}`, {
      headers: { "cf-connecting-ip": "198.51.100.24" },
    });
    expect(other.status).toBe(200);
  });

  describe("proofExport", () => {
    it("gives the treasurer, the brand persona, the Chair and a judge the full bundle", async () => {
      for (const [role, persona] of [
        ["treasurer", "analyn"],
        ["brand", "dana"],
        ["board", "ernesto"],
      ] as const) {
        const token = await t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona });
        const r = await t.json<unknown>(`/v1/proof/${w.runSlug}/export`, { as: t.credentials.bearer(token) });
        expect(r.status, role).toBe(200);
        expect(r.headers.get("content-disposition")).toContain(".proof.full.json");
        const body = ProofResponse.parse(r.body);
        expect(body.redacted).toBe(false);
        expect(body.bundle.batch.items.every((i) => i.receiver !== WITHHELD_RECEIVER)).toBe(true);
      }
      const judge = t.credentials.judgeCookie({ workspaceId: w.workspaceId });
      const r = await t.json<unknown>(`/v1/proof/${w.runSlug}/export`, { as: t.credentials.judge(judge) });
      expect(r.status).toBe(200);
    });

    it("FORBIDDEN for the clerk and a member (role before existence, so nothing leaks)", async () => {
      for (const role of ["clerk", "member"] as const) {
        const token = await t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona: "x" });
        for (const slug of [w.runSlug, "2026A-r424242"]) {
          const r = await t.json<ApiError>(`/v1/proof/${slug}/export`, { as: t.credentials.bearer(token) });
          expect(r.status, `${role} ${slug}`).toBe(403);
          expect(r.body.code).toBe("FORBIDDEN");
        }
      }
    });

    it("NOT_FOUND for a run outside the credential's workspace (the workspace comes from the credential)", async () => {
      const fx = await t.fixture();
      const token = await t.credentials.frameToken({ workspaceId: fx.workspaceId, role: "treasurer" });
      const r = await t.json<ApiError>(`/v1/proof/${w.runSlug}/export`, { as: t.credentials.bearer(token) });
      expect(r.status).toBe(404);
      expect(r.body.code).toBe("NOT_FOUND");
    });

    it("a brand link (read-only) cannot use the acting-only export; the shell refuses it", async () => {
      const link = t.credentials.brandLink({ workspaceId: w.workspaceId });
      const r = await t.json<ApiError>(`/v1/proof/${w.runSlug}/export`, { as: t.credentials.bearer(link) });
      expect(r.status).toBe(403);
      const none = await t.json<ApiError>(`/v1/proof/${w.runSlug}/export`);
      expect(none.status).toBe(401);
    });
  });

  describe("tampering is caught by the verifier, never smoothed over by the server", () => {
    it("inv.i4.digest-is-payout: a receiver changed after signing fails plate 6", async () => {
      await must(t.pg).owner.db.execute(
        sql`update payout_items set receiver = 'attacker@evil.example' where workspace_id = ${w.workspaceId} and sender_item_id = 'r37-M-014'`,
      );
      // The deliberate out-of-band SQL edit has no ledger append; exercise a rebuild after the 2 s cache TTL.
      t.clock.advance(2_001);
      try {
        const link = t.credentials.brandLink({ workspaceId: w.workspaceId });
        const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as: t.credentials.bearer(link) });
        const v = verifyChain(ProofResponse.parse(r.body).bundle, await keysFor(t, w.runSlug), {
          demoMode: true,
        });
        expect(v.status).toBe("failed");
        expect(v.plates.payoutItems).toEqual({
          ok: false,
          reason: "The batch hash doesn't match the signed batch. Proof withheld.",
        });
      } finally {
        const original = must(getRun().items.find((i) => i.memberNo === "M-014")).receiver;
        await must(t.pg).owner.db.execute(
          sql`update payout_items set receiver = ${original} where workspace_id = ${w.workspaceId} and sender_item_id = 'r37-M-014'`,
        );
      }
    });

    it("inv.i3.conservation: a line moved by a cent fails plate 4 (its hash and the pool sum)", async () => {
      const lineId = must(w.lineIds.get("M-039"));
      await must(t.pg)
        .owner.db.update(schema.memberLines)
        .set({ bonusCents: sql`bonus_cents + 1`, netCents: sql`net_cents + 1` })
        .where(and(eq(schema.memberLines.workspaceId, w.workspaceId), eq(schema.memberLines.id, lineId)));
      t.clock.advance(2_001);
      try {
        const link = t.credentials.brandLink({ workspaceId: w.workspaceId });
        const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as: t.credentials.bearer(link) });
        const v = verifyChain(ProofResponse.parse(r.body).bundle, await keysFor(t, w.runSlug), {
          demoMode: true,
        });
        expect(v.plates.computed.ok).toBe(false);
        expect(v.status).toBe("failed");
      } finally {
        await must(t.pg)
          .owner.db.update(schema.memberLines)
          .set({ bonusCents: sql`bonus_cents - 1`, netCents: sql`net_cents - 1` })
          .where(and(eq(schema.memberLines.workspaceId, w.workspaceId), eq(schema.memberLines.id, lineId)));
      }
    });
  });
});

describe("Proof signed by registered app keys and the server's ledger key (Verified)", () => {
  let t: TestApp;
  let w: ShowcaseWorld;

  beforeAll(async () => {
    t = await createTestApp({ db: "postgres", env: { FS_LEDGER_SIGNING_KEY: SERVER_SEED } });
    w = await loadShowcase(t.deps.db, { keys: "app" });
  });
  afterAll(async () => t.close());

  it("reads Verified, with no demo mode, from the HTTP boundary to the browser verifier", async () => {
    const token = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "brand",
      persona: "dana",
    });
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}/export`, { as: t.credentials.bearer(token) });
    expect(r.status).toBe(200);
    const { bundle } = ProofResponse.parse(r.body);
    const keys = await keysFor(t, w.runSlug);
    expect(keys.ledger[0]).toMatchObject({ keyId: SERVER_LEDGER_KEY_ID, kind: "server" });
    expect(
      keys.officers
        .filter((k) => k.kind === "app")
        .map((k) => k.keyId)
        .sort(),
    ).toEqual(["fs-analyn-a1", "fs-ernesto-a1"]);
    const v = verifyChain(bundle, keys);
    expect(v.status, JSON.stringify(v.plates)).toBe("verified");
    expect(v.ok).toBe(true);
    expect(v.sampleKeys).toEqual([]);
    expect(bundle.checkpoint.keyId).toBe(SERVER_LEDGER_KEY_ID);
  });

  it("a revoked officer key no longer verifies what it signed after its revocation", async () => {
    await t.deps.db
      .update(schema.deviceKeys)
      .set({ revokedAt: new Date("2026-10-29T02:09:30.000Z") })
      .where(
        and(eq(schema.deviceKeys.workspaceId, w.workspaceId), eq(schema.deviceKeys.keyId, "fs-ernesto-a1")),
      );
    const token = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "brand",
      persona: "dana",
    });
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}/export`, { as: t.credentials.bearer(token) });
    const v = verifyChain(ProofResponse.parse(r.body).bundle, await keysFor(t, w.runSlug));
    expect(v.plates.twoKeys).toEqual({ ok: false, reason: "A signing key was revoked before it signed." });
  });
});

function sortDocs(d: ProofBundle["documents"]) {
  return [...d].sort((a, b) => (a.documentId < b.documentId ? -1 : 1));
}
