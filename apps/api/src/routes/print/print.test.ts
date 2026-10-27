// The 80 mm print for a member's line (W-TR-09): exact pesos for cash at the run's rate, the ReceiptBar adding
// up to the net, the hashes, and a QR that is a real, read-only member link for exactly that line.
import type { ApiError } from "@fairsplit/contracts";
import { format, mulDivHalfUp } from "@fairsplit/domain";
import { getLine, getRun } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import type { PrintSlip } from "../../statements/print.js";
import type { StatementView } from "../../statements/view.js";
import { createTestApp, type TestApp } from "../../test/index.js";

let t: TestApp;
let w: ShowcaseWorld;
let treasurer: string;
const FX = getRun().fx.centavosPerCent;

beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
  w = await loadShowcase(t.deps.db);
  treasurer = await t.credentials.frameToken({
    workspaceId: w.workspaceId,
    role: "treasurer",
    persona: "analyn",
  });
});
afterAll(async () => t.close());

const path = (no: string, lang = "en") => `/v1/print/${w.runSlug}/members/${no}?lang=${lang}`;

describe("GET /v1/print/:runSlug/members/:memberNo", () => {
  it("prints Merlyn's cash line: exact pesos at the run's rate, the rate line, the Nadawat box", async () => {
    const r = await t.json<PrintSlip>(path("M-053"), { as: t.credentials.bearer(treasurer) });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const p = r.body;
    const line = must(getLine("M-053"));
    const exact = mulDivHalfUp(line.netCents, FX.num, FX.den);
    expect(p.paper).toBe("80mm");
    expect(p.amount?.php).toEqual({ centavos: exact, display: format.money(exact, "PHP"), exact: true });
    expect(p.amount?.rateLine).toBe(
      `From ${format.money(line.netCents)} at ${format.money(mulDivHalfUp(100, FX.num, FX.den), "PHP")} to the dollar`,
    );
    expect(p.line).toMatchObject({ state: "OFF_RAIL_DUE", pay: "cash", statusWords: "Ready at the bodega" });
    expect(p.nadawat).toEqual({ box: true, witnessLine: true, words: "Received" });
    expect(p.slips).toEqual(line.slipSerials);
    expect(p.rateCard.display).toBe(format.hashGroups(w.rateCardSha256));
    expect(p.seal.display).toBe(format.hashAllGroups(getRun().batchSha256));
    expect(JSON.stringify(p)).not.toMatch(/THUMBMARK|SIGNATURE/);
  });

  it("the ReceiptBar adds up to the net, deductions negative, in the member's language by default", async () => {
    const r = await t.json<PrintSlip>(`/v1/print/${w.runSlug}/members/M-022`, {
      as: t.credentials.bearer(treasurer),
    });
    const p = r.body;
    expect(p.member.lang).toBe("ceb");
    const net = must(p.receipt.find((s) => s.kind === "net"));
    const parts = p.receipt.filter((s) => s.kind !== "net").reduce((s, x) => s + x.amount.cents, 0);
    expect(parts).toBe(net.amount.cents);
    expect(net.amount.cents).toBe(must(getLine("M-022")).netCents);
    const loan = must(must(getLine("M-022")).deductions[0]);
    expect(p.receipt.find((s) => s.kind === "deduction")).toMatchObject({
      ruleId: loan.ruleId,
      amount: { cents: -loan.amountCents },
    });
  });

  it("the QR is a signed, read-only member link for exactly this line (a reprint rotates it)", async () => {
    const a = await t.json<PrintSlip>(path("M-014"), { as: t.credentials.bearer(treasurer) });
    const b = await t.json<PrintSlip>(path("M-014"), { as: t.credentials.bearer(treasurer) });
    expect(a.body.memberLink.url).toMatch(/^http:\/\/localhost:8787\/s\/fsm_/);
    expect(b.body.memberLink.url).not.toBe(a.body.memberLink.url);
    const token = a.body.memberLink.url.split("/s/")[1] as string;
    const own = await t.json<StatementView>(`/v1/statements/${w.lineIds.get("M-014")}`, {
      as: t.credentials.bearer(token),
    });
    expect(own.status).toBe(200);
    expect(own.body.memberNo).toBe("M-014");
    const other = await t.json<ApiError>(`/v1/statements/${w.lineIds.get("M-007")}`, {
      as: t.credentials.bearer(token),
    });
    expect(other.status).toBe(404);
    expect(a.body.amount?.php?.exact).toBe(false);
  });

  it("the clerk and a judge print too; a member, the brand: FORBIDDEN", async () => {
    const clerk = await t.credentials.frameToken({
      workspaceId: w.workspaceId,
      role: "clerk",
      persona: "jessie",
    });
    expect((await t.json(path("M-014"), { as: t.credentials.bearer(clerk) })).status).toBe(200);
    const judge = t.credentials.judgeCookie({ workspaceId: w.workspaceId });
    expect((await t.json(path("M-014"), { as: t.credentials.judge(judge) })).status).toBe(200);
    for (const role of ["member", "brand"] as const) {
      const tk = await t.credentials.frameToken({ workspaceId: w.workspaceId, role, persona: "x" });
      const r = await t.json<ApiError>(path("M-014"), { as: t.credentials.bearer(tk) });
      expect(r.status, role).toBe(403);
      expect(r.body.code).toBe("FORBIDDEN");
    }
  });

  it("NOT_FOUND: a member with no line in the run, a run in another workspace; 400 for a bad member number; 401 without a credential", async () => {
    const none = await t.json<ApiError>(path("M-099"), { as: t.credentials.bearer(treasurer) });
    expect(none.status).toBe(404);
    const fx = await t.fixture();
    const outsider = await t.credentials.frameToken({ workspaceId: fx.workspaceId, role: "treasurer" });
    expect((await t.json<ApiError>(path("M-014"), { as: t.credentials.bearer(outsider) })).status).toBe(404);
    const bad = await t.json<ApiError>(`/v1/print/${w.runSlug}/members/014`, {
      as: t.credentials.bearer(treasurer),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe("VALIDATION_FAILED");
    expect((await t.json<ApiError>(path("M-014"))).status).toBe(401);
  });
});
