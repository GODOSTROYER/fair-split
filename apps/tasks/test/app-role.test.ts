// The S3.4 role check every entry makes before its first task (src/app-role.ts).
import { describe, expect, it, vi } from "vitest";
import { appRoleGate, LedgerWritableError, RoleCheckUnavailableError } from "../src/app-role.js";
import type { DbProbeResult } from "../src/db-probe.js";
import { PermanentTaskError } from "../src/handlers.js";

const reached = (ledgerWritable: boolean | null): DbProbeResult => ({
  configured: true,
  reachable: true,
  canCreateRole: false,
  ledgerWritable,
  connectMs: 3,
  queryMs: 1,
});

/** A probe that returns `results` in order, then repeats the last one. */
function probeOf(...results: DbProbeResult[]) {
  let i = 0;
  return vi.fn(
    async (): Promise<DbProbeResult> => results[Math.min(i++, results.length - 1)] as DbProbeResult,
  );
}

describe("appRoleGate (S3.4: refuse a role that can UPDATE ledger_entries)", () => {
  it("lets fs_app through, asking the database once per process", async () => {
    const probe = probeOf(reached(false));
    const gate = appRoleGate(probe);
    await gate();
    await gate();
    await gate();
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("refuses a ledger-writable role permanently (BOOT_REFUSED), and keeps refusing without asking again", async () => {
    const probe = probeOf(reached(true), reached(false));
    const gate = appRoleGate(probe);
    const first = await gate().catch((e: unknown) => e);
    expect(first).toBeInstanceOf(LedgerWritableError);
    expect(first).toBeInstanceOf(PermanentTaskError);
    expect(first).toMatchObject({ code: "BOOT_REFUSED" });
    expect((first as Error).message).toMatch(/can UPDATE ledger_entries/);
    await expect(gate()).rejects.toBe(first);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("an unreachable database is transient: the run fails, and the next run asks again", async () => {
    const probe = probeOf(
      {
        configured: true,
        reachable: false,
        canCreateRole: null,
        ledgerWritable: null,
        errorCode: "ECONNREFUSED",
      },
      reached(false),
    );
    const gate = appRoleGate(probe);
    const err = await gate().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RoleCheckUnavailableError);
    expect(err).not.toBeInstanceOf(PermanentTaskError);
    expect((err as Error).message).toBe("database role check failed (ECONNREFUSED)");
    await expect(gate()).resolves.toBeUndefined();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("a role query that failed, or a database not migrated yet, cannot prove the role safe: transient", async () => {
    const failed = appRoleGate(
      probeOf({
        configured: true,
        reachable: true,
        canCreateRole: null,
        ledgerWritable: null,
        errorCode: "42501",
      }),
    );
    await expect(failed()).rejects.toThrow("database role check failed (42501)");
    const early = appRoleGate(probeOf(reached(null)));
    await expect(early()).rejects.toThrow(RoleCheckUnavailableError);
    await expect(early()).rejects.toThrow(/run the migrations first/);
  });

  it("passes when no database is configured (a local run with nothing to protect)", async () => {
    const probe = probeOf({ configured: false, reachable: false, canCreateRole: null });
    await expect(appRoleGate(probe)()).resolves.toBeUndefined();
  });

  it("concurrent first runs share one check", async () => {
    let release!: (r: DbProbeResult) => void;
    const probe = vi.fn(
      () =>
        new Promise<DbProbeResult>((resolve) => {
          release = resolve;
        }),
    );
    const gate = appRoleGate(probe);
    const runs = [gate(), gate(), gate()];
    release(reached(false));
    await expect(Promise.all(runs)).resolves.toEqual([undefined, undefined, undefined]);
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("never puts the URL, the host or the driver's message in its errors", async () => {
    const gate = appRoleGate(
      probeOf({
        configured: true,
        reachable: false,
        canCreateRole: null,
        ledgerWritable: null,
        errorCode: "28P01",
      }),
    );
    const err = (await gate().catch((e: unknown) => e)) as Error;
    expect(err.message).toBe("database role check failed (28P01)");
  });
});
