// I4 for every member line, cash lines included: the hash a line carries in `linesDigest` is recomputed from what
// the line holds NOW, at signing (approvals/batch.ts `runBatch`) and again right before the POST (money/payouts.ts
// `loadPosting` / `loadRun`), never read back as its stored `line_sha256` alone. Otherwise an insider who edits a
// cash line's amount and leaves its hash alone would change what the clerk pays while both signatures still verify
// (security audit T1, finding S1).
import type { schema } from "@fairsplit/db";
import { sha256Hex } from "@fairsplit/domain";
import { resolveLineCanonical } from "../proof/bundle.js";

/** Domain separation for the hash a line whose columns no longer re-hash to its stored hash is signed as. */
const MISMATCH = "fairsplit.line-hash-mismatch";

export type LineHashRow = Pick<
  typeof schema.memberLines.$inferSelect,
  | "rail"
  | "verifiedG"
  | "grade1G"
  | "premiumCents"
  | "bonusCents"
  | "netCents"
  | "deductions"
  | "lineSha256"
  | "trace"
> & { memberNo: string };

/**
 * The hash `linesDigest` binds for one line, or null when it has no stored hash. The line's canonical is rebuilt
 * from its columns, its engine deductions and the slip serials and credits the engine wrote to its trace (the
 * canonical Proof plate 4 recomputes, `resolveLineCanonical`); only that rebuild may vouch for the stored hash (a
 * canonical stored inside `trace` is never offered, so it cannot vouch for columns that differ from it). A line
 * whose rebuild matches is its stored hash. Any other is a hash of both, which equals neither: if its columns or its
 * stored hash changed after both keys signed, whichever it was, the digest they signed no longer matches (the
 * rebuild alone would match it again when only the stored hash was rewritten); signed as it is now, it is paid as
 * it is now, and Proof plate 4 still says the line does not recompute.
 */
export function lineHashNow(row: LineHashRow, rateCardSha256: string): string | null {
  if (row.lineSha256 === null) return null;
  const t = row.trace !== null && typeof row.trace === "object" && !Array.isArray(row.trace) ? row.trace : {};
  const { slipSerials, credits } = t as { slipSerials?: unknown; credits?: unknown };
  const resolved = resolveLineCanonical(
    {
      ...row,
      deductions: Array.isArray(row.deductions) ? row.deductions : [],
      trace: { slipSerials, credits },
    },
    rateCardSha256,
    [],
  );
  return resolved.matches ? row.lineSha256 : sha256Hex(`${MISMATCH}:${row.lineSha256}:${resolved.sha256}`);
}
