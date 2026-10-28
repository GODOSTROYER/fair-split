/**
 * I2 · a ratified rate card freezes its season's terms (register §2, migrations/0008). The co-sign thresholds, the
 * mass-balance tolerance, the yield limit, auto-accept, and the zone, currency and dates the rules are read in
 * (`SEASON_RULE_COLUMNS`) are guarded: the generic `seasons.update` cannot write them (a compile error and
 * GuardedColumnError). `setSeasonRules` is the one write path, and it works only while the season's card is a draft
 * or does not exist yet. Once the card is ratified the database refuses the change for every role, and this helper
 * throws it as `FairSplitDbError` RATE_CARD_RATIFIED citing the card's hash (the API's 409, MM-4). Like any refused
 * write, the refusal ends the transaction it ran in.
 */
import { and, eq } from "drizzle-orm";
import type { DbOrTx } from "../client.js";
import { rethrowDbError } from "../errors.js";
import { SEASON_RULE_COLUMNS, seasons } from "../schema/index.js";
import type { WorkspaceScope } from "../scope.js";
import { withWorkspaceTx } from "../tx.js";

export type SeasonRuleColumn = (typeof SEASON_RULE_COLUMNS)[number];
/** The terms `seasons.setRules()` writes; an undefined member is left as it is, as in Drizzle. */
export type SeasonRules = Partial<Pick<typeof seasons.$inferInsert, SeasonRuleColumn>>;
type Season = typeof seasons.$inferSelect;

const RULE_COLUMNS: ReadonlySet<string> = new Set(SEASON_RULE_COLUMNS);

export async function setSeasonRules(
  db: DbOrTx,
  scope: WorkspaceScope,
  id: string,
  rules: SeasonRules,
): Promise<Season | null> {
  const entries = Object.entries(rules).filter(([, v]) => v !== undefined);
  const stray = entries.map(([k]) => k).filter((k) => !RULE_COLUMNS.has(k));
  if (stray.length > 0) {
    throw new TypeError(`seasons.setRules writes only the season's terms, not ${stray.join(", ")}`);
  }
  const where = and(eq(seasons.workspaceId, scope.workspaceId), eq(seasons.id, id));
  if (entries.length === 0) {
    const [row] = await db.select().from(seasons).where(where);
    return row ?? null;
  }
  return withWorkspaceTx(db, scope, async (tx) => {
    try {
      const [row] = await tx
        .update(seasons)
        .set(Object.fromEntries(entries) as SeasonRules)
        .where(where)
        .returning();
      return row ?? null;
    } catch (e) {
      return rethrowDbError(e);
    }
  });
}
