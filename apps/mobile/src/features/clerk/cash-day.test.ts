import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { format } from "../../_shims/domain";
import { fx } from "../../_shims/seed";
import { type CaptureRecord, MANUAL_ONLY } from "../../lib/outbox";
import {
  type CashLineDTO,
  initialsOf,
  isCashDayOpen,
  localOf,
  matchesMember,
  memberStatusOf,
  mergeRoster,
  normalise,
  rosterCounts,
  searchRoster,
} from "./cash-day";
import {
  CASH_DAY_PATH,
  cashDayToday,
  demoCashPort,
  demoLineId,
  httpCashPort,
  parseCashDay,
} from "./cash-port";

const NOW = Date.parse("2026-10-30T02:00:00Z"); // 10:00 in Calinan, cash day

function line(memberNo: string, over: Partial<CashLineDTO> = {}): CashLineDTO {
  return {
    lineId: `line_${memberNo}`,
    memberNo,
    name: `Member ${memberNo}`,
    cents: 1000,
    lineState: "OFF_RAIL_DUE",
    movedFromPayPal: false,
    receivedAt: null,
    receivedBy: null,
    ...over,
  };
}

function receipt(lineId: string, over: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    id: `0190f0f0-0000-7000-8000-${lineId.slice(-6).replace(/\D/g, "0").padStart(12, "0")}`,
    kind: "nadawat",
    sha256: "e".repeat(64),
    fileUri: "file:///n.jpg",
    thumbUri: null,
    mime: "image/jpeg",
    bytes: 1,
    width: 1,
    height: 1,
    station: "Bodega",
    memberHint: null,
    source: "camera",
    nadawat: { lineId, memberNo: "M-x", memberName: "x", cents: 1, phpPerUsd: "62.50", attestedBy: "JD" },
    createdAt: NOW - 1000,
    state: "queued",
    attempts: 0,
    nextAttemptAt: NOW,
    lastError: null,
    progress: 0,
    documentId: null,
    duplicateOf: null,
    rowsRead: null,
    serial: null,
    uploadedAt: null,
    ...over,
  };
}

describe("the cash list", () => {
  it("counts this phone's receipt at once, says where it is, and never moves a received line back", () => {
    const lines = [
      line("M-053"),
      line("M-031", { movedFromPayPal: true }),
      line("M-014", { lineState: "OFF_RAIL_PAID", receivedAt: "2026-10-30T01:00:00Z", receivedBy: "AS" }),
      line("M-002", { lineState: "HELD" }),
      line("M-060"),
    ];
    const roster = mergeRoster(lines, [
      receipt("line_M-053", { state: "uploading" }),
      receipt("line_M-060", { state: "failed", nextAttemptAt: MANUAL_ONLY, lastError: "LINE_NOT_DUE" }),
      receipt("line_M-014", { state: "uploaded" }),
    ]);
    expect(roster.map((e) => [e.line.memberNo, e.status, e.local])).toEqual([
      ["M-031", "due", "none"],
      ["M-060", "due", "refused"], // a refused receipt does not count
      ["M-002", "blocked", "none"],
      ["M-014", "received", "sent"],
      ["M-053", "received", "sending"],
    ]);
    const m014 = roster.find((e) => e.line.memberNo === "M-014");
    expect(m014).toMatchObject({ receivedBy: "AS", receivedAt: Date.parse("2026-10-30T01:00:00Z") });
    const m053 = roster.find((e) => e.line.memberNo === "M-053");
    expect(m053).toMatchObject({ receivedBy: "JD", receivedAt: NOW - 1000 });
    expect(rosterCounts(roster)).toEqual({ due: 2, received: 2, blocked: 1, total: 5 });
  });

  it("uses the member's own status words, never a raw state", () => {
    const [due, received, held, excluded] = mergeRoster(
      [
        line("M-001"),
        line("M-002", { lineState: "OFF_RAIL_PAID" }),
        line("M-003", { lineState: "READY" }),
        line("M-004", { lineState: "EXCLUDED" }),
      ],
      [],
    ).sort((a, b) => (a.line.memberNo < b.line.memberNo ? -1 : 1));
    expect([due, received, held, excluded].map((e) => e && memberStatusOf(e))).toEqual([
      "OFF_RAIL_DUE",
      "OFF_RAIL_PAID",
      "HELD",
      "EXCLUDED",
    ]);
  });

  it("knows where each receipt lives", () => {
    expect(localOf(null)).toBe("none");
    expect(localOf(receipt("l"))).toBe("on-phone");
    expect(localOf(receipt("l", { state: "failed", nextAttemptAt: NOW + 1 }))).toBe("on-phone");
    expect(localOf(receipt("l", { state: "uploading" }))).toBe("sending");
    expect(localOf(receipt("l", { state: "uploaded" }))).toBe("sent");
    expect(localOf(receipt("l", { state: "failed", nextAttemptAt: MANUAL_ONLY }))).toBe("refused");
  });

  it("opens on cash day in Calinan, whatever the phone's zone", () => {
    const day = "2026-10-30T08:00:00+08:00";
    expect(isCashDayOpen(day, Date.parse("2026-10-29T15:59:00Z"))).toBe(false); // 23:59 the day before
    expect(isCashDayOpen(day, Date.parse("2026-10-29T16:00:00Z"))).toBe(true); // 00:00 on the day
    expect(isCashDayOpen(day, NOW + 86_400_000)).toBe(true);
    expect(isCashDayOpen("not a date", NOW)).toBe(false);
  });
});

