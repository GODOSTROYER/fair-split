import { describe, expect, it } from "vitest";
import type { StatementDTO } from "../../_shims/api-client";
import { MEMBER_STATUS_WORDS } from "../../_shims/contracts";
import { capsuleFor, EMPTY_TRACK, type ItemTrack } from "../../lib/item-status";
import { mergeTrack } from "../../lib/statement";
import { buildDemoStatement, DEMO_STAGES, type DemoStage } from "../../services/demo-fixtures";
import { historyRows, lineView, sealSigners } from "./line-view";
import { messages, t } from "./messages";
import { previewLine } from "./preview";

const NOW = "2026-10-30T09:12:00+08:00";
const at = (stage: DemoStage) => buildDemoStatement({ stage, now: NOW, sentAt: "2026-10-30T09:00:00+08:00" });
const trackOf = (dto: StatementDTO): ItemTrack => mergeTrack(EMPTY_TRACK, dto.item);
const capsuleOf = (dto: StatementDTO, track = trackOf(dto)) =>
  capsuleFor({ lineState: dto.lineState, rail: dto.rail, itemStatus: track.status });
const view = (dto: StatementDTO, lang: "ceb" | "fil" | "en" = "ceb", track = trackOf(dto)) =>
  lineView(dto, capsuleOf(dto, track), track, lang);

describe("the statement for each demo stage (S1.9 states)", () => {
  it("checking: no amount yet, the kilos and the expected date stand in", () => {
    const v = view(at("checking"));
    expect(v.capsule).toBe("checking");
    expect(v.showAmount).toBe(false);
    expect(v.amountState).toBe("pencil");
    expect(v.word).toBe(MEMBER_STATUS_WORDS.HELD.ceb);
    expect(v.detail).toEqual({ key: "M-MB-01.checking" });
    expect(v.under).toBeNull();
  });

  it("sent: the amount is hollow and the capsule counts from the moment it went to PayPal", () => {
    const v = view(at("sent"));
    expect(v.capsule).toBe("sent");
    expect(v.amountState).toBe("hollow");
    expect(v.hero.amount).toBe("US$64.45");
    expect(v.under).toEqual({ text: "mga ₱4,028 (gibanabana)" });
    expect(v.sentAt).toBe("2026-10-30T09:00:00+08:00");
    expect(v.word).toBe("Gipadala na, naghulat sa PayPal");
  });

  it("paid: landed, dated by PayPal's confirmation, and PayPal is named as the one who confirmed", () => {
    const v = view(at("paid"), "en");
    expect(v.amountState).toBe("landed");
    expect(v.tone).toBe("landed");
    expect(v.word).toBe("Paid, 30 Oct");
    expect(v.detail).toEqual({ key: "M-MB-01.paid", args: { date: "30 Oct 2026", time: "09:12" } });
    expect(t("en", v.detail?.key ?? "M-MB-01.paid", v.detail?.args)).toBe(
      "PayPal confirmed the payment on 30 Oct 2026 at 09:12.",
    );
  });

  it("unclaimed: hollow, canary (a person decides), never a failure", () => {
    const v = view(at("unclaimed"));
    expect(v.amountState).toBe("hollow");
    expect(v.tone).toBe("decide");
    expect(v.detail?.key).toBe("M-MB-01.unclaimed");
  });

  it("cash due: exact pesos at the run's rate, hatched, with where and when", () => {
    const v = view(at("cash-due"), "ceb");
    expect(v.payKind).toBe("cash");
    expect(v.hero.amount).toBe("₱4,028.13");
    expect(v.amountState).toBe("hollow");
    expect(v.tone).toBe("cash");
    expect(v.word).toBe("Andam sa bodega, 30 Okt");
    expect(v.under).toEqual({
      key: "M-MB-01.cashDue",
      args: { usd: "US$64.45", rate: "₱62.50", date: "30 Okt" },
    });
    expect(t("ceb", "M-MB-01.cashDue", { usd: "US$64.45", rate: "₱62.50", date: "30 Okt" })).toBe(
      "Cash sa bodega, 30 Okt. Gikan sa US$64.45 sa ₱62.50 matag dolyar.",
    );
    expect(v.detail).toEqual({ key: "M-MB-01.cashMoved", args: { name: "Analyn" } });
  });

  it("cash received: attested, dated by the clerk's record", () => {
    const v = view(at("cash-received"), "fil");
    expect(v.amountState).toBe("attested");
    expect(v.word).toBe("Natanggap na po, 30 Okt");
    expect(v.under).toMatchObject({ key: "M-MB-01.cashReceived" });
  });

  it("every state has a sentence or a figure under it, and every key exists in the catalog", () => {
    for (const stage of DEMO_STAGES) {
      const v = view(at(stage));
      expect(v.detail !== null || v.under !== null).toBe(true);
      if (v.detail) expect(messages).toHaveProperty([v.detail.key]);
    }
    for (const line of ["HELD", "PAYPAL_HELD", "NEEDS_ACTION", "REVERSED", "RETURNED", "EXCLUDED"]) {
      const v = view(previewLine(at(line === "HELD" || line === "EXCLUDED" ? "checking" : "sent"), line));
      expect(v.detail, line).not.toBeNull();
      if (v.detail) expect(messages).toHaveProperty([v.detail.key]);
    }
  });

  it("a held line names who decides and by when", () => {
    const v = view(previewLine(at("checking"), "HELD"), "en");
    expect(v.capsule).toBe("held-line");
    expect(v.showAmount).toBe(false);
    expect(t("en", v.detail?.key ?? "M-MB-01.held", v.detail?.args)).toBe(
      "One line is still being checked. Treasurer Analyn decides by 30 Oct 2026.",
    );
  });

  it("PayPal failures are red and name PayPal; a reversal stays hollow (S2.2.1)", () => {
    const failed = view(previewLine(at("sent"), "NEEDS_ACTION"), "en");
    expect(failed.tone).toBe("failure");
    expect(t("en", failed.detail?.key ?? "M-MB-01.needsAction", failed.detail?.args)).toContain("PayPal");
    const reversed = view(previewLine(at("paid"), "REVERSED"));
    expect(reversed.amountState).toBe("hollow");
  });
});

