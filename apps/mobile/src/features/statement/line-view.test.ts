import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { StatementDTO } from "../../_shims/api-client";
import { type AmountState, LANGS, MEMBER_STATUS_WORDS } from "../../_shims/contracts";
import { MOMENTS } from "../../_shims/moments";
import {
  CAPSULE_WORD,
  type CapsuleState,
  capsuleFor,
  EMPTY_TRACK,
  type ItemTrack,
} from "../../lib/item-status";
import { mergeTrack } from "../../lib/statement";
import { buildDemoStatement, DEMO_STAGES, type DemoStage } from "../../services/demo-fixtures";
import {
  capsuleText,
  elapsedClock,
  historyRows,
  lineView,
  msOf,
  receiptStates,
  runAmountState,
  sealSigners,
} from "./line-view";
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
    expect(failed.word).toBe("PayPal didn't complete it");
    expect(t("en", failed.detail?.key ?? "M-MB-01.needsAction", failed.detail?.args)).toContain("Analyn");
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
    expect(v.fillsOnPress).toBe(true);
    expect(v.paidAt).toBe("2026-10-30T01:20:00Z");
    expect(v.word).toBe("Paid, 30 Oct");
  });
});

describe("MM-1 keeps the words PayPal pressed until the label crossfades (design §7 M1)", () => {
  // Sent at 09:00:00 Manila; PayPal's SUCCESS 14 s later.
  const sent = at("sent");
  const pressedAt = "2026-10-30T01:00:14Z";
  const pressed: ItemTrack = { status: "SUCCESS", updatedAt: pressedAt, seen: ["e9"] };
  const clock = elapsedClock(msOf(sent.history.find((h) => h.kind === "sent")?.at ?? null), msOf(pressedAt));

  it("the clock reads the time PayPal took, stopped where PayPal pressed it", () => {
    expect(clock).toBe("0:14");
    expect(elapsedClock(null, msOf(pressedAt))).toBeNull();
    expect(elapsedClock(msOf(pressedAt), null)).toBeNull();
    // A phone clock behind the server's never shows a negative wait.
    expect(elapsedClock(msOf(pressedAt), msOf("2026-10-30T01:00:10Z"))).toBe("0:00");
    expect(msOf("not a time")).toBeNull();
  });

  it("while the item waits for PayPal, the plate carries its words and the running clock", () => {
    const v = view(sent, "ceb");
    expect(v.sentWord).toBe("Gipadala na, naghulat sa PayPal");
    expect(capsuleText(v, { phase: "pending", swapped: false }, "0:13")).toEqual({
      before: { word: "Gipadala na, naghulat sa PayPal", clock: "0:13" },
      after: null,
    });
  });

  it("the before layer is never empty while the plate is pressed, flooded and filled", () => {
    for (const lang of LANGS) {
      const v = view(sent, lang, pressed);
      expect(v.capsule).toBe("paid");
      // The label crossfade starts at 400 ms: until it ends on screen, `swap` is below 1.
      for (const phase of ["pending", "press", "flood", "fill", "label", "invite"] as const) {
        const text = capsuleText(v, { phase, swapped: false }, clock);
        expect(text.before?.word, `${lang} ${phase}`).toBe(MEMBER_STATUS_WORDS.PAYPAL_PENDING[lang]);
        expect(text.before?.clock, `${lang} ${phase}`).toBe("0:14");
        expect(text.after).toBe(v.word);
      }
    }
    const v = view(sent, "ceb", pressed);
    expect(capsuleText(v, { phase: "flood", swapped: false }, clock).after).toBe("Bayad na, 30 Okt");
    // Reduced motion crossfades the label at once: the words stay until the moment is done, if invisible.
    expect(capsuleText(v, { phase: "fill", swapped: true }, clock).before).not.toBeNull();
  });

  it("the old words leave only when the moment is done and the crossfade has finished on screen", () => {
    const v = view(sent, "ceb", pressed);
    expect(capsuleText(v, { phase: "done", swapped: true }, clock)).toEqual({
      before: null,
      after: "Bayad na, 30 Okt",
    });
    // A late frame (a busy phone, a background tab): the moment's clock says done, the label is still fading in.
    expect(capsuleText(v, { phase: "done", swapped: false }, clock).before?.word).toBe(
      "Gipadala na, naghulat sa PayPal",
    );
    expect(capsuleText(view(at("paid"), "ceb"), { phase: "done", swapped: true }, null).before).toBeNull();
  });

  it("covers every MM-1 phase, and only the capsules MM-1 presses carry the words", () => {
    const v = view(sent, "en", pressed);
    for (const phase of MOMENTS["MM-1"]) {
      for (const swapped of [false, true]) {
        expect(capsuleText(v, { phase, swapped }, clock).after).toBe("Paid, 30 Oct");
      }
    }
    for (const stage of ["checking", "unclaimed", "cash-due", "cash-received"] as const) {
      const flat = view(at(stage));
      expect(flat.sentWord).toBeNull();
      expect(capsuleText(flat, { phase: "pending", swapped: false }, null)).toEqual({
        before: null,
        after: null,
      });
    }
  });
});

