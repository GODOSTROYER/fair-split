// The console's mock answers as fs-api does where api-client's mock is lenient: a member's persona is their
// member number, a signed link cannot run an acting command, and a rate card is looked up in the workspace.

import { isApiClientError } from "@fairsplit/api-client";
import { MemberLineDTO } from "@fairsplit/contracts";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { type JcsValue, jcs } from "../../lib/jcs.js";
import { linesRoot } from "../../lib/lines-root.js";
import { createTestRuntime, createTestWorld, seedSnapshot } from "../../test/world.js";

const LineList = z.strictObject({ runSlug: z.string(), lines: z.array(MemberLineDTO) });

describe("mock fidelity (fs-api's rules)", () => {
  it("pairs a member only under their member number", async () => {
    const { runtime, adapter } = createTestRuntime();
    await runtime.session.start();
    const wrong = await adapter
      .call("createPairing", { body: { persona: "member:m-014", role: "member", memberNo: "M-014" } })
      .catch((e) => e);
    expect(isApiClientError(wrong, "VALIDATION_FAILED")).toBe(true);
    expect(wrong.message).toBe("A member's persona is their member number (M-014).");
    await expect(
      adapter.call("createPairing", { body: { persona: "M-014", role: "member", memberNo: "M-014" } }),
    ).resolves.toMatchObject({ code6: expect.stringMatching(/^\d{6}$/) });
  });

  it("refuses a signed brand link on an acting command (proofExport), and serves it the public read", async () => {
    const { adapter } = createTestRuntime();
    const link = "fsb_0123456789abcdef.mock";
    const refused = await adapter.api
      .proofExport({ params: { runSlug: "2026A-r37" }, token: link })
      .catch((e) => e);
    expect(isApiClientError(refused, "FORBIDDEN")).toBe(true);
    await expect(adapter.api.proof({ params: { runSlug: "2026A-r37" }, token: link })).resolves.toMatchObject(
      {
        bundle: expect.any(Object),
      },
    );
  });

  it("answers 404 for a rate card that is not this workspace's, before the ratified-card trigger", async () => {
    const card = "019ceb5b-fc00-7d12-90d6-000000000001";
    const { runtime, adapter } = createTestRuntime(createTestWorld({ rateCardId: card }));
    await runtime.session.start();
    const body = { label: "Drying fee", amountText: "0.50" };
    const seedId = seedSnapshot().rateCard.id;
    const missing = await adapter.call("addDeduction", { params: { id: seedId }, body }).catch((e) => e);
    expect(isApiClientError(missing, "NOT_FOUND")).toBe(true);
    const ratified = await adapter.call("addDeduction", { params: { id: card }, body }).catch((e) => e);
    expect(isApiClientError(ratified, "RATE_CARD_RATIFIED")).toBe(true);
  });

  it("hashes a line that carries a returned mark with the workspace's mark ID, and signs the workspace's lines root", async () => {
    const { runtime, adapter, world } = createTestRuntime();
    const read = () =>
      adapter.api.request({
        path: "/v1/runs/:runSlug/lines",
        params: { runSlug: world.runSlug },
        schema: LineList,
      });
    const anonymous = await read().catch((e) => e);
    expect(isApiClientError(anonymous, "UNAUTHENTICATED")).toBe(true);
    await runtime.session.start();
    world.markPaid();
    world.resolveAll();
    const { lines } = await read();
    const seed = seedSnapshot().checkpoints.resolved.lines;
    expect(lines).toHaveLength(seed.length);
    // M-018's returned multa (H3) is a credit naming a mark: same cents, the workspace's own hash.
    const served = lines.find((l) => l.memberNo === "M-018");
    const seeded = seed.find((l) => l.memberNo === "M-018");
    expect(seeded?.credits.length).toBeGreaterThan(0);
    expect(served?.netCents).toBe(seeded?.netCents);
    expect(served?.lineSha256).not.toBe(seeded?.lineSha256);
    for (const line of lines.filter((l) => l.creditsCents === 0)) {
      expect(line.lineSha256).toBe(seed.find((l) => l.memberNo === line.memberNo)?.lineSha256);
    }
    const answer = await adapter.call("approvalPayload", {
      params: { runSlug: world.runSlug },
      query: { role: "treasurer" },
    });
    expect(answer.payload.linesDigest).toBe(linesRoot(lines));
    expect(answer.payload.linesDigest).not.toBe(linesRoot(seed));
    expect(answer.jcs).toBe(jcs(answer.payload as unknown as JcsValue));
  });
});