describe("finding a member", () => {
  const merlyn = { memberNo: "M-053", name: "Merlyn Ponce" };
  const tidoy = { memberNo: "M-018", name: "Teodoro Pacaña" };

  it("by number, however it is typed", () => {
    for (const q of ["53", "053", "M-053", "m53", "m 53", "5", "05"])
      expect(matchesMember(merlyn, q)).toBe(true);
    for (const q of ["54", "0531", "M-18"]) expect(matchesMember(merlyn, q)).toBe(false);
  });

  it("by any words of the name, without accents, in any order", () => {
    for (const q of ["mer", "Ponce", "pon mer", "  MERLYN  "]) expect(matchesMember(merlyn, q)).toBe(true);
    expect(matchesMember(tidoy, "pacana")).toBe(true);
    expect(matchesMember(tidoy, "Pacaña teo")).toBe(true);
    expect(matchesMember(merlyn, "ponce x")).toBe(false);
    expect(matchesMember(merlyn, "")).toBe(true);
    expect(normalise(" Nang  Célíng ")).toBe("nang celing");
  });

  it("filters a roster", () => {
    const roster = mergeRoster(
      [line("M-053", { name: "Merlyn Ponce" }), line("M-031", { name: "Rhea Jumawan" })],
      [],
    );
    expect(searchRoster(roster, "rhea").map((e) => e.line.memberNo)).toEqual(["M-031"]);
    expect(searchRoster(roster, "")).toHaveLength(2);
  });

  it("stamps with the clerk's initials", () => {
    expect(initialsOf("Jessie D. Dumaguing")).toBe("JD");
    expect(initialsOf("  analyn   r. sumalinog ")).toBe("AS");
    expect(initialsOf("Jessie")).toBe("J");
    expect(initialsOf("")).toBe("?");
  });
});

