// Statements and re-check requests at the HTTP boundary, on embedded Postgres with the seed's showcase run:
// who may read a statement, createReviewRequest with every listed error, the ledger entry it appends in the same
// transaction (and the Proof still verifies after it), and the `explain` task through the real outbox.
import { type ApiError, ProofResponse, ReviewRequestDTO, TASKS } from "@fairsplit/contracts";
import { schema } from "@fairsplit/db";
import { format, verifyChain } from "@fairsplit/domain";
import { enqueue } from "@fairsplit/outbox";
import { getLine, getMember } from "@fairsplit/seed";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import { noteSha256, REVIEW_LEDGER_KIND } from "../../statements/review.js";
import { TEMPLATES_V1 } from "../../statements/templates.js";
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
    expect(v.statusWords).toBe("Bayad na");
    expect(v.reviewChip).toBe("Machine-translated, pending native review");
    expect(v.amount?.usd.display).toBe(format.money(must(getLine("M-014")).netCents));
    expect(v.amount?.php?.exact).toBe(false);
    expect(v.display[0]?.text).toContain(must(getMember("M-014")).addressAs.ceb);
    expect(v.sms.label).toBe("Preview, not sent");
    expect(v.provenance).toBe("seeded");
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
    expect(entry?.payload).toEqual({
      reviewRequestId: dto.id,
      runId: w.runId,
      lineId: line("M-014"),
      memberNo: "M-014",
      slipSerial: slip,
      noteSha256: noteSha256(note),
    });
    expect(JSON.stringify(entry?.payload)).not.toContain("palihug");
    expect(entry?.actorId).toBe("member:M-014");
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

  it("lists a line's requests for its member and the officers", async () => {
    const link = t.credentials.memberLink({ workspaceId: w.workspaceId, lineId: line("M-014") });
    const r = await t.json<{ reviewRequests: ReviewRequestDTO[] }>(
      `/v1/statements/${line("M-014")}/review-requests`,
      {
        as: t.credentials.bearer(link),
      },
    );
    expect(r.status).toBe(200);
    expect(r.body.reviewRequests.map((x) => x.slipSerial)).toEqual([must(getLine("M-014")).slipSerials[0]]);
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
    for (const s of sentences) {
      expect(s.text).not.toMatch(/\p{Nd}/u);
      expect(s.text).toBe(TEMPLATES_V1.fil[s.id]);
    }
    expect(row?.smsText).toBe(TEMPLATES_V1.fil["sms.paid"]);
  });
});