describe("inv.i3.member-view: a line that does not add up is never presented as settled", () => {
  const CAPSULES = Object.keys(CAPSULE_WORD) as CapsuleState[];
  const broken = (dto: StatementDTO, drift: number): StatementDTO => ({
    ...dto,
    amounts: { ...dto.amounts, netCents: dto.amounts.netCents + drift },
  });

  it("a paid line whose receipt is a cent off stays hollow, is not filled by MM-1, and says who checks it", () => {
    const dto = broken(at("paid"), 1);
    const v = view(dto, "en");
    expect(v.capsule).toBe("paid");
    expect(v.conserved).toBe(false);
    expect(v.amountState).toBe("hollow");
    expect(v.fillsOnPress).toBe(false);
    expect(v.detail).toEqual({ key: "M-MB-01.unbalanced", args: { name: "Analyn" } });
    expect(t("en", "M-MB-01.unbalanced", v.detail?.args)).toBe(
      "Still being checked: the figures on this line don't add up. Treasurer Analyn will check them.",
    );
    expect(t("ceb", "M-MB-01.unbalanced", v.detail?.args)).toMatch(/^Gisusi pa/);
    // PayPal's word stays PayPal's: the capsule still reads what PayPal confirmed.
    expect(v.word).toBe("Paid, 30 Oct");
  });

  it("cash the clerk recorded is not attested while the line does not add up", () => {
    const v = view(broken(at("cash-received"), -2), "fil");
    expect(v.amountState).toBe("hollow");
    expect(v.detail?.key).toBe("M-MB-01.unbalanced");
  });

  it("inv.i3.member-view.property: for any drift, stage, capsule and language, never landed or attested", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: -5_000, max: 5_000 }).filter((d) => d !== 0),
        fc.constantFrom(...DEMO_STAGES),
        fc.constantFrom(...CAPSULES),
        fc.constantFrom(...LANGS),
        (drift, stage, capsule, lang) => {
          const dto = broken(at(stage), drift);
          const v = lineView(dto, capsule, trackOf(dto), lang);
          return (
            !v.conserved &&
            v.amountState !== "landed" &&
            v.amountState !== "attested" &&
            !v.fillsOnPress &&
            (!v.showAmount || v.detail?.key === "M-MB-01.unbalanced")
          );
        },
      ),
    );
  });

  it("a line that adds up keeps the grammar: landed when PayPal confirmed it, attested when the clerk recorded it", () => {
    expect(view(at("paid")).conserved).toBe(true);
    expect(view(at("paid")).amountState).toBe("landed");
    expect(view(at("cash-received")).amountState).toBe("attested");
    expect(view(at("sent")).fillsOnPress).toBe(true);
    expect(view(at("unclaimed")).fillsOnPress).toBe(false);
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

  it("tells the story in the order it happened, even when the clocks disagree", () => {
    const dto: StatementDTO = {
      ...at("cash-received"),
      history: [
        { kind: "received", at: "2026-10-30T01:00:00Z", by: ["JD"] },
        { kind: "unclaimed", at: "2026-10-29T23:00:00Z" },
        { kind: "approved", at: "2026-10-30T02:00:00Z", by: ["AS", "EC"] },
        { kind: "cash-due", at: "2026-10-29T23:30:00Z", by: ["AS"] },
        { kind: "sent", at: "2026-10-30T02:05:00Z" },
      ],
    };
    expect(historyRows(dto, EMPTY_TRACK).map((r) => r.kind)).toEqual([
      "approved",
      "sent",
      "unclaimed",
      "cash-due",
      "received",
    ]);
  });

  it("names the two officers who closed the seal", () => {
    expect(sealSigners(at("paid"))).toEqual(["AS", "EC"]);
    expect(sealSigners(at("checking"))).toBeNull();
  });
});

describe("every amount on the receipt and the board's Bayad keeps the amount grammar (S2.0 rule 3, S2.2.1)", () => {
  it("the receipt's parts are figures two officers approved (ink); the net is the money and follows the hero", () => {
    const expected: Record<DemoStage, AmountState | null> = {
      checking: null,
      sent: "hollow",
      paid: "landed",
      unclaimed: "hollow",
      "cash-due": "hollow",
      "cash-received": "attested",
    };
    for (const stage of DEMO_STAGES) {
      const v = view(at(stage));
      const net = expected[stage];
      if (!net) {
        expect(v.showAmount, stage).toBe(false);
        continue;
      }
      expect(receiptStates(v), stage).toEqual({ parts: "ink", net });
      expect(receiptStates(v).net, stage).toBe(v.amountState);
    }
  });

  it("a receipt that does not add up never shows a settled net (I3), and its parts stay the approved figures", () => {
    const v = view({
      ...at("paid"),
      amounts: { ...at("paid").amounts, netCents: at("paid").amounts.netCents + 1 },
    });
    expect(receiptStates(v)).toEqual({ parts: "ink", net: "hollow" });
  });

  it("a line nobody has approved keeps every figure on its receipt in pencil", () => {
    expect(receiptStates({ amountState: "pencil" })).toEqual({ parts: "pencil", net: "pencil" });
    expect(receiptStates({ amountState: "ink" })).toEqual({ parts: "ink", net: "ink" });
  });

  it("the board's run is pencil until both keys are in, then ink, as on M-BD-01", () => {
    expect(runAmountState({ state: "request" })).toBe("pencil");
    expect(runAmountState({ state: "override" })).toBe("pencil");
    expect(runAmountState({ state: "expired" })).toBe("pencil");
    expect(runAmountState({ state: "declined" })).toBe("pencil");
    expect(runAmountState({ state: "signed" })).toBe("ink");
  });
});
