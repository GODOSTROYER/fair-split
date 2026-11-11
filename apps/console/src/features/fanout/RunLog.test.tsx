import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import type { LogRow } from "../../data/describe.js";
import { LATEST, plainWords, RunLog } from "./RunLog.js";

it("prints breakable event names on their own line and keeps amounts together", () => {
  const row: LogRow = {
    id: "payment",
    lane: "PAYPAL",
    words: "Paid Arnel Sumampao US$26.65",
    detail: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED, item SIM_1, simulated PayPal sandbox",
    at: "2026-11-04T11:03:00.000Z",
    type: "item.updated",
    provenance: "simulated_rail",
    duplicate: false,
  };
  const view = render(<RunLog rows={[row]} isLive={() => false} seeded={false} />);
  expect(view.container.querySelector(".fsr-log__event")?.querySelectorAll("wbr").length).toBeGreaterThan(0);
  expect(view.container.querySelector(".fsr-log__amount")?.textContent).toBe("US$26.65");
});

it("never prints an internal event type as a line of its own", () => {
  const row: LogRow = {
    id: "state",
    lane: "MACHINE",
    words: "Posting to PayPal",
    detail: "Run state, simulated PayPal sandbox",
    at: "2026-11-04T11:03:00.000Z",
    type: "run.state",
    provenance: "simulated_rail",
    duplicate: false,
  };
  const view = render(<RunLog rows={[row]} isLive={() => false} seeded={false} />);
  expect(view.container.querySelector(".fsr-log__event")).toBeNull();
  expect(view.container.textContent).not.toContain("run.state");
  expect(view.container.querySelector(".fsr-log__detail")?.textContent).toBe(
    "Run state, simulated PayPal sandbox",
  );
});

const base: Omit<LogRow, "id" | "words" | "at"> = {
  lane: "PAYPAL",
  detail: "PAYMENT.PAYOUTSBATCH.SUCCESS, simulated webhook, signature checked",
  type: "webhook.received",
  provenance: "simulated_rail",
  duplicate: false,
};

it("names a PayPal notice by what it means, its code kept for the details; the tag says the rail once", () => {
  expect(
    plainWords({ ...base, id: "a", at: null, words: "PayPal notice: PAYMENT.PAYOUTSBATCH.SUCCESS" }),
  ).toBe("Batch accepted");
  expect(plainWords({ ...base, id: "b", at: null, words: "PayPal notice: INVOICING.INVOICE.PAID" })).toBe(
    "Invoice paid",
  );
  expect(
    plainWords({
      ...base,
      id: "c",
      at: null,
      words: "Paid Arnel Sumampao US$55.96 (Simulated PayPal sandbox)",
    }),
  ).toBe("Paid Arnel Sumampao US$55.96");
  // A replayed row keeps its words whole: it says what it replayed.
  const replay = "Replayed (labelled): Rhea Jumawan parked";
  expect(plainWords({ ...base, id: "d", at: null, words: replay })).toBe(replay);
  // While cash is still due the run's SETTLED row never says "Settled" (round 3); once it is handed over it may.
  const settled = { ...base, id: "e", at: null, lane: "MACHINE" as const, words: "Settled" };
  expect(plainWords(settled, "PayPal complete · cash due")).toBe("PayPal complete · cash due");
  expect(plainWords(settled)).toBe("Settled");
  // The run state's row arrives on whichever lane its actor gives it (the simulated PayPal's settling notice puts
  // it on PayPal's): it still never says "Settled" while cash is due.
  const onPaypal = { ...settled, id: "f", lane: "PAYPAL" as const };
  expect(plainWords(onPaypal, "PayPal complete · cash due")).toBe("PayPal complete · cash due");
});

it("shows the last four events in plain words, newest first, and keeps every row in the lanes behind All", () => {
  const rows: LogRow[] = Array.from({ length: 8 }, (_, i) => ({
    ...base,
    id: `e${i}`,
    words: `PayPal notice: PAYMENT.PAYOUTSBATCH.SUCCESS ${i}`,
    at: `2026-11-04T11:0${i}:00.000Z`,
  }));
  const view = render(<RunLog rows={rows} isLive={() => false} seeded={false} />);
  const latest = view.container.querySelectorAll(".fsr-log__latest > li");
  // Round 5: four rows (PEEK_ROWS), then "All N events".
  expect(LATEST).toBe(4);
  expect(latest).toHaveLength(LATEST);
  expect(latest[0]?.getAttribute("title")).toContain("PAYMENT.PAYOUTSBATCH.SUCCESS");
  expect(view.container.querySelector(".fsr-log__all summary")?.textContent).toBe("All 8 events");
  expect(view.container.querySelectorAll(".fsr-log__row")).toHaveLength(8);
  // Round 5, provenance once: no tag and no legend glyph on the log (the screen's id line says the rail); a screen
  // reader still hears what each PayPal row is, beside its lane.
  expect(view.container.querySelectorAll("[data-fs-tag]")).toHaveLength(0);
  expect(view.container.querySelectorAll("[data-fs-glyph]")).toHaveLength(0);
  expect(latest[0]?.querySelector(".fsr-log__lane-name .fs-sr")?.textContent).toBe(
    ", Simulated PayPal sandbox",
  );
});

it("marks a payment the simulated PayPal confirmed with the jade lane dot, never a replayed one", () => {
  const paid: LogRow = { ...base, id: "p", at: null, words: "Paid Arnel Sumampao US$55.96" };
  const replayed: LogRow = {
    ...base,
    id: "r",
    at: null,
    words: "Replayed (labelled): Paid Rhea Jumawan US$26.65",
    provenance: "replay",
  };
  const notice: LogRow = { ...base, id: "n", at: null, words: "PayPal notice: PAYMENT.PAYOUTSBATCH.SUCCESS" };
  const view = render(<RunLog rows={[notice, replayed, paid]} isLive={() => false} seeded={false} />);
  const dots = [...view.container.querySelectorAll(".fsr-log__latest .fsr-log__dot")];
  expect(dots.map((d) => d.hasAttribute("data-landed"))).toEqual([true, false, false]);
});
