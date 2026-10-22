import { describe, expect, it, vi } from "vitest";
import { type ProbeClient, probeDatabase } from "../src/db-probe.js";

const URL = "postgres://fs_owner@db.internal:5432/fairsplit";

function fakeClient(rows: Record<string, unknown>[], fail?: { at: number; code: string }): ProbeClient {
  let calls = 0;
  return {
    query: vi.fn(async () => {
      if (fail && calls++ === fail.at) throw Object.assign(new Error(`boom ${URL}`), { code: fail.code });
      return rows;
    }),
    end: vi.fn(async () => undefined),
  };
}

describe("probeDatabase (spike S6: private-network reach and CREATE ROLE)", () => {
  it("skips without DATABASE_URL", async () => {
    await expect(probeDatabase(undefined)).resolves.toEqual({
      configured: false,
      reachable: false,
      canCreateRole: null,
    });
  });

  it("reports reach and role capability as booleans with timings", async () => {
    const client = fakeClient([{ can_create_role: true }]);
    let t = 0;
    const r = await probeDatabase(
      URL,
      () => client,
      () => (t += 5),
    );
    expect(r).toEqual({ configured: true, reachable: true, canCreateRole: true, connectMs: 5, queryMs: 5 });
    expect(client.end).toHaveBeenCalled();
  });

  it("a role without CREATEROLE reports false (the trigger fallback applies)", async () => {
    const r = await probeDatabase(URL, () => fakeClient([{ can_create_role: false }]));
    expect(r.canCreateRole).toBe(false);
  });

  it("returns only an error code, never the URL, host or message", async () => {
    const r = await probeDatabase(URL, () => fakeClient([], { at: 0, code: "28P01" }));
    expect(r).toMatchObject({ configured: true, reachable: false, canCreateRole: null, errorCode: "28P01" });
    expect(JSON.stringify(r)).not.toMatch(/db\.internal|fs_owner|boom/);
  });

  it("distinguishes reachable-but-role-query-failed from unreachable", async () => {
    const r = await probeDatabase(URL, () => fakeClient([], { at: 1, code: "42501" }));
    expect(r).toMatchObject({ reachable: true, canCreateRole: null, errorCode: "42501" });
  });

  it("with the real driver, an unreachable server is reported by code", async () => {
    const r = await probeDatabase("postgres://probe@127.0.0.1:1/x");
    expect(r.reachable).toBe(false);
    expect(r.errorCode).toBe("ECONNREFUSED");
  });
});
