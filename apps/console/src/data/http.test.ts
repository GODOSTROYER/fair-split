// The HTTP adapter against msw over the seed (the same handlers `vite dev` serves through its service worker):
// every command is driven by its API_COMMANDS entry, requests are checked before they leave, responses before
// anyone reads them, and the run's SSE stream replays from Last-Event-ID. No live API: msw fails anything else.

import { API_COMMANDS, type RunEvent } from "@fairsplit/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startMockServer } from "../test/msw.js";
import { createTestHttpAdapter, createTestWorld } from "../test/world.js";
import type { DataAdapter } from "./adapter.js";
import { ApiRequestError, errorView } from "./errors.js";
import { MOCKED_COMMANDS } from "./mock/handlers.js";
import type { MockWorld } from "./mock/world.js";

let world: MockWorld;
let server: { close(): void };
let adapter: DataAdapter;

beforeEach(() => {
  world = createTestWorld();
  server = startMockServer(world);
  adapter = createTestHttpAdapter();
});

afterEach(() => server.close());

describe("HTTP adapter over msw", () => {
  it("the mock answers exactly the contract's commands", () => {
    expect([...MOCKED_COMMANDS].sort()).toEqual(Object.keys(API_COMMANDS).sort());
  });

  it("starts a judge session and funds the run, all inside the contract", async () => {
    const session = await adapter.call("createJudgeSession", { body: {} });
    expect(session.runSlug).toMatch(/^2026A-r4170001$/);
    adapter.setToken(session.consoleToken);
    const paid = await adapter.call("markPaid", { params: { runSlug: session.runSlug }, body: {} });
    expect(paid).toMatchObject({
      invoiceStatus: "MARKED_AS_PAID",
      runState: "FUNDED",
      provenance: "simulated_rail",
    });
  });

  it("refuses a command without a session (401, UNAUTHENTICATED)", async () => {
    const failure = await adapter
      .call("markPaid", { params: { runSlug: "2026A-r37" }, body: {} })
      .catch((e) => e);
    expect(failure).toBeInstanceOf(ApiRequestError);
    expect((failure as ApiRequestError).code).toBe("UNAUTHENTICATED");
  });

  it("checks a request against its schema before it leaves", async () => {
    await expect(
      adapter.call("enterField", { params: { fieldId: "f" }, body: { value: "" } } as never),
    ).rejects.toThrow();
  });

  it("MM-4: adding a deduction to the ratified card is a 409 that cites the card's hash", async () => {
    const session = await adapter.call("createJudgeSession", { body: {} });
    adapter.setToken(session.consoleToken);
    const failure = (await adapter
      .call("addDeduction", {
        params: { id: world.snapshot.rateCard.id },
        body: { label: "Multa", amountText: "200" },
      })
      .catch((e) => e)) as ApiRequestError;
    expect(failure.status).toBe(409);
    expect(failure.ratified()?.hash).toBe(world.snapshot.rateCard.sha256);
    expect(errorView(failure).title).toMatch(/ratified/);
  });

  it("streams the run's events and replays from Last-Event-ID", async () => {
    const session = await adapter.call("createJudgeSession", { body: {} });
    adapter.setToken(session.consoleToken);
    await adapter.call("markPaid", { params: { runSlug: session.runSlug }, body: {} });
    const all = world.eventsAfter(`run:${session.runSlug}`, null);
    const middle = all[Math.floor(all.length / 2)];
    if (!middle) throw new Error("no events");
    const received: RunEvent[] = [];
    const stop = adapter.subscribe(
      { kind: "run", runSlug: session.runSlug },
      { onEvent: (e) => received.push(e) },
      { lastEventId: middle.id },
    );
    await expect
      .poll(() => received.length, { timeout: 5000 })
      .toBe(all.filter((e) => Number(e.id) > Number(middle.id)).length);
    // A live event arrives on the open stream.
    const h1 = world.holdIdFor(session.runSlug, "H1");
    if (!h1) throw new Error("no H1");
    await adapter.call("resolveHold", { params: { holdId: h1 }, body: { resolution: "COUNT_ONCE" } });
    await expect.poll(() => received.some((e) => e.type === "hold.resolved"), { timeout: 5000 }).toBe(true);
    stop();
    expect(received.every((e) => Number(e.id) > Number(middle.id))).toBe(true);
  });

  it("reads Proof in public, member IDs only (C-23)", async () => {
    const proof = await adapter.call("proof", { params: { runSlug: "2026A-r37" } });
    expect(proof.redacted).toBe(true);
    const json = await adapter.call("proofJson", { params: { runSlug: "2026A-r37" } });
    expect(json.bundle).toEqual(proof.bundle);
  });

  it("mints frame tokens for the three personas once a session exists", async () => {
    const session = await adapter.call("createJudgeSession", { body: {} });
    adapter.setToken(session.consoleToken);
    const grant = await adapter.pending.frameToken(session.sessionId, "chair");
    expect(grant.persona).toBe("board:ernesto");
    expect(grant.ws).toBe(session.workspaceId);
    expect(grant.exp).toBeGreaterThan(Date.now());
  });
});
