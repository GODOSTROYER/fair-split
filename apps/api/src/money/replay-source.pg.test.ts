// Where Judge Mode's replayed PayPal steps come from (S3.9: "the latest settled live run, else showcase r37"):
// money/rail.ts `replaySource`, on embedded Postgres. With nothing posted yet the seed's run stands in; the showcase
// run's own objects come next; a run settled live on this rail beats both. A member's item is answered as the
// source's settle GET saw it: Rhea's, later cancelled to cash, was UNCLAIMED then.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadShowcase, type ShowcaseWorld } from "../proof/testing/world.js";
import { createTestApp, type TestApp } from "../test/index.js";
import { replaySource } from "./rail.js";

let t: TestApp;
beforeAll(async () => {
  t = await createTestApp({ db: "postgres" });
});
afterAll(async () => t.close());

describe("replaySource", () => {
  let show: ShowcaseWorld;

  it("with no posted run anywhere, the seed's run (no real ids)", async () => {
    const s = await replaySource(t.deps.db, "simulated_rail");
    expect(s).toMatchObject({ kind: "seed", invoiceId: null, payoutBatchId: null });
    expect(s.items.get("M-031")?.status).toBe("UNCLAIMED");
    expect(s.items.get("M-014")?.status).toBe("SUCCESS");
  });

  it("else the showcase run r37, with its own batch id; Rhea as the settle GET saw her", async () => {
    show = await loadShowcase(t.deps.db);
    const s = await replaySource(t.deps.db, "simulated_rail");
    expect(s).toMatchObject({ kind: "showcase", runSlug: show.runSlug, payoutBatchId: "SEEDBATCHR37" });
    expect(s.recordedOn).toBe("2026-10-29");
    expect(s.items.get("M-031")?.status).toBe("UNCLAIMED");
    expect(s.items.get("M-014")?.status).toBe("SUCCESS");
  });

  it("a run settled live on this rail beats the showcase; a replayed or other-rail one never does", async () => {
    const owner = t.pg?.owner.sql;
    if (!owner) throw new Error("db");
    // the same settled run, as a run that settled live on the simulated rail leaves its rows (the snapshot's ids
    // load once per database)
    await owner`update pay_runs set provenance = 'simulated_rail' where id = ${show.runId}`;
    await owner`update payout_batches set provenance = 'simulated_rail', paypal_batch_id = 'LIVEBATCH0001',
      submitted_at = '2026-11-02T03:00:00Z' where run_id = ${show.runId}`;
    expect(await replaySource(t.deps.db, "simulated_rail")).toMatchObject({
      kind: "live_run",
      payoutBatchId: "LIVEBATCH0001",
      recordedOn: "2026-11-02",
    });
    // the sandbox rail has no live run yet: the showcase stands
    expect((await replaySource(t.deps.db, "live")).kind).toBe("showcase");
  });
});
