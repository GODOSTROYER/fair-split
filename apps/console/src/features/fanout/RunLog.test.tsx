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
});

it("shows the last five events in plain words, newest first, and keeps every row in the lanes behind All", () => {
  const rows: LogRow[] = Array.from({ length: 8 }, (_, i) => ({
    ...base,
    id: `e${i}`,
    words: `PayPal notice: PAYMENT.PAYOUTSBATCH.SUCCESS ${i}`,
    at: `2026-11-04T11:0${i}:00.000Z`,
  }));
  const view = render(<RunLog rows={rows} isLive={() => false} seeded={false} />);
  const latest = view.container.querySelectorAll(".fsr-log__latest > li");
  expect(latest).toHaveLength(LATEST);
  expect(latest[0]?.getAttribute("title")).toContain("PAYMENT.PAYOUTSBATCH.SUCCESS");
  expect(view.container.querySelector(".fsr-log__all summary")?.textContent).toBe("All 8 events");
  expect(view.container.querySelectorAll(".fsr-log__row")).toHaveLength(8);
  expect(view.container.querySelectorAll(".fs-honesty")).toHaveLength(1);
});
