// Test setup for the RUNS slice: a Postgres-backed app with the outbox runtime wired (no background
// dispatcher, so every task runs inline and deterministically), the seeded world, and one token per persona.
import { schema } from "@fairsplit/db";
import { approvalBytes, ed25519Sign } from "@fairsplit/domain";
import { and, eq } from "drizzle-orm";
import type { HttpHandler } from "msw";
import { createPayPalMock, createTestApp, type PayPalMock, type TestApp } from "../../test/index.js";
import { registerKey, type SeedWorld, type SeedWorldOptions, seedWorld, testKeyPair } from "./world.js";

export interface RunsHarness {
  t: TestApp;
  world: SeedWorld;
  tokens: { treasurer: string; chair: string; clerk: string; member: string; brand: string };
  paypal: PayPalMock | null;
  close(): Promise<void>;
}

/** PP_RECEIVERS on the sandbox rail: every PayPal member of the seed except Rhea (no PayPal account). */
export const SANDBOX_RECEIVERS: Readonly<Record<string, string>> = {
  "M-002": "m002@example.com",
  "M-007": "m007@example.com",
  "M-014": "m014@example.com",
  "M-018": "m018@example.com",
  "M-022": "m022@example.com",
  "M-039": "m039@example.com",
  "M-060": "m060@example.com",
};

/** Sandbox mode (msw answers PayPal) when PayPal handlers are given; the labelled simulator stub otherwise. */
export async function startRuns(
  o: {
    world?: SeedWorldOptions;
    paypal?: HttpHandler[];
    clock?: string;
    /** PP_RECEIVERS on the sandbox rail (default SANDBOX_RECEIVERS). */
    receivers?: Readonly<Record<string, string>>;
  } = {},
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
            PP_RECEIVERS: JSON.stringify(o.receivers ?? SANDBOX_RECEIVERS),
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

/**
 * Both officers sign the batch (registering their device keys the first time): the run is APPROVED with its
 * POST queued. Signing again after a send-back reuses the keys already on file.
 */
export async function signBoth(h: RunsHarness) {
  const db = h.t.pg?.app.db;
  const owner = h.t.pg?.owner.db;
  if (!db || !owner) throw new Error("signBoth needs Postgres");
  const ws = h.world.workspaceId;
  const officerKey = async (keyId: string, persona: string) => {
    const [onFile] = await owner
      .select({ id: schema.deviceKeys.id })
      .from(schema.deviceKeys)
      .where(and(eq(schema.deviceKeys.workspaceId, ws), eq(schema.deviceKeys.keyId, keyId)));
    return onFile ? testKeyPair(ws, keyId) : registerKey(db, ws, { keyId, persona });
  };
  const analyn = await officerKey("fs-analyn-a1", "analyn");
  const ernesto = await officerKey("fs-ernesto-a1", "ernesto");
  const runSlug = h.world.runSlug;
  const t = (
    await h.t
      .client(h.tokens.treasurer)
      .approvalPayload({ params: { runSlug }, query: { role: "treasurer" } })
  ).payload;
  await h.t.client(h.tokens.treasurer).submitApproval({
    params: { runSlug },
    body: {
      role: "treasurer",
      keyId: "fs-analyn-a1",
      signature: ed25519Sign(analyn.privateKey, approvalBytes(t)),
      payload: t,
    },
  });
  const c = (
    await h.t.client(h.tokens.chair).approvalPayload({ params: { runSlug }, query: { role: "chair" } })
  ).payload;
  await h.t.client(h.tokens.chair).submitApproval({
    params: { runSlug },
    body: {
      role: "chair",
      keyId: "fs-ernesto-a1",
      signature: ed25519Sign(ernesto.privateKey, approvalBytes(c)),
      payload: c,
    },
  });
  return { batchSha256: t.batchSha256, keys: { analyn, ernesto } };
}

/** Runs every queued outbox row of one task in this workspace, inline. */
export async function runQueued(h: RunsHarness, name: string): Promise<number> {
  const rows = await h.t.deps.db
    .select({ id: schema.taskOutbox.id, state: schema.taskOutbox.state })
    .from(schema.taskOutbox)
    .where(and(eq(schema.taskOutbox.workspaceId, h.world.workspaceId), eq(schema.taskOutbox.name, name)));
  const queued = rows.filter((r) => r.state === "queued");
  for (const r of queued) await h.t.deps.outbox?.runTask(r.id);
  return queued.length;
}