describe("the demo cash list", () => {
  it("holds the named cash members, exact pesos at the run rate, and today as cash day", async () => {
    const port = demoCashPort({ now: () => NOW, stage: () => "checking" });
    const r = await port.load();
    if (!r.ok) throw new Error("demo failed");
    expect(r.value.cashDay).toBe("2026-10-30T08:00:00+08:00");
    expect(isCashDayOpen(r.value.cashDay, NOW)).toBe(true);
    expect(r.value.provenance).toBe("seeded");
    expect(r.value.lines.map((l) => [l.memberNo, l.lineState, l.movedFromPayPal])).toEqual([
      ["M-053", "OFF_RAIL_DUE", false],
      ["M-031", "OFF_RAIL_DUE", true],
    ]);
    const merlyn = r.value.lines[0];
    expect(merlyn && format.cashPesos(merlyn.cents, r.value.phpPerUsd)).toBe("₱7,990.00"); // register §2
    expect(r.value.phpPerUsd).toBe(fx.phpPerUsd);
  });

  it("follows the demo's storyline for the hero line, and records receipts", async () => {
    let stage: "cash-due" | "cash-received" = "cash-due";
    const port = demoCashPort({ now: () => NOW, stage: () => stage });
    const due = await port.load();
    expect(due.ok && due.value.lines.map((l) => l.memberNo)).toEqual(["M-053", "M-031", "M-014"]);
    port.record(demoLineId("M-053"), NOW, "JD");
    port.record(demoLineId("M-053"), NOW + 5, "XX"); // first record wins
    stage = "cash-received";
    const after = await port.load();
    if (!after.ok) throw new Error("demo failed");
    expect(after.value.lines.find((l) => l.memberNo === "M-053")).toMatchObject({
      lineState: "OFF_RAIL_PAID",
      receivedBy: "JD",
      receivedAt: new Date(NOW).toISOString(),
    });
    expect(after.value.lines.find((l) => l.memberNo === "M-014")).toMatchObject({
      lineState: "OFF_RAIL_PAID",
      receivedBy: "JD",
    });
    expect(demoLineId("M-014")).toBe("line_2026A_r37_M-014");
    expect(cashDayToday(Date.parse("2026-10-30T17:00:00Z"))).toBe("2026-10-31T08:00:00+08:00");
  });
});

/* ------------------------------------------------------------------ the live cash list, against msw */

const ORIGIN = "https://fs-api.test";
let reply: () => Response = () => HttpResponse.json({});
let auth: string | null = null;
const server = setupServer(
  http.get(`${ORIGIN}${CASH_DAY_PATH}`, ({ request }) => {
    auth = request.headers.get("authorization");
    return reply();
  }),
);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  auth = null;
});
afterAll(() => server.close());

describe("the live cash list (msw)", () => {
  const port = httpCashPort({ origin: `${ORIGIN}/`, getBearer: () => "dev_token_for_tests" });

  it("loads and validates the list, dropping a malformed line rather than guessing", async () => {
    reply = () =>
      HttpResponse.json({
        runSlug: "2026A-r37",
        cashDay: "2026-10-30T08:00:00+08:00",
        phpPerUsd: "62.50",
        provenance: "live",
        lines: [
          line("M-053", { name: "Merlyn Ponce", cents: 12784 }),
          { ...line("M-999"), cents: 12.5 },
          { ...line("M-998"), lineState: "PAID_MAYBE" },
          { lineId: "x" },
        ],
      });
    const r = await port.load();
    expect(auth).toBe("Bearer dev_token_for_tests");
    expect(r.ok && r.value.lines.map((l) => l.memberNo)).toEqual(["M-053"]);
  });

  it("maps failures to codes the screen can word", async () => {
    reply = () => new HttpResponse(null, { status: 401 });
    expect(await port.load()).toEqual({ ok: false, code: "UNAUTHENTICATED", status: 401 });
    reply = () => new HttpResponse(null, { status: 429 });
    expect(await port.load()).toEqual({ ok: false, code: "RATE_LIMITED", status: 429 });
    reply = () => new HttpResponse("<html>portal</html>", { status: 200 });
    expect(await port.load()).toMatchObject({ ok: false, code: "NETWORK" });
    reply = () => HttpResponse.json({ runSlug: "x", cashDay: "nope", phpPerUsd: "62.50", lines: [] });
    expect(await port.load()).toMatchObject({ ok: false, code: "NETWORK" });
  });

  it("parses only what it can trust", () => {
    expect(parseCashDay(null)).toBeNull();
    expect(parseCashDay({ runSlug: "r", cashDay: "2026-10-30", phpPerUsd: "62.5.0", lines: [] })).toBeNull();
    expect(parseCashDay({ runSlug: "r", cashDay: "2026-10-30", phpPerUsd: "62.50", lines: "x" })).toBeNull();
    expect(
      parseCashDay({ runSlug: "r", cashDay: "2026-10-30", phpPerUsd: "62.50", lines: [] }),
    ).toMatchObject({
      provenance: "live",
      lines: [],
    });
  });
});
