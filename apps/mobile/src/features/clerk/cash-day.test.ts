import { HttpResponse, http } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { format } from "../../_shims/domain";
import { cashDayIso, fx } from "../../_shims/seed";
import { type CaptureRecord, MANUAL_ONLY } from "../../lib/outbox";
import { buildDemoStatement, DEMO_STAGES, type DemoStage } from "../../services/demo-fixtures";
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
  demoCashOpen,
  demoCashPort,
  demoCashStory,
  demoLineId,
  httpCashPort,
  parseCashDay,
} from "./cash-port";
import { DEMO_STATION } from "./clerk-site";

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
    filedBy: { persona: "clerk:jessie", name: "Jessie Dela Cruz", pairing: "pairing-jessie-1" },
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

  it("stamps with the clerk's initials, and never with a placeholder", () => {
    expect(initialsOf("Jessie D. Dumaguing")).toBe("JD");
    expect(initialsOf("  analyn   r. sumalinog ")).toBe("AS");
    expect(initialsOf("Jessie")).toBe("J");
    expect(initialsOf("")).toBeNull();
    expect(initialsOf(" 42 . ")).toBeNull();
  });
});

describe("the demo cash list", () => {
  /** What the clerk frame shows at a stage: member, the member's own status, and whether receipts can be filed. */
  async function at(stage: DemoStage) {
    const port = demoCashPort({ stage: () => stage });
    const r = await port.load();
    if (r.kind !== "list") throw new Error("the demo always has a list");
    const roster = mergeRoster(r.day.lines, []);
    return {
      day: r.day,
      open: port.isOpen(r.day, NOW),
      lines: roster.map((e) => [e.line.memberNo, memberStatusOf(e), e.line.movedFromPayPal] as const),
    };
  }

  it("keeps the cash day the member's statement shows (30 Oct), whatever today is", async () => {
    for (const stage of DEMO_STAGES) {
      const { day } = await at(stage);
      expect(day.cashDay).toBe(cashDayIso);
      expect(day.cashDay).toBe(buildDemoStatement({ stage, now: new Date(NOW).toISOString() }).cashDay);
      expect(day.provenance).toBe("seeded");
      expect(day.phpPerUsd).toBe(fx.phpPerUsd);
    }
    expect(cashDayIso).toBe("2026-10-30T08:00:00+08:00");
  });

  it("follows the demo's story: still checking before both keys, due once approved, the bodega's day after", async () => {
    expect(await at("checking")).toMatchObject({ open: false, lines: [["M-053", "HELD", false]] });
    for (const stage of ["sent", "paid", "unclaimed"] as const) {
      // Approved, but cash day is not here yet: the receipt is hatched "Available on cash day, 30 Oct".
      expect(await at(stage)).toMatchObject({ open: false, lines: [["M-053", "OFF_RAIL_DUE", false]] });
    }
    expect(await at("cash-due")).toMatchObject({
      open: true,
      lines: [
        ["M-014", "OFF_RAIL_DUE", true],
        ["M-031", "OFF_RAIL_DUE", true],
        ["M-053", "OFF_RAIL_DUE", false],
      ],
    });
    expect((await at("cash-received")).lines).toContainEqual(["M-014", "OFF_RAIL_PAID", true]);
    expect(demoCashOpen(null)).toBe(false);
    expect(demoCashStory(null)).toEqual(demoCashStory("checking"));
  });

  it("gives Merlyn her exact pesos at the run rate (register §2), and names the demo station and treasurer", async () => {
    const { day } = await at("sent");
    const merlyn = day.lines[0];
    expect(merlyn && format.cashPesos(merlyn.cents, day.phpPerUsd)).toBe("₱7,990.00");
    expect(day.station).toBe(DEMO_STATION);
    expect(day.treasurer).toEqual({ first: "Analyn" });
  });

  it("records this phone's receipts once the line is at the bodega, first record wins", async () => {
    let stage: DemoStage = "checking";
    const port = demoCashPort({ stage: () => stage });
    port.record(demoLineId("M-053"), NOW, "JD");
    const held = await port.load();
    expect(held.kind === "list" && held.day.lines[0]?.lineState).toBe("READY"); // a held line is never "received"
    stage = "cash-due";
    port.record(demoLineId("M-053"), NOW + 5, "XX");
    port.record(demoLineId("M-014"), NOW + 7, "JD");
    stage = "cash-received";
    const after = await port.load();
    if (after.kind !== "list") throw new Error("the demo always has a list");
    expect(after.day.lines.find((l) => l.memberNo === "M-053")).toMatchObject({
      lineState: "OFF_RAIL_PAID",
      receivedBy: "JD",
      receivedAt: new Date(NOW).toISOString(),
    });
    expect(after.day.lines.find((l) => l.memberNo === "M-014")).toMatchObject({
      lineState: "OFF_RAIL_PAID",
      receivedBy: "JD",
      receivedAt: new Date(NOW + 7).toISOString(), // the clerk's own time, kept after the story moves on
    });
    expect(demoLineId("M-014")).toBe("line_2026A_r37_M-014");
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
        station: " Bodega ",
        treasurer: { first: "Analyn" },
        lines: [
          line("M-053", { name: "Merlyn Ponce", cents: 12784 }),
          { ...line("M-999"), cents: 12.5 },
          { ...line("M-998"), lineState: "PAID_MAYBE" },
          { lineId: "x" },
        ],
      });
    const r = await port.load();
    expect(auth).toBe("Bearer dev_token_for_tests");
    if (r.kind !== "list") throw new Error(`expected a list, got ${r.kind}`);
    expect(r.day.lines.map((l) => l.memberNo)).toEqual(["M-053"]);
    expect(r.day).toMatchObject({ station: "Bodega", treasurer: { first: "Analyn" } });
    expect(port.isOpen(r.day, NOW)).toBe(true);
    expect(port.isOpen(r.day, Date.parse("2026-10-29T12:00:00Z"))).toBe(false);
  });

  it("reads no list (404, 501, 204) as nothing to pay at the bodega, never as a failure", async () => {
    for (const status of [404, 501, 204, 405, 410]) {
      reply = () => new HttpResponse(null, { status });
      expect(await port.load()).toEqual({ kind: "none" });
    }
    reply = () => HttpResponse.json({ error: { code: "NOT_FOUND" } }, { status: 404 });
    expect(await port.load()).toEqual({ kind: "none" });
  });

  it("words real failures: the network, the server, the rate limit, a pairing, a captive portal", async () => {
    reply = () => new HttpResponse(null, { status: 503 });
    expect(await port.load()).toEqual({ kind: "error", code: "SERVER", status: 503 });
    reply = () => new HttpResponse(null, { status: 401 });
    expect(await port.load()).toEqual({ kind: "error", code: "UNAUTHENTICATED", status: 401 });
    reply = () => new HttpResponse(null, { status: 403 });
    expect(await port.load()).toEqual({ kind: "error", code: "UNAUTHENTICATED", status: 403 });
    reply = () => new HttpResponse(null, { status: 429 });
    expect(await port.load()).toEqual({ kind: "error", code: "RATE_LIMITED", status: 429 });
    reply = () => new HttpResponse("<html>portal</html>", { status: 200 });
    expect(await port.load()).toMatchObject({ kind: "error", code: "BAD_RESPONSE" });
    reply = () => HttpResponse.json({ runSlug: "x", cashDay: "nope", phpPerUsd: "62.50", lines: [] });
    expect(await port.load()).toMatchObject({ kind: "error", code: "BAD_RESPONSE" });
    reply = () => HttpResponse.error();
    expect(await port.load()).toEqual({ kind: "error", code: "NETWORK" });
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
      station: null,
      treasurer: null,
    });
    expect(
      parseCashDay({
        runSlug: "r",
        cashDay: "2026-10-30",
        phpPerUsd: "62.50",
        lines: [],
        station: "  ",
        treasurer: { first: "" },
      }),
    ).toMatchObject({ station: null, treasurer: null });
  });
});
