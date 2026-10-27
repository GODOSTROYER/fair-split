import type { AssetSpec } from "../content/types.js";
import { currentMasterAttempt, type Manifest } from "./manifest.js";

/** A fixture's review state, as `gen` sees it (null when the asset has no fixture yet). */
export type FixtureStatus = "draft" | "agent-checked" | "human-reviewed" | null;

export interface GenRequest {
  /** `gen all` rather than named ids. */
  all: boolean;
  /** Replace an accepted master. */
  force: boolean;
  /** Also replace a master whose fixture a person has reviewed (the review is lost). */
  replaceReviewed: boolean;
}

export interface GenPlan {
  run: AssetSpec[];
  /** Left alone, and why (not an error: `gen all` after a partial run only fills the gaps). */
  skipped: { id: string; reason: string }[];
  /** Asked for but not allowed; when any is refused, nothing runs. */
  refused: { id: string; reason: string }[];
  warnings: string[];
}

/**
 * Decides which assets `imagegen gen` may spend a Codex exec on. Every exec costs the user's Codex quota
 * (12 per 5 hours) and a new master resets the asset's review, so an asset that already has a master is
 * skipped unless `--force` names it, `--force` never applies to `all`, and a master whose fixture a person
 * has reviewed needs `--replace-reviewed` as well.
 */
export function planGeneration(
  assets: readonly AssetSpec[],
  manifest: Manifest,
  fixtureStatus: (id: string) => FixtureStatus,
  req: GenRequest,
): GenPlan {
  const plan: GenPlan = { run: [], skipped: [], refused: [], warnings: [] };
  if (req.all && req.force) {
    plan.refused.push({
      id: "all",
      reason: "--force replaces masters, so it needs the asset ids named; it never applies to `all`",
    });
    return plan;
  }
  for (const a of assets) {
    const e = manifest.assets[a.id];
    if (!e?.master) {
      plan.run.push(a);
      continue;
    }
    const accepted = currentMasterAttempt(e);
    if (!req.force) {
      plan.skipped.push({
        id: a.id,
        reason: `has an accepted master${accepted ? ` (attempt ${accepted.n})` : ""}; pass --force to replace it`,
      });
      continue;
    }
    if (fixtureStatus(a.id) === "human-reviewed" && !req.replaceReviewed) {
      plan.refused.push({
        id: a.id,
        reason:
          "its fixture is human-reviewed; a new master throws that review away, so add --replace-reviewed",
      });
      continue;
    }
    plan.run.push(a);
  }
  // A carbon copy is an edit of its white original: a new original leaves the old copy stale.
  const replaced = new Set(plan.run.filter((a) => manifest.assets[a.id]?.master).map((a) => a.id));
  for (const [id, e] of Object.entries(manifest.assets)) {
    if (e.editOf && replaced.has(e.editOf) && !plan.run.some((a) => a.id === id)) {
      plan.warnings.push(
        `${id} is an edit of ${e.editOf}; regenerate it too (gen ${id} --force) so the copies match`,
      );
    }
  }
  if (plan.refused.length) plan.run = [];
  return plan;
}
