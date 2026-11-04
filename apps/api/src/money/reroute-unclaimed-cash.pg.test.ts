import { randomUUID } from "node:crypto";
import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign } from "@fairsplit/domain";
import { and, eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { reroutePayload, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { settleBatch } from "./settle.js";

it("inv.i3.reroute-unclaimed-cash: an x1 re-route that parks again settles after its cash cancellation", async () => {
  const s = paypalScript({ parked: ["rhea", "m014"] });
  const g = await startRuns({ paypal: s.handlers, world: { kind: "showcase" } });
  try {
    await resolveAll(g);
    const { keys } = await signBoth(g);
    await runQueued(g, "postPayoutBatch");
    const [primary] = await g.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.runId, g.world.runId));
    if (!primary) throw new Error("primary batch");
    await settleBatch(g.t.deps, { batchId: primary.id, n: 1 }, { workspaceId: g.world.workspaceId });
    const api = g.t.client(g.tokens.treasurer);
    const [other] = await g.t.deps.db
      .select()
      .from(schema.memberLines)
      .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
      .where(and(eq(schema.memberLines.runId, g.world.runId), eq(schema.members.memberNo, "M-014")));
    if (!other) throw new Error("M-014");
    await api.payCash({ params: { lineId: other.member_lines.id } });
    const [row] = await g.t.deps.db
      .select()
      .from(schema.memberLines)
      .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
      .where(and(eq(schema.memberLines.runId, g.world.runId), eq(schema.members.memberNo, "M-031")));
    if (!row) throw new Error("M-031");
    const built = await reroutePayload(g, {
      memberNo: "M-031",
      receiver: "m014@example.com",
      amountCents: Number(row.member_lines.netCents),
      nonce: randomUUID().replaceAll("-", ""),
      exp: new Date(g.t.clock.nowMs() + 20 * 60_000).toISOString(),
    });
    await api.resend({
      params: { lineId: row.member_lines.id },
      body: {
        newReceiver: "m014@example.com",
        keyId: "fs-analyn-a1",
        signature: ed25519Sign(keys.analyn.privateKey, approvalBytes(built.payload)),
        payload: built.payload,
      },
    });
    const [reroute] = await g.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(eq(schema.payoutBatches.senderBatchId, built.senderBatchId));
    if (!reroute) throw new Error("reroute batch");
    await settleBatch(g.t.deps, { batchId: reroute.id, n: 1 }, { workspaceId: g.world.workspaceId });
    const [parked] = await g.t.deps.db
      .select()
      .from(schema.memberLines)
      .where(eq(schema.memberLines.id, row.member_lines.id));
    expect(parked?.state).toBe("UNCLAIMED");
    await api.payCash({ params: { lineId: row.member_lines.id } });
    const [cash] = await g.t.deps.db
      .select()
      .from(schema.memberLines)
      .where(eq(schema.memberLines.id, row.member_lines.id));
    expect(cash?.state).toBe("OFF_RAIL_DUE");
    const [run] = await g.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, g.world.runId));
    expect(run?.state).toBe("SETTLED");
  } finally {
    await g.close();
  }
}, 120_000);
