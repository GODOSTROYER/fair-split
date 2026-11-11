import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign, linesDigest } from "@fairsplit/domain";
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
      const stored = await db
        .select({ memberNo: schema.members.memberNo, lineSha256: schema.memberLines.lineSha256 })
        .from(schema.memberLines)
        .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
        .where(eq(schema.memberLines.runId, h.world.runId));
      // Even a valid signature over the now-stored stale root must not authorize it.
      const stalePayload = {
        ...payload,
        linesDigest: linesDigest(
          stored.map((l) => ({ memberNo: l.memberNo, lineSha256: l.lineSha256 ?? "" })),
        ),
      };
      await expect(
        api.submitApproval({
          params,
          body: {
            role: "treasurer",
            keyId: "fs-analyn-a1",
            payload: stalePayload,
            signature: ed25519Sign(key.privateKey, approvalBytes(stalePayload)),
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
    ).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
      status: 409,
      message: "A READY line cannot move to cash until the approved batch is posted.",
    });
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

it("inv.i4.excluded-recompute: excluding H2 before resolving H1 keeps the refreshed excluded line signable", async () => {
  const g = await startRuns();
  try {
    const api = g.t.client(g.tokens.treasurer);
    const holds = await g.t.deps.db.select().from(schema.holds).where(eq(schema.holds.runId, g.world.runId));
    const hold = (code: string) => {
      const found = holds.find((row) => row.code === code);
      if (!found) throw new Error(code);
      return found.id;
    };
    await api.resolveHold({
      params: { holdId: hold("H2") },
      body: { resolution: "EXCLUDE_LINE", reason: "Unverified plot excluded by the officer." },
    });
    const excluded = async () => {
      const [row] = await g.t.deps.db
        .select()
        .from(schema.memberLines)
        .innerJoin(schema.members, eq(schema.members.id, schema.memberLines.memberId))
        .where(and(eq(schema.memberLines.runId, g.world.runId), eq(schema.members.memberNo, "M-053")));
      if (!row) throw new Error("excluded member");
      return row.member_lines;
    };
    const before = await excluded();
    expect(before.state).toBe("EXCLUDED");
    await api.resolveHold({ params: { holdId: hold("H1") }, body: { resolution: "COUNT_ONCE" } });
    const after = await excluded();
    expect(after.state).toBe("EXCLUDED");
    expect(after.lineSha256).not.toBe(before.lineSha256);
    expect(after.version).toBe(before.version);
    await api.enterField({ params: { fieldId: g.world.fields0462.gross }, body: { value: "64.80" } });
    await api.resolveHold({ params: { holdId: hold("H3") }, body: { resolution: "RETURN_AS_CREDIT" } });
    await signBoth(g);
    const [run] = await g.t.deps.db.select().from(schema.payRuns).where(eq(schema.payRuns.id, g.world.runId));
    expect(run?.state).toBe("APPROVED");
  } finally {
    await g.close();
  }
}, 120_000);

it("inv.i5.posted-review: a hold resolution after posting refuses with VERSION_CONFLICT even with cash lines", async () => {
  const g = await startRuns();
  try {
    const api = g.t.client(g.tokens.treasurer);
    await api.enterField({ params: { fieldId: g.world.fields0462.gross }, body: { value: "64.80" } });
    const holds = await g.t.deps.db.select().from(schema.holds).where(eq(schema.holds.runId, g.world.runId));
    const h1 = holds.find((row) => row.code === "H1");
    const h2 = holds.find((row) => row.code === "H2");
    if (!h1 || !h2) throw new Error("blocking holds");
    await api.resolveHold({ params: { holdId: h1.id }, body: { resolution: "COUNT_ONCE" } });
    await api.resolveHold({
      params: { holdId: h2.id },
      body: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
    });
    await signBoth(g);
    await runQueued(g, "postPayoutBatch");
    const [hold] = await g.t.deps.db
      .select()
      .from(schema.holds)
      .where(and(eq(schema.holds.runId, g.world.runId), eq(schema.holds.code, "H3")));
    if (!hold) throw new Error("H3");
    expect(hold.state).toBe("OPEN");
    await expect(
      g.t
        .client(g.tokens.treasurer)
        .resolveHold({ params: { holdId: hold.id }, body: { resolution: "RETURN_AS_CREDIT" } }),
    ).rejects.toMatchObject({ code: "VERSION_CONFLICT", status: 409 });
  } finally {
    await g.close();
  }
}, 120_000);
