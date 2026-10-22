import { describe, expect, it, vi } from "vitest";
import { type ProbeClient, probeDatabase, ROLE_QUERY } from "../src/db-probe.js";

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

describe("probeDatabase (spike S6: private-network reach, CREATE ROLE, app-role privileges)", () => {
  it("skips without DATABASE_URL", async () => {
    await expect(probeDatabase(undefined)).resolves.toEqual({
      configured: false,
      reachable: false,
      canCreateRole: null,
    });
  });

  it("reports reach and role capability as booleans with timings", async () => {
    const client = fakeClient([{ can_create_role: true, ledger_writable: false }]);
    let t = 0;
    const r = await probeDatabase(
      URL,
      () => client,
      () => (t += 5),
    );
    expect(r).toEqual({
      configured: true,
      reachable: true,
      canCreateRole: true,
      ledgerWritable: false,
      connectMs: 5,
      queryMs: 5,
    });
    expect(client.query).toHaveBeenLastCalledWith(ROLE_QUERY);
    expect(client.end).toHaveBeenCalled();
  });

  it("a role without CREATEROLE reports false (the trigger fallback applies)", async () => {
    const r = await probeDatabase(URL, () => fakeClient([{ can_create_role: false }]));
    expect(r.canCreateRole).toBe(false);
  });

  it("reports a role that could rewrite ledger_entries (register §7), and null before the table exists", async () => {
    const writable = await probeDatabase(URL, () =>
      fakeClient([{ can_create_role: true, ledger_writable: true }]),
    );
    expect(writable.ledgerWritable).toBe(true);
    const early = await probeDatabase(URL, () =>
      fakeClient([{ can_create_role: true, ledger_writable: null }]),
    );
    expect(early.ledgerWritable).toBeNull();
    expect(ROLE_QUERY).toMatch(/to_regclass\('public\.ledger_entries'\)/);
    expect(ROLE_QUERY).toMatch(/has_table_privilege\(current_user, 'public\.ledger_entries', 'UPDATE'\)/);
  });

  it("returns only an error code, never the URL, host or message", async () => {
    const r = await probeDatabase(URL, () => fakeClient([], { at: 0, code: "28P01" }));
    expect(r).toMatchObject({ configured: true, reachable: false, canCreateRole: null, errorCode: "28P01" });
    expect(JSON.stringify(r)).not.toMatch(/db\.internal|fs_owner|boom/);
  });

  it("distinguishes reachable-but-role-query-failed from unreachable", async () => {
    const r = await probeDatabase(URL, () => fakeClient([], { at: 1, code: "42501" }));
    expect(r).toMatchObject({
      reachable: true,
      canCreateRole: null,
      ledgerWritable: null,
      errorCode: "42501",
    });
  });

  it("with the real driver, an unreachable server is reported by code", async () => {
    const r = await probeDatabase("postgres://probe@127.0.0.1:1/x");
    expect(r.reachable).toBe(false);
    expect(r.errorCode).toBe("ECONNREFUSED");
  });
});
