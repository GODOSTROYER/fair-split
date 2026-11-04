import type { RunEvent } from "@fairsplit/contracts";
import { expect, it } from "vitest";
import { seedSnapshot } from "../test/world.js";
import { describeContext, describeEvent } from "./describe.js";

it("keeps a pending payout's status in sentence case", () => {
  const event: RunEvent = {
    id: "pending",
    ws: "test",
    runId: "test-run",
    type: "item.updated",
    at: "2026-11-04T11:03:00.000Z",
    provenance: "simulated_rail",
    actor: { kind: "paypal", id: "simulator" },
    payload: {
      itemId: "item",
      senderItemId: "r37-M-002",
      memberNo: "M-002",
      from: "SUBMITTED",
      to: "PENDING",
      rank: 20,
      payoutItemId: null,
      eventId: null,
      source: "post_response",
    },
  } as RunEvent;
  // Sentence case, with the rail's label the replay sweep's payoutStatus adds.
  expect(describeEvent(event, describeContext(seedSnapshot()))?.words).toMatch(
    /: Waiting for PayPal \(Simulated PayPal sandbox\)$/,
  );
});
