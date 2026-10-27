import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { batchBody, call, canonicalInvoice, fakeTime, MEMBER_PAYOUTS, newSim, token } from "./helpers.js";

describe("persistence and reset", () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), "paypal-sim-"));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    vi.useRealTimers();
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it("stores signing keys under the data directory and reuses them on the next start", async () => {
    const dir = tmp();
    const a = await newSim({ dataDir: dir });
    const certId = a.signing.certId;
    await a.close();
    expect(existsSync(join(dir, "certs", "leaf.key.pem"))).toBe(true);
    expect(existsSync(join(dir, "certs", "leaf.cert.pem"))).toBe(true);
    const b = await newSim({ dataDir: dir });
    expect(b.signing.certId).toBe(certId);
    await b.close();
  });

  it("snapshots state to .data/state.json and restores it (including in-flight batches)", async () => {
    // Fake timers: the 60 s batch cannot start and the 250 ms snapshot timer cannot fire until the test moves
    // the clock, so what gets saved does not depend on how fast the machine is.
    fakeTime({ timers: true });
    const dir = tmp();
    const a = await newSim({
      dataDir: dir,
      persist: true,
      speed: 1,
      timing: { batchProcessingS: 60, itemS: 1, batchCompleteS: 1 },
    });
    const tok = await token(a);
    const created = await call(a, "POST", "/v2/invoicing/invoices", {
      token: tok,
      body: canonicalInvoice("FS-PERSIST"),
    });
    expect(created.status).toBe(201);
    const file = join(dir, "state.json");
    expect(existsSync(file)).toBe(false);
    await vi.advanceTimersByTimeAsync(250); // the debounced snapshot
    expect(Object.keys(JSON.parse(readFileSync(file, "utf8")).invoices)).toHaveLength(1);
    const batch = await call(a, "POST", "/v1/payments/payouts", {
      token: tok,
      body: batchBody("2026A-persist", MEMBER_PAYOUTS.slice(0, 1)),
    });
    expect(batch.status).toBe(201);
    await a.close(); // flushes the pending snapshot
    const snapshot = JSON.parse(readFileSync(file, "utf8")) as {
      invoices: object;
      batches: Record<string, { status: string }>;
    };
    expect(Object.keys(snapshot.invoices)).toHaveLength(1);
    expect(Object.values(snapshot.batches).map((b) => b.status)).toEqual(["PENDING"]); // saved in flight

    const b = await newSim({ dataDir: dir, persist: true });
    const tok2 = Object.keys(b.state.tokens)[0] as string;
    const id = String(created.json.href).split("/").pop();
    expect(
      (await call(b, "GET", `/v2/invoicing/invoices/${id}`, { token: tok2 })).json.detail.invoice_number,
    ).toBe("FS-PERSIST");
    await b.idle();
    const got = await call(b, "GET", `/v1/payments/payouts/${batch.json.batch_header.payout_batch_id}`, {
      token: tok2,
    });
    expect(got.json.batch_header.batch_status).toBe("SUCCESS");
    await b.close();
  });

  it("reset() restores the seeded world (Judge Mode)", async () => {
    const sim = await newSim();
    const tok = await token(sim);
    await call(sim, "POST", "/v1/payments/payouts", { token: tok, body: batchBody("2026A-reset") });
    await sim.idle();
    expect(sim.balance("coop", "USD").available).toBeLessThan(10_000_000);
    sim.reset();
    expect(sim.balance("coop", "USD")).toEqual({ available: 10_000_000, withheld: 0 });
    expect(Object.keys(sim.state.batches)).toHaveLength(0);
    expect((await call(sim, "GET", "/v1/notifications/webhooks", { token: tok })).status).toBe(401);
    await sim.close();
  });
});
