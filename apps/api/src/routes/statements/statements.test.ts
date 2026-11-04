// Statements and re-check requests at the HTTP boundary, on embedded Postgres with the seed's showcase run:
// who may read a statement, createReviewRequest with every listed error, the ledger entry it appends in the same
// transaction (and the Proof still verifies after it), and the `explain` task through the real outbox.
import { createHash, randomUUID } from "node:crypto";
import { type ApiError, ProofResponse, ReviewRequestDTO, TASKS } from "@fairsplit/contracts";
import { schema, withWorkspaceTx } from "@fairsplit/db";
import { format, sha256Hex, verifyChain } from "@fairsplit/domain";
import { enqueue } from "@fairsplit/outbox";
import { getLine, getMember } from "@fairsplit/seed";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { commitmentSalt } from "../../ledger/commitments.js";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { REVIEW_LEDGER_KIND, type ReviewOpening } from "../../statements/review.js";
import { REVIEW_CHIP, TEMPLATES_V1 } from "../../statements/templates.js";
import type { StatementView } from "../../statements/view.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
let w: ShowcaseWorld;
const line = (no: string) => w.lineIds.get(no) as string;
const memberId = (no: string) => w.memberIds.get(no) as string;

beforeAll(async () => {
  t = await createTestApp({ db: "postgres", taskHandlers: {} });
  w = await loadShowcase(t.deps.db);
});
afterAll(async () => t.close());

