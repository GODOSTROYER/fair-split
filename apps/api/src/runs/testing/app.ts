// Test setup for the RUNS slice: a Postgres-backed app with the outbox runtime wired (no background
// dispatcher, so every task runs inline and deterministically), the seeded world, and one token per persona.
import type { HttpHandler } from "msw";
import { createPayPalMock, createTestApp, type PayPalMock, type TestApp } from "../../test/index.js";
import { type SeedWorld, type SeedWorldOptions, seedWorld } from "./world.js";

export interface RunsHarness {
  t: TestApp;
  world: SeedWorld;
  tokens: { treasurer: string; chair: string; clerk: string; member: string; brand: string };
  paypal: PayPalMock | null;
  close(): Promise<void>;
}

/** Sandbox mode (msw answers PayPal) when PayPal handlers are given; the labelled simulator stub otherwise. */
export async function startRuns(
  o: { world?: SeedWorldOptions; paypal?: HttpHandler[]; clock?: string } = {},
): Promise<RunsHarness> {
  const paypal = o.paypal ? createPayPalMock(o.paypal) : null;
  paypal?.start();
  const t = await createTestApp({
    db: "postgres",
    taskHandlers: {},
    ...(o.clock ? { clock: o.clock } : {}),
    ...(paypal
      ? {
          env: {
            PP_MODE: "sandbox",
            PP_CLIENT_ID: "test-client",
            PP_CLIENT_SECRET: "test-secret",
            PP_WEBHOOK_ID: "WH-TEST",
            PP_BUSINESS_EMAIL: "coop-business@example.com",
            PP_PAYER_EMAIL: "lantern-bay@example.com",
            PP_RECEIVERS: JSON.stringify({
              "M-002": "m002@example.com",
              "M-007": "m007@example.com",
              "M-014": "m014@example.com",
              "M-018": "m018@example.com",
              "M-022": "m022@example.com",
              "M-039": "m039@example.com",
              "M-060": "m060@example.com",
            }),
            PP_UNCLAIMED_RECEIVER: "rhea-no-account@example.com",
          },
        }
      : {}),
  });
  const pg = t.pg;
  if (!pg) throw new Error("the runs harness needs Postgres");
  const world = await seedWorld(pg.app.db, o.world ?? {});
  const ws = world.workspaceId;
  const tokens = {
    treasurer: await t.credentials.frameToken({ workspaceId: ws, role: "treasurer", persona: "analyn" }),
    chair: await t.credentials.frameToken({ workspaceId: ws, role: "board", persona: "ernesto" }),
    clerk: await t.credentials.frameToken({ workspaceId: ws, role: "clerk", persona: "jessie" }),
    member: await t.credentials.frameToken({ workspaceId: ws, role: "member", persona: "celing" }),
    brand: await t.credentials.frameToken({ workspaceId: ws, role: "brand", persona: "dana" }),
  };
  return {
    t,
    world,
    tokens,
    paypal,
    async close() {
      await t.close();
      paypal?.stop();
    },
  };
}

/** The review the treasurer does in the film: slip 0462 by hand, H1 counted once, H2's plot registered, H3 returned as credit. */
export async function resolveAll(h: RunsHarness): Promise<void> {
  const api = h.t.client(h.tokens.treasurer);
  await api.enterField({ params: { fieldId: h.world.fields0462.gross }, body: { value: "64.80" } });
  const r = await h.t.json<{ holds: { id: string; label: string; state: string }[] }>(
    `/v1/runs/${h.world.runSlug}/holds`,
    {
      as: h.t.credentials.bearer(h.tokens.treasurer),
    },
  );
  const id = (label: string) => {
    const hold = r.body.holds.find((x) => x.label === label);
    if (!hold) throw new Error(`no hold ${label}`);
    return hold.id;
  };
  await api.resolveHold({ params: { holdId: id("H1") }, body: { resolution: "COUNT_ONCE" } });
  await api.resolveHold({
    params: { holdId: id("H2") },
    body: { resolution: "REGISTER_PLOT", plot: { plotNo: "P-053-B", areaHa: "0.60", trees: 330 } },
  });
  await api.resolveHold({ params: { holdId: id("H3") }, body: { resolution: "RETURN_AS_CREDIT" } });
}
