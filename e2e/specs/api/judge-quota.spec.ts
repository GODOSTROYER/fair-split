// E1b: each live spec has a fresh judge session, and the private stack raises only the global hourly cap.
// The production cap remains three. The separately labelled filler below exercises its replay fallback.
import { Api } from "../../lib/api.js";
import { expect, test } from "../../lib/fixtures.js";
import { withReplayedPayout } from "../../lib/judge-quota.js";
import { E2E_HOURLY_CAP } from "../../lib/quota-config.js";

test("the private test stack allows live payouts beyond the production hourly quota", async ({ origin }) => {
  test.skip(
    !process.env.E2E_DATABASE_URL,
    "requires the private test stack; hosted quota defaults stay intact",
  );
  const lane = await new Api(origin).get("/v1/judge/lane");
  expect(lane.status).toBe(200);
  expect(lane.json).toMatchObject({ rail: { quota: { hourlyCap: E2E_HOURLY_CAP } } });
});

test("inv.i8.over-quota: payout Proof labels recorded statuses as replay, never verified or mismatched", async ({
  origin,
}) => {
  test.skip(!process.env.E2E_DATABASE_URL, "quota filler is restricted to the private test stack database");
  await withReplayedPayout(origin, async (api, s) => {
    const proof = await api.get(`/v1/proof/${s.runSlug}/verification`);
    expect(proof.status).toBe(200);
    expect(proof.json).toMatchObject({
      verification: {
        ok: false,
        status: "replay",
        verdict: "five of six match; one replayed, labelled",
        chain: { ok: true },
        checkpoint: { ok: true },
        plates: {
          payoutItems: {
            ok: true,
            state: "replay",
            reason:
              "Replayed (labelled): these statuses come from a recorded run, not from verified simulator notices",
          },
        },
      },
    });
    const metrics = await api.get(`/v1/proof/${s.runSlug}/metrics`);
    expect(metrics.json).toMatchObject({ paid: { paypalVerified: { members: 0 } } });
    const exported = await api.get(`/v1/proof/${s.runSlug}/export`, s.asTreasurer);
    expect(exported.status).toBe(200);
    const items = (
      exported.json as {
        bundle: { batch: { items: { provenance?: string; eventId: string | null }[] } };
      }
    ).bundle.batch.items;
    expect(items).toHaveLength(8);
    expect(items.every((item) => item.provenance === "replay" && item.eventId === null)).toBe(true);
  });
});
