import { render } from "@testing-library/react";
import { expect, it } from "vitest";
import type { LogRow } from "../../data/describe.js";
import { RunLog } from "./RunLog.js";

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
