/**
 * Seed windows (I2, migrations/0007). The database stamps a rate card's ratification with its own clock: whatever
 * instant the app writes when a card becomes ratified (an UPDATE from NULL, or an INSERT already ratified), the row
 * stores now(), so a ratification can never be backdated to let earlier-dated slips in.
 *
 * The one exception is loading a seeded snapshot (IC-03 `seed.loadSnapshot`: the showcase and every Judge clone),
 * whose card was ratified on 14 Mar. Open a window first, in the same transaction:
 *
 *   await db.transaction(async (tx) => {
 *     await openSeedWindow(tx, workspaceId);        // a fresh showcase or judge workspace only
 *     await tx.insert(rateCards).values({ …, ratifiedAt: snapshot.ratifiedAt, provenance: "seeded" });
 *   });
 *
 * Inside the window, rows labelled `provenance: 'seeded'` keep their historical instant; everything else still gets
 * the clock. The window is an owner-only ticket for (workspace, transaction), so it ends with the transaction, and
 * the database refuses to open one for a real workspace or for one that already has a ratified card
 * (`FS409 SEED_REFUSED`).
 */
import { sql } from "drizzle-orm";
import type { Tx } from "./client.js";
import { isTransaction, lockWorkspaceLog } from "./tx.js";

export async function openSeedWindow(tx: Tx, workspaceId: string): Promise<void> {
  if (!isTransaction(tx)) {
    throw new TypeError(
      "openSeedWindow needs the transaction that loads the snapshot: a window ends with it",
    );
  }
  // the workspace lock before fs_open_seed's row locks (tx.ts lock order)
  await lockWorkspaceLog(tx, workspaceId);
  await tx.execute(sql`select fs_open_seed(${workspaceId})`);
}
