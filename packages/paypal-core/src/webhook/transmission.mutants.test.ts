// Tests that kill mutation-testing survivors (handoff T3) in the freshness inputs of webhook
// verification: the strict transmission-time parser (each field's range, fractions, the zone offset
// and its sign) and the certificate URL checks (length, scheme, credentials, query or fragment).
import { describe, expect, it } from "vitest";
import { checkCertUrl, checkSimulatorCertUrl } from "./cert-url.js";
import { createMemoryTransmissionStore, parseTransmissionTime } from "./transmission.js";

const HOSTS = ["api.sandbox.paypal.com"];
const CERT = "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-360caa42-fca2a594-bf9ab596";
const SIM = /^https?:\/\/[^/?#]+\/paypal-sim\/sim\/certs\/SIMCERT-[0-9a-f]{8}-[0-9a-f]{8}-[0-9a-f]{8}\.pem$/;
const SIM_CERT = "http://127.0.0.1:4010/paypal-sim/sim/certs/SIMCERT-00000000-00000000-00000000.pem";

describe("parseTransmissionTime", () => {
  it("reads every field at its upper edge and refuses one past it", () => {
    expect(parseTransmissionTime("2026-12-31T23:59:59Z")).toBe(Date.UTC(2026, 11, 31, 23, 59, 59));
    expect(parseTransmissionTime("2026-01-01T00:00:00Z")).toBe(Date.UTC(2026, 0, 1));
    for (const bad of [
      "2026-13-01T00:00:00Z",
      "2026-00-01T00:00:00Z",
      "2026-01-00T00:00:00Z",
      "2026-01-01T24:00:00Z",
      "2026-01-01T00:60:00Z",
      "2026-01-01T00:00:60Z",
      "2026-02-30T00:00:00Z",
      "0099-01-01T00:00:00Z",
      "2026-01-01T00:00:00+24:00",
      "2026-01-01T00:00:00+00:60",
    ]) {
      expect(parseTransmissionTime(bad)).toBeNull();
    }
  });

  it("applies a zone offset with its sign, hours and minutes", () => {
    const utc = Date.UTC(2026, 0, 1, 12, 0, 0);
    expect(parseTransmissionTime("2026-01-01T17:30:00+05:30")).toBe(utc);
    expect(parseTransmissionTime("2026-01-01T06:30:00-05:30")).toBe(utc);
    expect(parseTransmissionTime("2026-01-01T23:59:00+23:59")).toBe(Date.UTC(2026, 0, 1, 0, 0, 0));
  });

  it("keeps milliseconds from a fraction of any length", () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    expect(parseTransmissionTime("2026-01-01T00:00:00.5Z")).toBe(base + 500);
    expect(parseTransmissionTime("2026-01-01T00:00:00.123456789Z")).toBe(base + 123);
  });
});

describe("the in-memory transmission store", () => {
  it("an id expiring exactly now is free again; a full store with expired ids makes room", async () => {
    let t = 1_000;
    const store = createMemoryTransmissionStore({ now: () => t, maxEntries: 1 });
    expect(await store.claim("a", 2_000)).toBe(true);
    expect(await store.claim("a", 3_000)).toBe(false);
    t = 2_000;
    expect(await store.claim("b", 3_000)).toBe(true); // a expired at exactly 2,000: swept to make room
    await expect(store.claim("c", 4_000)).rejects.toThrow("transmission store full"); // b holds the slot
    expect(await store.claim("b", 4_000)).toBe(false); // a repeat of a live id is a replay, not "full"
  });
});

describe("certificate URLs", () => {
  it.each([checkCertUrl, (v: string) => checkSimulatorCertUrl(v, SIM)] as const)(
    "refuses an empty or over-long URL, credentials, a query or a fragment",
    (check) => {
      const good = check === checkCertUrl ? CERT : SIM_CERT;
      const run = (v: string) =>
        check === checkCertUrl ? checkCertUrl(v, HOSTS) : checkSimulatorCertUrl(v, SIM);
      expect(run(good).ok).toBe(true);
      expect(run("")).toMatchObject({ ok: false, reason: "NOT_A_URL" });
      expect(run(`${good}${"x".repeat(501 - good.length)}`)).toMatchObject({
        ok: false,
        reason: "NOT_A_URL",
      });
      expect(run(good.replace("://", "://user:pw@"))).toMatchObject({ ok: false, reason: "HAS_CREDENTIALS" });
      expect(run(good.replace("://", "://user@"))).toMatchObject({ ok: false, reason: "HAS_CREDENTIALS" });
      expect(run(`${good}?x=1`).ok).toBe(false);
      expect(run(`${good}#x`).ok).toBe(false);
      expect(run(`${good}?`).ok).toBe(false);
    },
  );

  it("the simulator's certificate may be plain http only on a loopback host", () => {
    expect(checkSimulatorCertUrl(SIM_CERT, SIM).ok).toBe(true);
    expect(checkSimulatorCertUrl(SIM_CERT.replace("127.0.0.1", "10.0.0.5"), SIM).ok).toBe(false);
  });
});
