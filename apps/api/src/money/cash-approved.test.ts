import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign } from "@fairsplit/domain";
import { and, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { registerKey } from "../runs/test/world.js";

let h: RunsHarness;
beforeAll(async () => {
  h = await startRuns();
  await resolveAll(h);
});
afterAll(async () => h?.close());

describe("HD6-7 cash waits until the approved batch leaves for posting", () => {
  it("inv.i4.stored-lines-root: both signing routes refuse a stale stored line before signing", async () => {
    const db = h.t.pg?.owner.db;
    if (!db) throw new Error("db");
    const api = h.t.client(h.tokens.treasurer);
    const params = { runSlug: h.world.runSlug };
    const key = await registerKey(h.t.deps.db, h.world.workspaceId, {
      keyId: "fs-analyn-a1",
      persona: "analyn",
    });
    const { payload } = await api.approvalPayload({ params, query: { role: "treasurer" } });
    const [line] = await db
      .select()
      .from(schema.memberLines)
      .where(and(eq(schema.memberLines.runId, h.world.runId), eq(schema.memberLines.rail, "OFF")))
      .limit(1);
    if (!line) throw new Error("cash line");
    await db
      .update(schema.memberLines)
      .set({ premiumCents: line.premiumCents + 1n, netCents: line.netCents + 1n, lineSha256: "a".repeat(64) })
      .where(eq(schema.memberLines.id, line.id));
    try {
      await expect(api.approvalPayload({ params, query: { role: "treasurer" } })).rejects.toMatchObject({
        code: "INVALID_TRANSITION",
        status: 409,
      });
      await expect(
        api.submitApproval({
          params,
          body: {
            role: "treasurer",
            keyId: "fs-analyn-a1",
            payload,
            signature: ed25519Sign(key.privateKey, approvalBytes(payload)),
          },
        }),
      ).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
      expect(
        await db.select().from(schema.approvals).where(eq(schema.approvals.runId, h.world.runId)),
      ).toHaveLength(0);
    } finally {
      await db
        .update(schema.memberLines)
        .set({ premiumCents: line.premiumCents, netCents: line.netCents, lineSha256: line.lineSha256 })
        .where(eq(schema.memberLines.id, line.id));
    }
  });

  it("inv.i3.approved-cash: pay-cash at APPROVED refuses and leaves the cash line READY", async () => {
    await signBoth(h);
    const [line] = await h.t.deps.db
      .select()
      .from(schema.memberLines)
      .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
      .where(and(eq(schema.memberLines.runId, h.world.runId), eq(schema.members.memberNo, "M-053")));
    if (!line) throw new Error("M-053");
    await expect(
      h.t.client(h.tokens.treasurer).payCash({ params: { lineId: line.member_lines.id } }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", status: 409 });
    const [after] = await h.t.deps.db
      .select()
      .from(schema.memberLines)
      .where(eq(schema.memberLines.id, line.member_lines.id));
    expect(after?.state).toBe("READY");
  });

  it("inv.i3.cash-send-back: a by-hand edit and fresh signatures conserve both pools after the refused cash press", async () => {
    await h.t
      .client(h.tokens.treasurer)
      .enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "65.00" } });
    await signBoth(h);
    await runQueued(h, "postPayoutBatch");
    const lines = await h.t.deps.db
      .select()
      .from(schema.memberLines)
      .where(eq(schema.memberLines.runId, h.world.runId));
    const [computed] = await h.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(eq(schema.ledgerEntries.runId, h.world.runId), eq(schema.ledgerEntries.kind, "lines.computed")),
      )
      .orderBy(desc(schema.ledgerEntries.seq))
      .limit(1);
    const pools = computed?.payload as { premiumPoolCents: number; bonusPoolCents: number };
    expect(lines.reduce((sum, l) => sum + l.netCents + l.deductionsCents - l.creditsCents, 0n)).toBe(
      BigInt(pools.premiumPoolCents + pools.bonusPoolCents),
    );
    expect(lines.filter((l) => l.rail === "OFF").every((l) => l.state === "OFF_RAIL_DUE")).toBe(true);
  });
});