describe("GET /v1/statements/:lineId", () => {
  it.each(["COMPUTED", "READY", "HELD", "EXCLUDED"] as const)(
    "inv.i1.mobile-visibility: %s uses the same money visibility as the statement",
    async (state) => {
      const [source] = await t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, w.runId));
      const [original] = await t.deps.db
        .select()
        .from(schema.memberLines)
        .where(eq(schema.memberLines.id, line("M-031")));
      if (!source || !original) throw new Error("missing statement fixture");
      const [run] = await t.deps.db
        .insert(schema.payRuns)
        .values({
          workspaceId: w.workspaceId,
          seasonId: source.seasonId,
          rateCardId: source.rateCardId,
          seasonCode: source.seasonCode,
          currency: source.currency,
          rateCardSha256: source.rateCardSha256,
          provenance: "seeded",
        })
        .returning({ id: schema.payRuns.id });
      if (!run) throw new Error("missing provisional run");
      const lineId = randomUUID();
      await t.deps.db.insert(schema.memberLines).values({ ...original, id: lineId, runId: run.id, state });
      const token = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
      const response = await t.json<StatementView>(`/v1/statements/${lineId}?lang=en`, {
        as: t.credentials.bearer(token),
      });
      expect(response.status).toBe(200);
      expect(response.body.amount).toBeNull();
      expect(response.body.mobile.amounts).toBeNull();
      expect(response.body.mobile.formatted.hero).toBeNull();
      expect(response.body.mobile.formatted.receiptRows).toEqual([]);
      expect(response.body.mobile.formatted.conservation).toBeNull();
    },
  );

  it("inv.i8.mobile-simulator-status: a simulator POST status in a seeded run does not claim paid", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
    const where = and(
      eq(schema.payoutItems.workspaceId, w.workspaceId),
      eq(schema.payoutItems.lineId, line("M-014")),
    );
    const [original] = await t.deps.db
      .select({
        status: schema.payoutItems.status,
        statusRank: schema.payoutItems.statusRank,
        provenance: schema.payoutItems.provenance,
      })
      .from(schema.payoutItems)
      .where(where)
      .limit(1);
    if (!original) throw new Error("missing hero item");
    await t.deps.db.update(schema.payoutItems).set({ provenance: "simulated_rail" }).where(where);
    try {
      const response = await t.json<StatementView>(`/v1/statements/${line("M-014")}`, {
        as: t.credentials.bearer(link),
      });
      expect(response.status).toBe(200);
      expect(response.body.mobile.item).toMatchObject({ status: "PENDING", verified: false });
      expect(response.body.mobile.lineState).toBe("PAYPAL_PENDING");
    } finally {
      await t.deps.db.update(schema.payoutItems).set(original).where(where);
    }
  });

  it("inv.i5.mobile-submitted: a newly submitted item has a rankable pending phone status", async () => {
    const isolated = await createTestApp({ db: "postgres", taskHandlers: {} });
    try {
      const isolatedWorld = await loadShowcase(isolated.deps.db);
      const lineId = isolatedWorld.lineIds.get("M-014") as string;
      const [original] = await isolated.deps.db
        .select()
        .from(schema.payoutItems)
        .where(
          and(
            eq(schema.payoutItems.workspaceId, isolatedWorld.workspaceId),
            eq(schema.payoutItems.lineId, lineId),
          ),
        )
        .limit(1);
      if (!original) throw new Error("missing hero item");
      const id = randomUUID();
      // A new attempt, rather than moving a settled item backwards through the I5 database guard.
      await isolated.deps.db.insert(schema.payoutItems).values({
        ...original,
        id,
        senderItemId: `k1cd-${id}`,
        payoutItemId: null,
        status: "SUBMITTED",
        statusRank: 0,
        provenance: "simulated_rail",
        createdAt: new Date(Date.now() + 1000),
      });
      const link = isolated.credentials.memberLink({ workspaceId: isolatedWorld.workspaceId, lineId });
      const submitted = await isolated.json<StatementView>(`/v1/statements/${lineId}`, {
        as: isolated.credentials.bearer(link),
      });
      expect(submitted.status).toBe(200);
      expect(submitted.body.mobile.item).toMatchObject({ status: "PENDING", verified: false });
    } finally {
      await isolated.close();
    }
  });

  it("the member lookup returns only the paired member's newest workspace line", async () => {
    const token = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "member",
      persona: "M-014",
      memberId: memberId("M-014"),
    });
    const response = await t.json<{ lineId: string }>("/v1/members/me/statement-line", {
      as: t.credentials.bearer(token),
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ lineId: line("M-014") });
    expect((await t.json("/v1/members/me/statement-line")).status).toBe(401);
    const clerk = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "clerk" });
    expect((await t.json("/v1/members/me/statement-line", { as: t.credentials.bearer(clerk) })).status).toBe(
      403,
    );
  });

  it("the member's own link reads it in their registry language, money first, numbers from code", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
    const r = await t.json<StatementView>(`/v1/statements/${line("M-014")}`, {
      as: t.credentials.bearer(link),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const v = r.body;
    expect(v.lang).toBe("ceb");
    expect(v.registryLang).toBe("ceb");
    expect(v.state).toBe("PAID");
    expect(v.statusWords).toBe("Bayad na (simulated PayPal sandbox)");
    expect(v.reviewChip).toBe("Machine-translated, pending native review");
    expect(v.amount?.usd.display).toBe(format.money(must(getLine("M-014")).netCents));
    expect(v.amount?.php?.exact).toBe(false);
    expect(v.display[0]?.text).toContain(must(getMember("M-014")).addressAs.ceb);
    expect(v.sms.label).toBe("Preview, not sent");
    expect(v.provenance).toBe("seeded");
    expect(v.mobile.lineId).toBe(line("M-014"));
    expect(v.mobile.member.memberNo).toBe("M-014");
    expect(v.mobile.formatted.hero?.paypal.amount).toBe(format.money(must(getLine("M-014")).netCents));
    expect(v.mobile.formatted.conservation?.ok).toBe(true);
    expect(v.mobile.spokenHashes).toEqual(
      v.spoken.map((sentence) => createHash("sha256").update(sentence.text).digest("hex")),
    );
  });

  it("?lang=en switches language; English carries no review chip", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
    const r = await t.json<StatementView>(`/v1/statements/${line("M-014")}?lang=en`, {
      as: t.credentials.bearer(link),
    });
    expect(r.body.lang).toBe("en");
    expect(r.body.reviewChip).toBeNull();
    expect(r.body.display[0]?.text).toBe(
      `Good day, ${must(getMember("M-014")).addressAs.en}. Thank you for your hard work.`,
    );
  });

  it("a cash member's statement says exact pesos at the run's rate (M-053, Merlyn)", async () => {
    const token = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
    const r = await t.json<StatementView>(`/v1/statements/${line("M-053")}?lang=en`, {
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(200);
    expect(r.body.pay).toBe("cash");
    expect(r.body.amount?.php?.exact).toBe(true);
    expect(r.body.display.find((s) => s.slot === "PAY")?.text).toContain(r.body.amount?.php?.display ?? "?");
  });

  it("refuses: no credential 401, another member's link 404, a brand link 403, another member 403, another workspace 404", async () => {
    const none = await t.json<ApiError>(`/v1/statements/${line("M-014")}`);
    expect(none.status).toBe(401);
    expect(none.body.code).toBe("UNAUTHENTICATED");

    const other = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-007") });
    const r1 = await t.json<ApiError>(`/v1/statements/${line("M-014")}`, { as: t.credentials.bearer(other) });
    expect(r1.status).toBe(404);

    const brand = t.credentials.brandLink({ workspaceId: w.workspaceId });
    const r2 = await t.json<ApiError>(`/v1/statements/${line("M-014")}`, { as: t.credentials.bearer(brand) });
    expect(r2.status).toBe(403);
    expect(r2.body.code).toBe("FORBIDDEN");

    const member = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "member",
      persona: "M-007",
      memberId: memberId("M-007"),
    });
    const r3 = await t.json<ApiError>(`/v1/statements/${line("M-014")}`, {
      as: t.credentials.bearer(member),
    });
    expect(r3.status).toBe(403);

    const fx = await t.fixture();
    const outsider = await t.credentials.frameToken({ workspaceId: fx.workspaceId, role: "treasurer" });
    const r4 = await t.json<ApiError>(`/v1/statements/${line("M-014")}`, {
      as: t.credentials.bearer(outsider),
    });
    expect(r4.status).toBe(404);
    expect(r4.body.code).toBe("NOT_FOUND");
  });

  it("an expired link answers FRAME_TOKEN_EXPIRED, not a statement", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014"), ttlMs: 1 });
    t.clock.advance(1_000);
    const r = await t.json<ApiError>(`/v1/statements/${line("M-014")}`, { as: t.credentials.bearer(link) });
    expect(r.status).toBe(401);
    expect(r.body.code).toBe("FRAME_TOKEN_EXPIRED");
  });

  it("T1: the showcase's seeded readings take the demo AI_NOTE (chipped in Cebuano); the Claude claim never shows", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
    for (const lang of ["ceb", "fil", "en"] as const) {
      const r = await t.json<StatementView>(`/v1/statements/${line("M-014")}?lang=${lang}`, {
        as: t.credentials.bearer(link),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.plan.readingProvenance).toBe("seeded");
      const want = must(TEMPLATES_V1[lang]["AI_NOTE.seeded"]).replace("{{TREASURER}}", "Analyn");
      for (const s of [...r.body.display, ...r.body.spoken].filter((x) => x.slot === "AI_NOTE")) {
        expect(s.variant).toBe("seeded");
        expect(s.text).toBe(want);
      }
      expect(r.body.display.map((s) => s.text).join(" ")).not.toContain("AI (Claude)");
      expect(r.body.reviewChip).toBe(lang === "en" ? null : REVIEW_CHIP);
    }
  });

  it("T1: a line whose slips Claude read live keeps the product AI_NOTE (M-031)", async () => {
    const ownRows = and(
      eq(schema.slipRows.workspaceId, w.workspaceId),
      eq(schema.slipRows.memberId, memberId("M-031")),
    );
    await t.deps.db.update(schema.slipRows).set({ provenance: "live" }).where(ownRows);
    try {
      const token = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
      const r = await t.json<StatementView>(`/v1/statements/${line("M-031")}?lang=en`, {
        as: t.credentials.bearer(token),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.plan.readingProvenance).toBe("live");
      const note = must(r.body.display.find((s) => s.slot === "AI_NOTE"));
      expect(note.variant).toBe("default");
      expect(note.text).toBe(must(TEMPLATES_V1.en["AI_NOTE.default"]).replace("{{TREASURER}}", "Analyn"));
    } finally {
      await t.deps.db.update(schema.slipRows).set({ provenance: "seeded" }).where(ownRows);
    }
  });

  it("inv.i8.labels: rejected readings cannot change the member's reading provenance", async () => {
    const ownRows = and(
      eq(schema.slipRows.workspaceId, w.workspaceId),
      eq(schema.slipRows.memberId, memberId("M-014")),
    );
    const rows = await t.deps.db.select().from(schema.slipRows).where(ownRows);
    expect(rows.length).toBeGreaterThan(1);
    try {
      await t.deps.db.update(schema.slipRows).set({ provenance: "live" }).where(ownRows);
      await t.deps.db
        .update(schema.slipRows)
        .set({ state: "REJECTED", provenance: "seeded" })
        .where(eq(schema.slipRows.id, must(rows[0]).id));
      const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
      const r = await t.json<StatementView>(`/v1/statements/${line("M-014")}?lang=en`, {
        as: t.credentials.bearer(link),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.plan.readingProvenance).toBe("live");
      expect(r.body.display.find((s) => s.slot === "AI_NOTE")?.variant).toBe("default");
    } finally {
      for (const row of rows) {
        await t.deps.db
          .update(schema.slipRows)
          .set({ state: row.state, provenance: row.provenance })
          .where(eq(schema.slipRows.id, row.id));
      }
    }
  });

  it("inv.i8.labels: no own non-rejected reading means null provenance and the demo note", async () => {
    const ownRows = and(
      eq(schema.slipRows.workspaceId, w.workspaceId),
      eq(schema.slipRows.memberId, memberId("M-031")),
    );
    const rows = await t.deps.db.select().from(schema.slipRows).where(ownRows);
    expect(rows.length).toBeGreaterThan(0);
    try {
      await t.deps.db.update(schema.slipRows).set({ state: "REJECTED" }).where(ownRows);
      const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-031") });
      const r = await t.json<StatementView>(`/v1/statements/${line("M-031")}?lang=en`, {
        as: t.credentials.bearer(link),
      });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.plan.readingProvenance).toBeNull();
      expect(r.body.display.find((s) => s.slot === "AI_NOTE")?.variant).toBe("seeded");
    } finally {
      for (const row of rows) {
        await t.deps.db
          .update(schema.slipRows)
          .set({ state: row.state })
          .where(eq(schema.slipRows.id, row.id));
      }
    }
  });

  it("inv.i1.no-model-numbers: a stored sentence with a digit is never shown; the v1 words are", async () => {
    await t.deps.db.insert(schema.statements).values({
      workspaceId: w.workspaceId,
      lineId: line("M-039"),
      lang: "en",
      sentences: [{ id: "BONUS.default", text: "You earned a bonus of 21 dollars.", placeholders: [] }],
      smsText: null,
      provenance: "replay",
    });
    const token = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
    const r = await t.json<StatementView>(`/v1/statements/${line("M-039")}?lang=en`, {
      as: t.credentials.bearer(token),
    });
    const bonus = r.body.display.find((s) => s.slot === "BONUS")?.text;
    expect(bonus).toBe(`Quality bonus: ${format.money(must(getLine("M-039")).bonusCents)}.`);
    expect(bonus).not.toContain("21 dollars");
  });
});

