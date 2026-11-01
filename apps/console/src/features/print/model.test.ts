// W-TR-09's model: a line's state through the story, the ReceiptBar's figures, exact cash pesos at the run's
// recorded rate (half-up), the PayPal estimate (floored, always labelled), and a GSM-7 SMS preview.

import { describe, expect, it } from "vitest";
import { applyRunEvents, type RunView, sessionView, showcaseView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { createTestWorld, seedSnapshot } from "../../test/world.js";
import {
  cashCentavos,
  findRow,
  gsm7Length,
  lineHistory,
  lineScreenState,
  pesoWholeEstimate,
  rateDisplay,
  receiptLine,
  smsSegments,
  smsText,
} from "./model.js";

const snapshot = seedSnapshot();
const fx = snapshot.fx.centavosPerCent;

function viewOf(world: ReturnType<typeof createTestWorld>): RunView {
  return applyRunEvents(
    sessionView(snapshot, { runSlug: world.runSlug, runId: world.runId }),
    world.events(),
  );
}

function rowOf(view: RunView, memberNo: string) {
  const row = findRow(snapshot, view, memberNo);
  if (!row) throw new Error(`no row ${memberNo}`);
  return row;
}

describe("pesos", () => {
  it("Merlyn's cash is exact at the run's rate: US$127.84 → ₱7,990.00 at ₱62.50", () => {
    expect(format.money(cashCentavos(12_784, fx), "PHP")).toBe("₱7,990.00");
    expect(rateDisplay(fx)).toBe("₱62.50");
  });

  it("rounds half-up to the centavo", () => {
    expect(cashCentavos(1, { num: 125, den: 2 })).toBe(63);
    expect(cashCentavos(3, { num: 1, den: 2 })).toBe(2);
    expect(cashCentavos(-1, { num: 125, den: 2 })).toBe(-63);
  });

  it("Nang Celing's PayPal line is about ₱4,028, an estimate", () => {
    expect(pesoWholeEstimate(6_445, fx)).toBe("₱4,028");
  });
});

describe("a line's state through the story", () => {
  it("in review: Dioning held by H1, Nang Celing ready; after both keys Merlyn's cash is due", () => {
    const world = createTestWorld();
    world.markPaid();
    const review = viewOf(world);
    expect(lineScreenState(review, rowOf(review, "M-007"))).toBe("held");
    expect(lineScreenState(review, rowOf(review, "M-014"))).toBe("ready");
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    const paid = viewOf(world);
    expect(lineScreenState(paid, rowOf(paid, "M-014"))).toBe("paid");
    expect(lineScreenState(paid, rowOf(paid, "M-031"))).toBe("parked");
    expect(lineScreenState(paid, rowOf(paid, "M-053"))).toBe("cash-due");
    world.payCash("M-031");
    const rerouted = viewOf(world);
    expect(lineScreenState(rerouted, rowOf(rerouted, "M-031"))).toBe("cash-due");
  });

  it("the showcase: 7 paid, 57 cash due", () => {
    const view = showcaseView(snapshot);
    expect(lineScreenState(view, rowOf(view, "M-014"))).toBe("paid");
    expect(lineScreenState(view, rowOf(view, "M-053"))).toBe("cash-due");
  });
});

describe("why the number is the number", () => {
  it("Nang Celing: 148.0 kg × the pool's rate, 43.69 + 21.85 − CBU 1.09 (R1) = 64.45, about ₱4,028", () => {
    const line = receiptLine(snapshot, rowOf(showcaseView(snapshot), "M-014"));
    expect(line.kg).toBe("148.0 kg");
    expect(line.rate).toBe("US$0.29523");
    expect(line.premium.display).toBe("US$43.69");
    expect(line.bonus.display).toBe("US$21.85");
    expect(line.deductions).toHaveLength(1);
    expect(line.deductions[0]).toMatchObject({ name: "CBU", rule: "R1", card: "BR 2026-04" });
    expect(line.deductions[0]?.amount.display).toBe("−US$1.09");
    expect(line.net.display).toBe("US$64.45");
    expect(line.netPhp).toBe("₱4,028");
  });

  it("Nong Tidoy carries the returned multa as a credit; a cash line has no peso estimate", () => {
    const view = showcaseView(snapshot);
    expect(receiptLine(snapshot, rowOf(view, "M-018")).credits[0]?.amount.display).toBe("US$3.20");
    expect(receiptLine(snapshot, rowOf(view, "M-053")).netPhp).toBeUndefined();
  });

  it("the line's history in a live run: the approvals and its PayPal item", () => {
    const world = createTestWorld();
    world.markPaid();
    world.resolveAll();
    world.sign("treasurer");
    world.cosign();
    const history = lineHistory(snapshot, viewOf(world), "M-014").map((h) => h.words);
    expect(history).toContain("Analyn signed the batch");
    expect(history).toContain("Ernesto signed the batch");
    expect(history.at(-1)).toBe("Paid");
  });
});

describe("the SMS preview (never sent)", () => {
  it("is GSM-7: ₱ is written P; Ñ counts one septet, € two; a long text splits at 153", () => {
    expect(gsm7Length("₱")).toBeNull();
    expect(gsm7Length("Pacaña")).toBe(6);
    expect(gsm7Length("€")).toBe(2);
    expect(smsSegments(160)).toBe(1);
    expect(smsSegments(161)).toBe(2);
    expect(smsSegments(307)).toBe(3);
  });

  it("Nang Celing's, in Cebuano, fits one message and names her slips", () => {
    const view = showcaseView(snapshot);
    const member = snapshot.members.find((m) => m.memberNo === "M-014");
    if (!member) throw new Error("no M-014");
    const row = rowOf(view, "M-014");
    const text = smsText(snapshot, member, row, "paid", "ceb");
    expect(text).toMatch(/Nang Celing, Bayad na: US\$64\.45/);
    expect(text).toMatch(/P4,028/);
    expect(text).not.toMatch(/₱/);
    const septets = gsm7Length(text);
    expect(septets).not.toBeNull();
    expect(septets ?? 999).toBeLessThanOrEqual(160);
  });
});
