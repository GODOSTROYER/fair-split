import { schema, type Tx } from "@fairsplit/db";
import { eq } from "drizzle-orm";
import { problem } from "../lib/problem.js";

export const MAX_JUDGE_LEDGER_ENTRIES = 5_000;

/** Optional visitor writes only. Caller holds the workspace lock; money/system/webhooks never call this. */
export async function assertJudgeLedgerRoom(tx: Tx, workspaceId: string): Promise<void> {
  const [workspace] = await tx
    .select({ kind: schema.workspaces.kind })
    .from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId))
    .limit(1);
  if (workspace?.kind !== "judge") return;
  const [head] = await tx
    .select({ seq: schema.ledgerHeads.seq })
    .from(schema.ledgerHeads)
    .where(eq(schema.ledgerHeads.workspaceId, workspaceId))
    .limit(1);
  if ((head?.seq ?? 0) >= MAX_JUDGE_LEDGER_ENTRIES) {
    throw problem.rateLimited(
      60_000,
      "This judge workspace has reached its optional activity limit. Start a fresh session or view the public showcase Proof.",
    );
  }
}
