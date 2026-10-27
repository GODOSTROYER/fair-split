// Who sees what of a Proof bundle (S3.12 tiers, C-23). The tier comes only from the verified credential and the
// run's own workspace; a credential for another workspace (or none) gets the public tier.
//
//   public  anyone: member IDs, kilos, amounts, rails and statuses; every payout receiver withheld (C-23)
//   member  a member's own link or paired phone: their own item's receiver too, nobody else's
//   full    the brand (link or persona), the treasurer, the Chair and a judge in their own workspace: every
//           receiver, so plate 6 recomputes the batch hash in the browser
//
// The ledger, hashes and signatures are identical in every tier: redaction touches receivers only, and a
// redacted bundle says so (`redacted: true`).
import type { ProofBundle, Role } from "@fairsplit/contracts";
import type { Credential } from "../credentials/verify/index.js";

export type ProofTierName = "public" | "member" | "full";

export type ProofTier =
  | { tier: "public" }
  | { tier: "member"; lineId: string | null; memberId: string | null }
  | { tier: "full" };

/** Roles that see every receiver of their own workspace's runs (and may export). */
export const FULL_TIER_ROLES: readonly Role[] = ["brand", "treasurer", "board", "judge"];

/** The placeholder a withheld receiver carries: never an address, never a mask of one. */
export const WITHHELD_RECEIVER = "withheld";

/**
 * One rule for "is this the run's workspace?", used by the tiers, the brand view and /ops: workspace ids are
 * UUIDs, compared as UUIDs (case-insensitively), never as the strings a credential happened to carry.
 */
export function workspaceKey(workspaceId: string): string {
  return workspaceId.toLowerCase();
}

export function sameWorkspace(a: string, b: string): boolean {
  return workspaceKey(a) === workspaceKey(b);
}

export function tierFor(credential: Credential | null, runWorkspaceId: string): ProofTier {
  if (!credential || credential.kind === "operator") return { tier: "public" };
  if (!sameWorkspace(credential.workspaceId, runWorkspaceId)) return { tier: "public" };
  switch (credential.kind) {
    case "brand_link":
      return { tier: "full" };
    case "member_link":
      return { tier: "member", lineId: credential.lineId, memberId: null };
    case "judge_session":
      return { tier: "full" };
    case "frame":
    case "device":
      if (FULL_TIER_ROLES.includes(credential.role)) return { tier: "full" };
      if (credential.role === "member")
        return { tier: "member", lineId: null, memberId: credential.memberId };
      return { tier: "public" };
  }
}

/**
 * The bundle as `tier` may see it. `ownMemberNo` is the member whose receiver a member tier keeps (null: none).
 * Nothing but `batch.items[].receiver` changes, so every hash, signature and ledger entry is untouched.
 */
export function redactBundle(
  bundle: ProofBundle,
  tier: ProofTierName,
  ownMemberNo: string | null = null,
): ProofBundle {
  if (tier === "full") return bundle;
  const own = ownMemberNo ? `-${ownMemberNo}` : null;
  return {
    ...bundle,
    batch: {
      ...bundle.batch,
      items: bundle.batch.items.map((i) =>
        tier === "member" && own !== null && i.senderItemId.endsWith(own)
          ? i
          : { ...i, receiver: WITHHELD_RECEIVER },
      ),
    },
  };
}
