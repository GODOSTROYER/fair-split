import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  dbOk,
  dbVerdicts,
  deployReadiness,
  percentile,
  reachHint,
  STARTTASK_P50_BUDGET_MS,
} from "../../../tools/spike-s6.js";
import type { DbProbeResult } from "../src/db-probe.js";

const healthy: DbProbeResult = {
  configured: true,
  reachable: true,
  canCreateRole: false,
  ledgerWritable: false,
  connectMs: 12,
  queryMs: 3,
};

let root: string | undefined;
afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = undefined;
});

describe("spike S6 verdicts (register §12, S3.14)", () => {
  it("the startTask budget is register §12's 10 s, judged at the median", () => {
    expect(STARTTASK_P50_BUDGET_MS).toBe(10_000);
    expect(percentile([9_000, 1_000, 30_000], 50)).toBe(9_000);
    expect(percentile([5], 99)).toBe(5);
    expect(Number.isNaN(percentile([], 50))).toBe(true);
  });

  it("a connection as fs_app answers both database questions, then checks fs_app's privileges", () => {
    expect(dbVerdicts(healthy)).toEqual([
      "fs-db reach from workflow as fs_app: PASS (connect 12 ms, query 3 ms)",
      "CREATE ROLE for the owner: YES (migrate created fs_app with LOGIN, S3.4)",
      "fs_app privileges: PASS (fs_app cannot create roles)",
      "append-only for the app role: PASS (fs_app cannot UPDATE ledger_entries)",
    ]);
    expect(dbOk(healthy)).toBe(true);
  });

  it("fails S6 when fs-tasks could rewrite the ledger or create roles (it is not running as fs_app)", () => {
    const owner = { ...healthy, canCreateRole: true, ledgerWritable: true };
    expect(dbVerdicts(owner).join("\n")).toMatch(/FAIL \(fs-tasks runs as a role that can create roles/);
    expect(dbVerdicts(owner).join("\n")).toMatch(
      /FAIL \(fs-tasks' role can UPDATE ledger_entries; register §7\)/,
    );
    expect(dbOk(owner)).toBe(false);
    expect(dbOk({ ...healthy, ledgerWritable: null })).toBe(false);
    expect(dbVerdicts({ ...healthy, ledgerWritable: null }).at(-1)).toMatch(
      /UNKNOWN \(no ledger_entries yet/,
    );
  });

  it("explains a failed connection by its code, never by the error text", () => {
    const failed: DbProbeResult = {
      configured: true,
      reachable: false,
      canCreateRole: null,
      errorCode: "28P01",
    };
    expect(dbVerdicts(failed)[0]).toBe(
      "fs-db reach from workflow as fs_app: FAIL (28P01) → fs_app's password differs from fs-api's FS_APP_DB_PASSWORD: copy it to fs-tasks, then redeploy fs-api",
    );
    expect(reachHint("28000")).toMatch(/S3.4 fallback/);
    expect(reachHint("ECONNREFUSED")).toMatch(/private-network route/);
    expect(reachHint("XX000")).toBe("see the fs-tasks run log");
    expect(dbOk(failed)).toBe(false);
    expect(dbOk(undefined)).toBe(false);
  });

  it("skips without database settings", () => {
    const none: DbProbeResult = { configured: false, reachable: false, canCreateRole: null };
    expect(dbVerdicts(none)[0]).toMatch(/^fs-db reach: SKIP/);
    expect(dbOk(none)).toBe(false);
  });

  it("knows whether the whole Blueprint can deploy yet, or only fs-tasks", () => {
    root = mkdtempSync(join(tmpdir(), "fs-s6-"));
    expect(deployReadiness(root)).toEqual({
      full: false,
      missing: ["@fairsplit/api build script (WS-API)", "@fairsplit/db migrate script (WS-DATA)"],
    });
    for (const [dir, scripts] of [
      ["apps/api", { build: "tsdown" }],
      ["packages/db", { migrate: "tsx src/cli/migrate.ts" }],
    ] as const) {
      mkdirSync(join(root, dir), { recursive: true });
      writeFileSync(join(root, dir, "package.json"), JSON.stringify({ scripts }));
    }
    expect(deployReadiness(root)).toEqual({ full: true, missing: [] });
  });
});
