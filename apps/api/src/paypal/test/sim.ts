// Test harness for the IN-PROCESS simulator rail (ADR-0010): the real @fairsplit/paypal-sim, started through
// paypal/simulator.ts exactly as the server starts it, with no msw anywhere. Its clock is the test's fake clock (so
// signing times and the verifier's 5-minute window agree), its speed 0 (processing and deliveries run on the next
// tick; `sim.idle()` waits for them), and its deliveries go to the test app's own /webhooks/paypal in process.
// One simulator per test file: its interceptor is process-wide (vitest runs each file in its own process).
import { schema } from "@fairsplit/db";
import { parseEnv } from "../../env.js";
import type { RunsHarness } from "../../runs/test/app.js";
import { type SeedWorldOptions, seedWorld } from "../../runs/test/world.js";
import {
  createFakeClock,
  createTestApp,
  type FakeClock,
  TEST_ENV,
  type TestApp,
  type TestAppOptions,
} from "../../test/index.js";
import { recordSimulatorBalance } from "../boot.js";
import {
  type InProcessPayPalSimulator,
  startInProcessSimulator,
  withSimulatorDefaults,
} from "../simulator.js";

export interface TestSimulator {
  sim: InProcessPayPalSimulator;
  clock: FakeClock;
  /** The PP_* env a test app needs for this simulator (its fs-judge app, accounts and this boot's webhook id). */
  env: Record<string, string>;
}

export async function startTestSimulator(
  o: { clock?: FakeClock; duplicate?: boolean; env?: Record<string, string> } = {},
): Promise<TestSimulator> {
  const clock = o.clock ?? createFakeClock();
  const paypal = withSimulatorDefaults(parseEnv({ ...TEST_ENV, ...(o.env ?? {}) }).paypal);
  const sim = await startInProcessSimulator({
    paypal,
    publicOrigin: TEST_ENV.PUBLIC_ORIGIN as string,
    speed: 0,
    now: () => clock.nowMs(),
    duplicate: o.duplicate ?? true,
  });
  const env: Record<string, string> = {
    PP_MODE: "simulator",
    PP_CLIENT_ID: paypal.clientId as string,
    PP_CLIENT_SECRET: paypal.clientSecret as string,
    PP_WEBHOOK_ID: sim.webhookId,
    PP_BUSINESS_EMAIL: paypal.businessEmail as string,
    PP_PAYER_EMAIL: paypal.payerEmail as string,
    PP_RECEIVERS: paypal.receivers as string,
    PP_UNCLAIMED_RECEIVER: paypal.unclaimedReceiver as string,
  };
  return { sim, clock, env };
}

/** A test app on the simulator rail, its deliveries bound to the app's own fetch. */
export async function startSimApp(
  s: TestSimulator,
  o: Omit<TestAppOptions, "simulator" | "clock"> = {},
): Promise<TestApp> {
  const t = await createTestApp({
    ...o,
    clock: s.clock,
    env: { ...s.env, ...(o.env ?? {}) },
    simulator: s.sim.rail,
  });
  s.sim.deliverTo((request) => t.app.fetch(request));
  return t;
}

/**
 * The runs slice's harness (runs/test/app.ts `startRuns`) on the simulator rail: a Postgres app with the outbox
 * wired inline, the seeded world, a token per persona, and the boot's searchBalances reading recorded.
 */
export async function startSimRuns(
  o: { world?: SeedWorldOptions; duplicate?: boolean } = {},
): Promise<RunsHarness & { sim: InProcessPayPalSimulator }> {
  const s = await startTestSimulator({ ...(o.duplicate !== undefined ? { duplicate: o.duplicate } : {}) });
  const t = await startSimApp(s, { db: "postgres", taskHandlers: {} });
  const pg = t.pg;
  if (!pg) throw new Error("the simulator runs harness needs Postgres");
  const world = await seedWorld(pg.app.db, o.world ?? {});
  // the server records it at boot (paypal/boot.ts): Judge Mode's quota counts from the simulator's balance
  await recordSimulatorBalance(t.deps);
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
    paypal: null,
    sim: s.sim,
    async close() {
      await t.close();
      await s.sim.stop();
    },
  };
}

/** The webhook rows the simulator's deliveries left (`webhook_events`), oldest first. */
export async function storedWebhooks(t: TestApp) {
  return t.deps.db
    .select({
      eventType: schema.webhookEvents.eventType,
      verified: schema.webhookEvents.verified,
      status: schema.webhookEvents.status,
      provenance: schema.webhookEvents.provenance,
      paypalEventId: schema.webhookEvents.paypalEventId,
    })
    .from(schema.webhookEvents)
    .orderBy(schema.webhookEvents.receivedAt, schema.webhookEvents.createdAt);
}
