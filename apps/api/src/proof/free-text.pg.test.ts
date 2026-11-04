import { createHash } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type RunsHarness, runQueued, signBoth, startRuns } from "../runs/test/app.js";

let h: RunsHarness;
beforeAll(async () => {
  h = await startRuns({ world: { kind: "showcase" } });
});
afterAll(async () => h?.close());

it("HD6-14: the public bundle never publishes dictionary-testable officer text hashes", async () => {
  const R = "A private officer reason for the duplicate delivery";
  const D = "Please check the handwritten kilos before signing";
  const L = "A private rate-card edit label";
  const A = "123.45";
  const api = h.t.client(h.tokens.treasurer);
  const holds = await h.t.json<{ holds: { id: string; label: string }[] }>(
    `/v1/runs/${h.world.runSlug}/holds`,
    {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    },
  );
  const hold = holds.body.holds.find((x) => x.label === "H1");
  if (!hold) throw new Error("H1");
  await api.resolveHold({ params: { holdId: hold.id }, body: { resolution: "ASK_CHAIR", reason: R } });
  // The chair resolves the asked hold, then the ordinary review helper completes the other holds.
  await h.t
    .client(h.tokens.chair)
    .resolveHold({ params: { holdId: hold.id }, body: { resolution: "COUNT_ONCE" } });
  await api.enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.80" } });
  const remaining = holds.body.holds;
  const id = (label: string) => {
    const found = remaining.find((x) => x.label === label);
    if (!found) throw new Error(label);
    return found.id;
  };
  await api.resolveHold({
    params: { holdId: id("H2") },
    body: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
  });
  await api.resolveHold({ params: { holdId: id("H3") }, body: { resolution: "RETURN_AS_CREDIT" } });
  await signBoth(h);
  await api.declineApproval({ params: { runSlug: h.world.runSlug }, body: { role: "treasurer", reason: D } });
  await expect(
    api.addDeduction({ params: { id: h.world.rateCardId }, body: { label: L, amountText: A } }),
  ).rejects.toMatchObject({ code: "RATE_CARD_RATIFIED" });
  await signBoth(h);
  await runQueued(h, "postPayoutBatch");
  const proof = await h.t.json(`/v1/proof/${h.world.runSlug}`);
  expect(proof.status).toBe(200);
  const json = JSON.stringify(proof.body);
  for (const text of [R, D, L, A]) {
    expect(json).not.toContain(createHash("sha256").update(text, "utf8").digest("hex"));
  }
}, 120_000);
