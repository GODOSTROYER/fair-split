// The 80 mm print for a member's line (W-TR-09): exact pesos for cash at the run's rate, the ReceiptBar adding
// up to the net, the hashes, and a QR that is a real, read-only member link for exactly that line.
import type { ApiError } from "@fairsplit/contracts";
import { appendLedger, systemScope } from "@fairsplit/db";
import { format, mulDivHalfUp } from "@fairsplit/domain";
import { getLine, getRun } from "@fairsplit/seed";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LINK_TTL_MS, verifyLink } from "../../credentials/verify/index.js";
import { loadShowcase, must, type ShowcaseWorld } from "../../proof/testing/world.js";
import {
  issueDayOf,
  LINK_REVOKED_KIND,
  PRINT_LINK_GENERATIONS,
  type PrintSlip,
  printLinkJti,
} from "../../statements/print.js";
import type { StatementView } from "../../statements/view.js";
import { createTestApp, setWorkspaceExpiry, type TestApp } from "../../test/index.js";

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
    expiresAt: new Date("2026-11-30T00:00:00.000Z"),
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

  it("the QR is a signed, read-only member link for exactly this line", async () => {
    const a = await t.json<PrintSlip>(path("M-014"), { as: t.credentials.bearer(treasurer) });
    expect(a.body.memberLink.url).toMatch(/^http:\/\/localhost:8787\/s\/fsm_/);
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

  // These two move the clock: they run last.
  it("reprinting never adds a credential: one link per line and issue day, named without being stored", async () => {
    const tokenOf = (p: PrintSlip) => p.memberLink.url.split("/s/")[1] as string;
    const a = await t.json<PrintSlip>(path("M-022"), { as: t.credentials.bearer(treasurer) });
    expect(a.status, JSON.stringify(a.body)).toBe(200);
    t.clock.advance(3 * 60 * 60_000);
    const b = await t.json<PrintSlip>(path("M-022"), { as: t.credentials.bearer(treasurer) });
    // the same day (Asia/Manila): the very same signed link, however often it is printed
    const day = issueDayOf(t.clock.now());
    expect(issueDayOf(new Date(a.body.printedAt))).toBe(day);
    expect(b.body.memberLink).toEqual(a.body.memberLink);
    const v = verifyLink(t.deps.credentials.keys.linkPublicKeyHex, tokenOf(a.body), t.clock.nowMs());
    if (!v.ok || v.payload.k !== "member") throw new Error("not a member link");
    expect(v.payload.lineId).toBe(w.lineIds.get("M-022"));
    // its id is a pure function of the line and the day: every link ever printed can be named for revocation
    expect(v.payload.jti).toBe(printLinkJti(t.deps.credentials.keys, w.workspaceId, v.payload.lineId, day));
    // valid 30 days from the start of the issue day (Manila, UTC+8), never longer
    const dayStartMs = Date.parse(`${day}T00:00:00.000+08:00`);
    expect(Date.parse(a.body.memberLink.expiresAt)).toBe(dayStartMs + LINK_TTL_MS);
    // the next day prints the next day's link
    t.clock.advance(24 * 60 * 60_000);
    const c = await t.json<PrintSlip>(path("M-022"), { as: t.credentials.bearer(treasurer) });
    expect(c.body.memberLink.url).not.toBe(a.body.memberLink.url);
    expect(Date.parse(c.body.memberLink.expiresAt)).toBe(dayStartMs + 24 * 60 * 60_000 + LINK_TTL_MS);
  });

  it("a printed link never outlives its workspace (a judge session's prints end with the session)", async () => {
    const ends = new Date(t.clock.nowMs() + 6 * 60 * 60_000 + 123);
    // the database never moves an expiry earlier or clears it: set and restore it with the guard off
    const setExpiry = (at: Date | null) => setWorkspaceExpiry(must(t.pg).owner.sql, w.workspaceId, at);
    await setExpiry(ends);
    try {
      const r = await t.json<PrintSlip>(path("M-014"), { as: t.credentials.bearer(treasurer) });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.memberLink.expiresAt).toBe(
        new Date(Math.floor(ends.getTime() / 1000) * 1000).toISOString(),
      );
    } finally {
      await setExpiry(null);
    }
  });

  it("a revoked printed link is replaced by the day's next one, which every later print that day carries", async () => {
    const lineId = must(w.lineIds.get("M-007"));
    const day = issueDayOf(t.clock.now());
    const jtiOf = (p: PrintSlip) => {
      const v = verifyLink(
        t.deps.credentials.keys.linkPublicKeyHex,
        p.memberLink.url.split("/s/")[1] as string,
        t.clock.nowMs(),
      );
      if (!v.ok) throw new Error(`not a link: ${v.reason}`);
      return v.payload.jti;
    };
    const first = await t.json<PrintSlip>(path("M-007"), { as: t.credentials.bearer(treasurer) });
    expect(jtiOf(first.body)).toBe(printLinkJti(t.deps.credentials.keys, w.workspaceId, lineId, day, 0));
    // revoked the way the judge slice's revokeLink records it: a ledger entry naming the jti
    await appendLedger(t.deps.db, systemScope(w.workspaceId), {
      kind: LINK_REVOKED_KIND,
      payload: { jti: jtiOf(first.body) },
    });
    const second = await t.json<PrintSlip>(path("M-007"), { as: t.credentials.bearer(treasurer) });
    expect(second.body.memberLink.url).not.toBe(first.body.memberLink.url);
    expect(jtiOf(second.body)).toBe(printLinkJti(t.deps.credentials.keys, w.workspaceId, lineId, day, 1));
    const third = await t.json<PrintSlip>(path("M-007"), { as: t.credentials.bearer(treasurer) });
    expect(third.body.memberLink).toEqual(second.body.memberLink);
  });

  it("RATE_LIMITED until tomorrow once every printed link of the day was revoked (fresh links are bounded)", async () => {
    const lineId = must(w.lineIds.get("M-060"));
    const day = issueDayOf(t.clock.now());
    for (let n = 0; n < PRINT_LINK_GENERATIONS; n++) {
      await appendLedger(t.deps.db, systemScope(w.workspaceId), {
        kind: LINK_REVOKED_KIND,
        payload: { jti: printLinkJti(t.deps.credentials.keys, w.workspaceId, lineId, day, n) },
      });
    }
    const r = await t.json<ApiError>(path("M-060"), { as: t.credentials.bearer(treasurer) });
    expect(r.status).toBe(429);
    expect(r.body.code).toBe("RATE_LIMITED");
    const nextDay = Date.parse(`${day}T00:00:00.000+08:00`) + 24 * 60 * 60_000;
    expect(Number(r.headers.get("retry-after"))).toBe(Math.ceil((nextDay - t.clock.nowMs()) / 1000));
  });
});
