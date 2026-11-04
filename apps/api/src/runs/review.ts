// The review window of a run. Hold resolutions and by-hand entries change lines, so they are allowed while the
// run is IN_REVIEW. After key 1 (TREASURER_APPROVED, AWAITING_BOARD) or both keys (APPROVED, not yet posting)
// an edit voids both approvals and sends the run back to IN_REVIEW (architecture §4, S3.5: "A line edit after
// key 1 voids both approvals"); the signatures bound the old batch digest, so they can never pay the new one.
// From POSTING on, money is moving: the edit is refused.
import type { PayRunState, Provenance } from "@fairsplit/contracts";
import type { DbOrTx, WorkspaceScope } from "@fairsplit/db";
import { ApiProblem } from "../lib/problem.js";
import { assertNoCashLines, unlockLines, voidLiveApprovals } from "./flags.js";
import { cause, moveRun, type RunRow } from "./machine.js";

export const SIGNING_STATES: readonly PayRunState[] = ["TREASURER_APPROVED", "AWAITING_BOARD", "APPROVED"];

export function tooLate(run: RunRow, what: string): ApiProblem {
  return new ApiProblem(
    "VERSION_CONFLICT",
    `The run is ${run.state} now, so ${what} can no longer change it. Reload.`,
    { details: { runState: run.state, runVersion: run.version } },
  );
}

/**
 * Opens the run for a review edit (inside the caller's workspace transaction, with the run row locked):
 * IN_REVIEW as is; a signing state is sent back with its approvals voided; anything else is refused.
 */
export async function openForEdit(
  tx: DbOrTx,
  scope: WorkspaceScope,
  run: RunRow,
  o: { at: Date; provenance: Provenance; what: string },
): Promise<{ run: RunRow; sentBack: boolean }> {
  await assertNoCashLines(tx, scope, run.id);
  if (run.state === "IN_REVIEW") return { run, sentBack: false };
  if (!SIGNING_STATES.includes(run.state as PayRunState)) throw tooLate(run, o.what);
  await voidLiveApprovals(tx, scope, run.id, o.at, "line_edit");
  await unlockLines(tx, scope, run.id, "SEND_BACK");
  const moved = await moveRun(tx, scope, {
    id: run.id,
    from: run.state as PayRunState,
    to: "IN_REVIEW",
    version: run.version,
    cause: cause("SEND_BACK", "line_edit"),
    provenance: o.provenance,
  });
  return { run: moved, sentBack: true };
}