describe("MM-1 is driven by item.updated, not by the clock", () => {
  it("a SUCCESS event on the track turns a sent line paid, landed, dated by the event", () => {
    const dto = at("sent");
    const track: ItemTrack = { status: "SUCCESS", updatedAt: "2026-10-30T01:20:00Z", seen: ["e9"] };
    const v = view(dto, "en", track);
    expect(v.capsule).toBe("paid");
    expect(v.amountState).toBe("landed");
    expect(v.paidAt).toBe("2026-10-30T01:20:00Z");
    expect(v.word).toBe("Paid, 30 Oct");
  });
});

describe("history in her words", () => {
  it("stamps people's decisions in ink, marks PayPal's confirmation in jade, oldest first", () => {
    const rows = historyRows(at("paid"), trackOf(at("paid")));
    expect(rows.map((r) => [r.kind, r.mark])).toEqual([
      ["approved", "stamps"],
      ["sent", "pencil"],
      ["paid", "jade"],
    ]);
    expect(rows[0]?.copy).toEqual({ key: "M-MB-01.historyApproved", args: { a: "AS", b: "EC" } });
  });

  it("shows a confirmation that arrived by event before the server's history caught up", () => {
    const dto = at("sent");
    const rows = historyRows(dto, { status: "SUCCESS", updatedAt: "2026-10-30T01:20:00Z", seen: [] });
    expect(rows.at(-1)).toMatchObject({ kind: "paid", at: "2026-10-30T01:20:00Z", mark: "jade" });
  });

  it("follows Rhea's path: parked, moved to cash, received with the clerk's stamp", () => {
    const rows = historyRows(at("cash-received"), trackOf(at("cash-received")));
    expect(rows.map((r) => r.kind)).toEqual(["approved", "sent", "unclaimed", "cash-due", "received"]);
    expect(rows.find((r) => r.kind === "unclaimed")?.mark).toBe("canary");
    expect(rows.find((r) => r.kind === "received")).toMatchObject({ mark: "stamps", by: ["JD"] });
  });

  it("names the two officers who closed the seal", () => {
    expect(sealSigners(at("paid"))).toEqual(["AS", "EC"]);
    expect(sealSigners(at("checking"))).toBeNull();
  });
});
