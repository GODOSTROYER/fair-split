// The public Proof stream carries aggregate counters only, never a member or a receiver. Both shapes (fs-api's
// `proof.progress` and api-client's mock `aggregate`) read into the same forward-only counts.

import { describe, expect, it } from "vitest";
import { progressFromMessage } from "./progress.js";

describe("progressFromMessage", () => {
  it("reads fs-api's proof.progress", () => {
    const next = progressFromMessage({
      id: "41",
      event: "proof.progress",
      data: {
        items: { total: 8, sent: 4, confirmed: 3, held: 0, parked: 1, returned: 0, failed: 0, reversed: 0 },
      },
    } as never);
    expect(next).toEqual({
      eventId: "41",
      counts: { total: 8, sent: 4, confirmed: 3, held: 0, parked: 1, returned: 0, failed: 0, reversed: 0 },
    });
  });

  it("reads the mock's aggregate, where parked holds both unclaimed and returned", () => {
    const next = progressFromMessage({
      id: "7",
      event: "aggregate",
      data: { confirmed: 7, parked: 1, of: 8 },
    } as never);
    expect(next?.counts).toMatchObject({ total: 8, confirmed: 7, parked: 1, sent: 0 });
    expect(next?.eventId).toBe("7");
  });

  it("ignores anything else, and a count that doesn't add up", () => {
    expect(
      progressFromMessage({ id: "1", event: "aggregate", data: { confirmed: 9, parked: 0, of: 8 } } as never),
    ).toBeNull();
    expect(progressFromMessage({ id: "2", event: "ping", data: "hello" } as never)).toBeNull();
  });
});
