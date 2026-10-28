// Test-only moves the database refuses at run time. WS-DATA's guards hold for every role (migrations 0006, 0009,
// 0013): a run moves one machine edge at a time with its version, and a workspace's expiry is the database's
// clock (claimed for 24 h, never moved earlier). Tests that need "that run, further on" or "24 hours later" use
// these instead of writing the row:
//   - walkRun: the run moved forward edge by edge along the main path, each step +1 version (as moveRun does);
//   - setWorkspaceExpiry: the expiry an owner writes with the guard switched off for that one statement, standing
//     in for the database's clock moving on (the only way an expiry is ever in the past for a live workspace).
import type { PayRunState } from "@fairsplit/contracts";
import type { Sql } from "postgres";

/** The run machine's main path (domain `runMachine`), from DRAFT to SETTLED. */
const MAIN_PATH: readonly PayRunState[] = [
  "DRAFT",
  "QUOTED",
  "INVOICED",
  "FUNDED",
  "EXTRACTING",
  "COMPUTED",
  "IN_REVIEW",
  "TREASURER_APPROVED",
  "APPROVED",
  "POSTING",
  "POSTED",
  "SETTLING",
  "SETTLED",
];

/** Walks a run forward to `to`, one legal edge per statement (POSTING and later carry a digest and batch id). */
export async function walkRun(
  owner: Sql,
  runId: string,
  to: PayRunState,
  posting: { batchSha256: string; senderBatchId: string } = {
    batchSha256: "b".repeat(64),
    senderBatchId: `test-${runId}`,
  },
): Promise<void> {
  const [row] = await owner<{ state: PayRunState }[]>`select state from pay_runs where id = ${runId}`;
  if (!row) throw new Error(`walkRun: no run ${runId}`);
  const from = MAIN_PATH.indexOf(row.state);
  const target = MAIN_PATH.indexOf(to);
  if (from < 0 || target < from) throw new Error(`walkRun: ${row.state} cannot walk forward to ${to}`);
  for (const next of MAIN_PATH.slice(from + 1, target + 1)) {
    if (next === "POSTING") {
      await owner`update pay_runs set state = ${next}, version = version + 1,
        batch_sha256 = ${posting.batchSha256}, sender_batch_id = ${posting.senderBatchId} where id = ${runId}`;
    } else {
      await owner`update pay_runs set state = ${next}, version = version + 1 where id = ${runId}`;
    }
  }
}

/**
 * Sets a workspace's expiry as the owner, the expiry guard off for that one statement: "the database's clock has
 * moved on" (an expiry in the past) or "back to a workspace that never expires" (null). Nothing else is touched.
 */
export async function setWorkspaceExpiry(owner: Sql, workspaceId: string, at: Date | null): Promise<void> {
  await owner.begin(async (sql) => {
    await sql`alter table workspaces disable trigger workspaces_guard`;
    await sql`update workspaces set expires_at = ${at === null ? null : at.toISOString()}::timestamptz
      where id = ${workspaceId}`;
    await sql`alter table workspaces enable trigger workspaces_guard`;
  });
}
