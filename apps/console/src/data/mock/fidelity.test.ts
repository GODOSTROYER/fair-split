// The console's mock answers as fs-api does where api-client's mock is lenient: a member's persona is their
// member number, a signed link cannot run an acting command, and a rate card is looked up in the workspace.

import { isApiClientError } from "@fairsplit/api-client";
import { describe, expect, it } from "vitest";
import { createTestRuntime, createTestWorld, seedSnapshot } from "../../test/world.js";

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
});
