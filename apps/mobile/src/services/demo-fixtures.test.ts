import { describe, expect, it } from "vitest";
import { buildDemoStatement, DEMO_STAGES } from "./demo-fixtures";

const now = "2026-10-30T02:00:00.000Z";
const minutes = (m: number) => new Date(Date.parse(now) - m * 60_000).toISOString();

/** When the demo was sent: never (a link straight to the stage), just now, a moment ago, or long ago. */
const SENT_AT = [undefined, now, minutes(1), minutes(4), minutes(40)] as const;

describe("demo history reads in order, even when a link jumps straight to a later stage", () => {
  it.each(DEMO_STAGES)("%s: each entry is at or after the one before, and none is after now", (stage) => {
    for (const sentAt of SENT_AT) {
      const at = buildDemoStatement({ stage, now, sentAt }).history.map((h) => Date.parse(h.at));
      for (let i = 1; i < at.length; i++) expect(at[i]).toBeGreaterThanOrEqual(at[i - 1] ?? Number.NaN);
      for (const t of at) expect(t).toBeLessThanOrEqual(Date.parse(now));
    }
  });

  it("tells the story in its own order: approved, sent, PayPal's answer, the bodega, the receipt", () => {
    const kinds = (stage: (typeof DEMO_STAGES)[number]) =>
      buildDemoStatement({ stage, now }).history.map((h) => h.kind);
    expect(kinds("checking")).toEqual([]);
    expect(kinds("sent")).toEqual(["approved", "sent"]);
    expect(kinds("paid")).toEqual(["approved", "sent", "paid"]);
    expect(kinds("unclaimed")).toEqual(["approved", "sent", "unclaimed"]);
    expect(kinds("cash-due")).toEqual(["approved", "sent", "unclaimed", "cash-due"]);
    expect(kinds("cash-received")).toEqual(["approved", "sent", "unclaimed", "cash-due", "received"]);
  });

  it("keeps the real send time when it already reads in order, so the wait on the plate stays true", () => {
    const sent = (stage: (typeof DEMO_STAGES)[number], sentAt: string) =>
      buildDemoStatement({ stage, now, sentAt }).history.find((h) => h.kind === "sent")?.at;
    expect(sent("sent", minutes(1))).toBe(minutes(1));
    expect(sent("paid", minutes(1))).toBe(minutes(1));
    expect(sent("cash-due", minutes(40))).toBe(minutes(40));
    // Sent "now" but PayPal parked it six minutes ago: the send moves back to the parking, never after it.
    expect(sent("cash-due", now)).toBe(minutes(6));
  });

  it("approves two minutes before the send it belongs to", () => {
    for (const stage of DEMO_STAGES.filter((s) => s !== "checking")) {
      for (const sentAt of SENT_AT) {
        const h = buildDemoStatement({ stage, now, sentAt }).history;
        const approved = Date.parse(h.find((e) => e.kind === "approved")?.at ?? "");
        const sent = Date.parse(h.find((e) => e.kind === "sent")?.at ?? "");
        expect(sent - approved).toBe(2 * 60_000);
      }
    }
  });
});
