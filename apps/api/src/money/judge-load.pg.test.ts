import { schema } from "@fairsplit/db";
import { and, eq, inArray } from "drizzle-orm";
import { expect, it } from "vitest";
import { beginLiveStep } from "../judge/index.js";
import { type RunsHarness, resolveAll, runQueued, signBoth, startRuns } from "../runs/test/app.js";
import { paypalScript } from "../runs/test/paypal.js";
import { seedWorld } from "../runs/test/world.js";

it("HD6 r5: 25 concurrent judges reach their payout POST within 60 s, with live and replay labelled", async () => {
  const script = paypalScript();
  const first = await startRuns({ paypal: script.handlers });
  const judges = [first];
  let held: Awaited<ReturnType<typeof beginLiveStep>> | undefined;
  try {
    for (let i = 1; i < 25; i++) {
      const world = await seedWorld(first.t.deps.db, {
        invoice: { paypalInvoiceId: `INV2-JUDGE-SOAK-${i}`, status: "PAID", sent: true },
      });
      const token = (role: "treasurer" | "board", persona: string) =>
        first.t.credentials.frameToken({ workspaceId: world.workspaceId, role, persona });
      judges.push({
        ...first,
        world,
        tokens: {
          ...first.tokens,
          treasurer: await token("treasurer", "analyn"),
          chair: await token("board", "ernesto"),
        },
      } satisfies RunsHarness);
    }
    for (const h of judges) {
      await resolveAll(h);
      await signBoth(h);
    }
    held = await beginLiveStep(first.t.deps, { workspaceId: first.world.workspaceId, step: "invoice" });
    expect(held).toMatchObject({ kind: "live", decision: { mode: "live" } });
    const began = performance.now();
    await Promise.all(judges.slice(1).map((h) => runQueued(h, "postPayoutBatch")));
    if (held.kind === "live") await held.end();
    await runQueued(first, "postPayoutBatch");
    const batches = await first.t.deps.db
      .select()
      .from(schema.payoutBatches)
      .where(
        inArray(
          schema.payoutBatches.runId,
          judges.map((h) => h.world.runId),
        ),
      );
    expect(batches).toHaveLength(25);
    expect(batches.filter((b) => b.provenance === "replay")).toHaveLength(24);
    expect(batches.filter((b) => b.provenance === "live")).toHaveLength(1);
    expect(batches.every((b) => b.paypalBatchId !== null)).toBe(true);
    const runs = await first.t.deps.db
      .select({ state: schema.payRuns.state })
      .from(schema.payRuns)
      .where(
        inArray(
          schema.payRuns.id,
          judges.map((h) => h.world.runId),
        ),
      );
    expect(runs.every((r) => r.state === "POSTED")).toBe(true);
    const labels = await first.t.deps.db
      .select({ payload: schema.ledgerEntries.payload })
      .from(schema.ledgerEntries)
      .where(
        and(
          inArray(
            schema.ledgerEntries.runId,
            judges.map((h) => h.world.runId),
          ),
          eq(schema.ledgerEntries.kind, "judge.step.replayed"),
        ),
      );
    expect(labels).toHaveLength(24);
    expect(labels.every((l) => (l.payload as { reason: string }).reason === "lane_full")).toBe(true);
    expect(script.calls.filter((c) => c === "create_payout_batch")).toHaveLength(1);
    // Known over-bound waits switch immediately; measure actual concurrent payout processing.
    const elapsedMs = performance.now() - began;
    console.info(`HD6 judge load: judges=25 live=1 replay=24 elapsedMs=${Math.round(elapsedMs)}`);
    expect(elapsedMs).toBeLessThan(60_000);
  } finally {
    if (held?.kind === "live") await held.end();
    await first.close();
  }
}, 240_000);
