import { getMembers, getRun } from "@fairsplit/seed";
import { setupServer } from "msw/node";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BRAND_ROUTES, brandRoutes } from "./brand.js";
import { createApiClient } from "./client.js";
import { createMockApi, MOCK_CONSOLE_TOKEN } from "./msw/index.js";
import { judgeRoutes } from "./routes.js";

const BASE = "http://localhost:8787";
const mock = createMockApi({ stage: "settled", pace: "manual", baseUrl: BASE });
const server = setupServer(...mock.handlers);
const brand = brandRoutes(createApiClient({ baseUrl: BASE, token: MOCK_CONSOLE_TOKEN }));

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => {
  server.close();
  mock.world.dispose();
});

describe("typed brand view", () => {
  it("declares the server's existing route and returns masked member details once posted", async () => {
    expect(BRAND_ROUTES.view).toMatchObject({ method: "GET", path: "/v1/brand/:runSlug", auth: "public" });
    const view = await brand.view({ params: { runSlug: mock.world.runSlug } });
    expect(view).toMatchObject({ runSlug: mock.world.runSlug, proofReady: true, provenance: "seeded" });
    expect(view.members).toHaveLength(64);
    const member = getMembers().find((m) => m.memberNo === "M-014");
    expect(view.members.find((m) => m.memberNo === "M-014")).toMatchObject({
      name: member?.displayName,
      receiverMasked: member?.receiverMasked,
    });
    expect(view.totals.net.cents).toBe(mock.world.lines().reduce((sum, line) => sum + line.netCents, 0));
    expect(view.exportPath).toBe(`/v1/brand/${mock.world.runSlug}/export.csv`);
    for (const item of getRun().items) expect(JSON.stringify(view)).not.toContain(item.receiver);
  });

  it("accepts an issued brand link and rejects member or unknown brand links", async () => {
    const operator = judgeRoutes(
      createApiClient({ baseUrl: BASE, headers: { cookie: "fs_ops=mock-operator-session" } }),
    );
    const link = await operator.issueBrandLink({ body: { workspaceId: mock.world.workspaceId } });
    const token = link.url.split("/b/")[1] ?? "";
    const reader = brandRoutes(createApiClient({ baseUrl: BASE, token }));
    expect((await reader.view({ params: { runSlug: mock.world.runSlug } })).proofReady).toBe(true);
    for (const [token, code] of [
      ["fsb_unknown.mock", "UNAUTHENTICATED"],
      ["fsm_member.mock", "FORBIDDEN"],
    ] as const) {
      await expect(
        brandRoutes(createApiClient({ baseUrl: BASE, token })).view({
          params: { runSlug: mock.world.runSlug },
        }),
      ).rejects.toMatchObject({ code });
    }
  });

  it("before posting returns only the invoice, with no member facts or hashes", async () => {
    mock.world.reset("invoiced");
    const view = await brand.view({ params: { runSlug: mock.world.runSlug } });
    expect(view).toMatchObject({
      proofReady: false,
      members: [],
      totals: { members: 0, net: { cents: 0 }, paypalMembers: 0, cashMembers: 0 },
      hashes: { batchSha256: null, ledgerHead: null },
    });
  });

  it("follows current payout IDs and statuses through posting, unclaimed and the cash move", async () => {
    mock.world.reset("approve");
    const api = createApiClient({ baseUrl: BASE, token: MOCK_CONSOLE_TOKEN });
    const params = { runSlug: mock.world.runSlug };
    for (const [role, keyId] of [
      ["treasurer", "fs-analyn-w1"],
      ["chair", "fs-ernesto-a1"],
    ] as const) {
      const { payload } = await api.approvalPayload({ params, query: { role } });
      await api.submitApproval({ params, body: { role, keyId, signature: "ab".repeat(64), payload } });
    }
    mock.world.advance(2);
    const pending = (await brand.view({ params })).members.find((m) => m.memberNo === "M-031");
    expect(pending?.itemStatus).toBe("PENDING");
    expect(pending?.payoutItemId).toMatch(/^MOCK/);
    mock.world.settle();
    expect((await brand.view({ params })).members.find((m) => m.memberNo === "M-031")?.itemStatus).toBe(
      "UNCLAIMED",
    );
    const lineId = mock.world.line("M-031")?.id ?? "";
    await api.payCash({ params: { lineId } });
    const returned = (await brand.view({ params })).members.find((m) => m.memberNo === "M-031");
    expect(returned).toMatchObject({
      state: "OFF_RAIL_DUE",
      rail: "PAYPAL",
      itemStatus: "RETURNED",
      payoutItemId: pending?.payoutItemId,
    });
  });

  it("refuses anonymous, member and clerk credentials, and a foreign run", async () => {
    const anonymous = brandRoutes(createApiClient({ baseUrl: BASE }));
    await expect(anonymous.view({ params: { runSlug: mock.world.runSlug } })).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    for (const role of ["member", "clerk"] as const) {
      const token = mock.world.mintToken("fst_", { role, persona: role === "member" ? "M-014" : "jessie" });
      await expect(
        brandRoutes(createApiClient({ baseUrl: BASE, token })).view({
          params: { runSlug: mock.world.runSlug },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(brand.view({ params: { runSlug: "2026A-r999" } })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});