describe("createReviewRequest (POST /v1/review-requests)", () => {
  async function memberToken(no: string) {
    return t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "member",
      persona: no,
      memberId: memberId(no),
    });
  }

  const noteSalt = (reviewRequestId: string) =>
    commitmentSalt(t.deps.credentials.keys, {
      purpose: "review.note",
      workspaceId: w.workspaceId,
      subjectId: reviewRequestId,
    });

  async function reviewEntries() {
    const rows = await t.deps.db
      .select({ seq: schema.ledgerEntries.seq, payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, w.workspaceId),
          eq(schema.ledgerEntries.kind, REVIEW_LEDGER_KIND),
        ),
      );
    return rows.map((r) => ({ seq: Number(r.seq), payload: r.payload as Record<string, unknown> }));
  }

  /** Advisory locks some session of this test database is waiting for. */
  async function waitingAdvisoryLocks(): Promise<number> {
    const rows = await t.deps.db.execute(
      sql`select count(*)::int as n from pg_locks
          where locktype = 'advisory' and not granted
            and database = (select oid from pg_database where datname = current_database())`,
    );
    return Number((rows[0] as { n: number }).n);
  }

  it("a member asks about their own line and a slip: 201, a row and a ledger entry with the note's hash only", async () => {
    const token = await memberToken("M-014");
    const slip = must(must(getLine("M-014")).slipSerials[0]);
    const note = "Ang 0403 kay 38.45 kg, palihug susiha.";
    const r = await t.json<{ reviewRequest: ReviewRequestDTO }>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-014"), slipSerial: slip, note },
      as: t.credentials.bearer(token),
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const dto = ReviewRequestDTO.parse(r.body.reviewRequest);
    expect(dto).toMatchObject({
      memberNo: "M-014",
      slipSerial: slip,
      note,
      state: "open",
      provenance: "live",
    });
    const entries = await t.deps.db
      .select()
      .from(schema.ledgerEntries)
      .where(
        and(
          eq(schema.ledgerEntries.workspaceId, w.workspaceId),
          eq(schema.ledgerEntries.kind, REVIEW_LEDGER_KIND),
        ),
      );
    const entry = entries.find((e) => (e.payload as { reviewRequestId?: string }).reviewRequestId === dto.id);
    // sha256(salt ‖ note) with a salt only this server can derive: checkable with plain sha256 once opened
    const salt = noteSalt(dto.id);
    expect(entry?.payload).toEqual({
      reviewRequestId: dto.id,
      runId: w.runId,
      lineId: line("M-014"),
      memberNo: "M-014",
      slipSerial: slip,
      noteSha256: createHash("sha256").update(salt).update(note, "utf8").digest("hex"),
    });
    expect(JSON.stringify(entry?.payload)).not.toContain("palihug");
    expect(entry?.actorId).toBe("member:M-014");
  });

  it("the public chain never carries a bare hash of a note: no dictionary opens it, equal notes do not link", async () => {
    const note = "Kulang ang timbang";
    const filed: string[] = [];
    for (const no of ["M-018", "M-033"]) {
      const r = await t.json<{ reviewRequest: ReviewRequestDTO }>("/v1/review-requests", {
        method: "POST",
        body: { lineId: line(no), note },
        as: t.credentials.bearer(await memberToken(no)),
      });
      expect(r.status).toBe(201);
      filed.push(r.body.reviewRequest.id);
    }
    const committed = (await reviewEntries())
      .filter((e) => filed.includes(e.payload.reviewRequestId as string))
      .map((e) => e.payload.noteSha256);
    expect(committed).toHaveLength(2);
    expect(committed).not.toContain(sha256Hex(note));
    expect(committed[0]).not.toBe(committed[1]);
    // the public Proof carries the entries, and nowhere the bare hash
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`);
    expect(JSON.stringify(r.body)).not.toContain(sha256Hex(note));
  });

  it("two concurrent requests (different Idempotency-Keys) file once: the workspace lock comes before the duplicate check", async () => {
    const token = await memberToken("M-039");
    const body = { lineId: line("M-039"), note: "Duha ka resibo sa 0412?" };
    let locked!: () => void;
    let release!: () => void;
    const held = new Promise<void>((r) => {
      locked = r;
    });
    const gate = new Promise<void>((r) => {
      release = r;
    });
    // Another writer holds the workspace lock, so both requests queue behind it at the same point.
    const holder = withWorkspaceTx(t.deps.db, w.workspaceId, async () => {
      locked();
      await gate;
    });
    await held;
    const post = (key: string) =>
      t.json<{ reviewRequest: ReviewRequestDTO }>("/v1/review-requests", {
        method: "POST",
        body,
        headers: { "idempotency-key": key },
        as: t.credentials.bearer(token),
      });
    const first = post("double-tap-1");
    const second = post("double-tap-2");
    await vi.waitFor(async () => expect(await waitingAdvisoryLocks()).toBe(2), { timeout: 10_000 });
    release();
    await holder;
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.body.reviewRequest.id).toBe(a.body.reviewRequest.id);
    const rows = await t.deps.db
      .select({ id: schema.reviewRequests.id })
      .from(schema.reviewRequests)
      .where(eq(schema.reviewRequests.lineId, line("M-039")));
    expect(rows).toHaveLength(1);
    const entries = (await reviewEntries()).filter(
      (e) => e.payload.reviewRequestId === a.body.reviewRequest.id,
    );
    expect(entries).toHaveLength(1);
  });

  it("a double tap files once (the identical open request comes back)", async () => {
    const token = await memberToken("M-007");
    const body = { lineId: line("M-007"), note: "Duha ka resibo 0457?" };
    const a = await t.json<{ reviewRequest: ReviewRequestDTO }>("/v1/review-requests", {
      method: "POST",
      body,
      as: t.credentials.bearer(token),
    });
    const b = await t.json<{ reviewRequest: ReviewRequestDTO }>("/v1/review-requests", {
      method: "POST",
      body,
      as: t.credentials.bearer(token),
    });
    expect(a.status).toBe(201);
    expect(b.body.reviewRequest.id).toBe(a.body.reviewRequest.id);
  });

  it("the chain grows with the request and the Proof still verifies over the new head", async () => {
    const link = t.credentials.brandLink({ workspaceId: w.workspaceId });
    const r = await t.json<unknown>(`/v1/proof/${w.runSlug}`, { as: t.credentials.bearer(link) });
    const { bundle } = ProofResponse.parse(r.body);
    expect(bundle.ledger.length).toBeGreaterThan(w.ledger.length);
    expect(bundle.ledger.at(-1)?.kind).toBe(REVIEW_LEDGER_KIND);
    const keys = await t.json<never>(`/.well-known/fairsplit-keys.json?run=${w.runSlug}`);
    expect(verifyChain(bundle, keys.body, { demoMode: true }).status).toBe("sample");
  });

  it("the treasurer may file on a member's behalf, and a judge acting as the member", async () => {
    const treasurer = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
    const r = await t.json<{ reviewRequest: ReviewRequestDTO }>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-053") },
      as: t.credentials.bearer(treasurer),
    });
    expect(r.status).toBe(201);
    expect(r.body.reviewRequest.note).toBeNull();
    const judge = t.credentials.judgeCookie({ workspaceId: w.workspaceId });
    const j = await t.json<{ reviewRequest: ReviewRequestDTO }>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-002"), note: "Gikan sa judge" },
      as: t.credentials.judge(judge),
    });
    expect(j.status).toBe(201);
  });

  it("FORBIDDEN: another member's line, and roles that receive requests (Chair, brand)", async () => {
    const token = await memberToken("M-022");
    const r = await t.json<ApiError>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-014") },
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("FORBIDDEN");
    for (const role of ["board", "brand"] as const) {
      const tk = await t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona: "x" });
      const x = await t.json<ApiError>("/v1/review-requests", {
        method: "POST",
        body: { lineId: line("M-014") },
        as: t.credentials.bearer(tk),
      });
      expect(x.status, role).toBe(403);
    }
  });

  it("NOT_FOUND: a line outside the credential's workspace (or none at all)", async () => {
    const fx = await t.fixture();
    const tk = await t.credentials.frameToken({ workspaceId: fx.workspaceId, role: "treasurer" });
    for (const lineId of [line("M-014"), "0192f8a0-0000-7000-8000-00000000dead"]) {
      const r = await t.json<ApiError>("/v1/review-requests", {
        method: "POST",
        body: { lineId },
        as: t.credentials.bearer(tk),
      });
      expect(r.status).toBe(404);
      expect(r.body.code).toBe("NOT_FOUND");
    }
  });

  it("VALIDATION_FAILED: a slip that is not on the line, and a note over 500 characters", async () => {
    const token = await memberToken("M-014");
    const r = await t.json<ApiError>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-014"), slipSerial: "0999" },
      as: t.credentials.bearer(token),
    });
    expect(r.status).toBe(400);
    expect(r.body).toMatchObject({
      code: "VALIDATION_FAILED",
      details: { issues: [{ path: "body.slipSerial" }] },
    });
    const long = await t.json<ApiError>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-014"), note: "x".repeat(501) },
      as: t.credentials.bearer(token),
    });
    expect(long.status).toBe(400);
  });

  it("a member link (read-only) cannot file; the shell answers 403, and 401 without a credential", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
    const r = await t.json<ApiError>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-014") },
      as: t.credentials.bearer(link),
    });
    expect(r.status).toBe(403);
    const none = await t.json<ApiError>("/v1/review-requests", {
      method: "POST",
      body: { lineId: line("M-014") },
    });
    expect(none.status).toBe(401);
  });

  it("RATE_LIMITED: at most 6 new requests a line an hour; re-sending an open one does not count", async () => {
    const token = await memberToken("M-060");
    const post = (note: string) =>
      t.json<ApiError & { reviewRequest?: ReviewRequestDTO }>("/v1/review-requests", {
        method: "POST",
        body: { lineId: line("M-060"), note },
        as: t.credentials.bearer(token),
      });
    for (let i = 1; i <= 6; i++) expect((await post(`Pangutana ${"x".repeat(i)}`)).status).toBe(201);
    expect((await post("Pangutana x")).status).toBe(201);
    const over = await post("Lain pa nga pangutana");
    expect(over.status).toBe(429);
    expect(over.body.code).toBe("RATE_LIMITED");
  });

  it("lists a line's requests for its member and the officers, each with the opening of its chain entry", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
    const r = await t.json<{ reviewRequests: ReviewRequestDTO[]; openings: ReviewOpening[] }>(
      `/v1/statements/${line("M-014")}/review-requests`,
      {
        as: t.credentials.bearer(link),
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.reviewRequests.map((x) => x.slipSerial)).toEqual([must(getLine("M-014")).slipSerials[0]]);
    // the member checks their request is on the public chain with plain sha256: salt ‖ note → the entry's hash
    const [req] = r.body.reviewRequests;
    const [opening] = r.body.openings;
    const entry = must((await reviewEntries()).find((e) => e.payload.reviewRequestId === must(req).id));
    expect(opening).toEqual({
      reviewRequestId: must(req).id,
      ledgerSeq: entry.seq,
      noteSha256: entry.payload.noteSha256,
      saltHex: noteSalt(must(req).id).toString("hex"),
    });
    const recomputed = createHash("sha256")
      .update(Buffer.from(must(opening?.saltHex), "hex"))
      .update(must(req?.note), "utf8")
      .digest("hex");
    expect(recomputed).toBe(entry.payload.noteSha256);
    // a request without a note has nothing to open
    const officer = await t.credentials.frameToken({ workspaceId: w.workspaceId, role: "treasurer" });
    const bare = await t.json<{ openings: ReviewOpening[] }>(
      `/v1/statements/${line("M-053")}/review-requests`,
      {
        as: t.credentials.bearer(officer),
      },
    );
    expect(bare.body.openings).toEqual([
      expect.objectContaining({ noteSha256: null, saltHex: null, ledgerSeq: expect.any(Number) }),
    ]);
  });
});

describe("the explain task", () => {
  it("inv.i7.outbox: records the template words a statement uses (no number), once per line and language", async () => {
    const args = { lineId: line("M-018"), lang: "fil" as const };
    const enq = await t.deps.db.transaction((tx) =>
      enqueue(tx, "explain", args, TASKS.explain.dedupeKey(args), { workspaceId: w.workspaceId }),
    );
    const again = await t.deps.db.transaction((tx) =>
      enqueue(tx, "explain", args, TASKS.explain.dedupeKey(args), { workspaceId: w.workspaceId }),
    );
    expect(again).toEqual({ id: enq.id, inserted: false });
    const out = await must(t.deps.outbox).runTask(enq.id);
    expect(out.outcome).toBe("done");
    const [row] = await t.deps.db
      .select()
      .from(schema.statements)
      .where(and(eq(schema.statements.lineId, line("M-018")), eq(schema.statements.lang, "fil")));
    const sentences = row?.sentences as { id: string; text: string; placeholders: string[] }[];
    expect(sentences.map((s) => s.id)).toContain("CREDIT.written");
    // T1: a seeded run records the demo AI_NOTE, the words its statement shows
    expect(sentences.map((s) => s.id)).toContain("AI_NOTE.seeded");
    expect(sentences.map((s) => s.id)).not.toContain("AI_NOTE.default");
    for (const s of sentences) {
      expect(s.text).not.toMatch(/\p{Nd}/u);
      expect(s.text).toBe(TEMPLATES_V1.fil[s.id]);
    }
    expect(row?.smsText).toBe(TEMPLATES_V1.fil["sms.paid"]);
  });
});
