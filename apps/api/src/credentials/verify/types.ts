// The credentials fs-api accepts (S3.8). Every one is a scoped token: the workspace always comes from
// the credential, never from a request body or a path. Issuance (minting rows, setting cookies, quotas)
// belongs to the judge slice in src/credentials/issue; this folder only verifies.
import type { Role } from "@fairsplit/contracts";
import { type Actor, type WorkspaceScope, workspaceScope } from "@fairsplit/db";

interface Base {
  /** When this credential stops working. */
  expiresAt: Date;
}

/** `Authorization: Bearer fst_…`: a 2-hour frame or console token (frame_tokens row, stored as sha256). */
export interface FrameCredential extends Base {
  kind: "frame";
  tokenId: string;
  workspaceId: string;
  persona: string;
  role: Role;
  memberId: string | null;
  /** The judge session that minted it (actor impersonated_by `judge_session:{sid}`), or null. */
  sessionId: string | null;
}

/** `Authorization: Bearer fsd_…`: an app device token from a pairing claim (frame_tokens row). */
export interface DeviceCredential extends Omit<FrameCredential, "kind"> {
  kind: "device";
}

/** The judge cookie `fs_js` (HMAC-signed, 24 h): acts as the judge in their own workspace. */
export interface JudgeSessionCredential extends Base {
  kind: "judge_session";
  sessionId: string;
  workspaceId: string;
  role: "judge";
  persona: "judge";
}

/** The operator cookie `fs_ops` (HMAC-signed, 8 h) from `/ops/login`. Sees every workspace; has none of its own. */
export interface OperatorCredential extends Base {
  kind: "operator";
  role: "operator";
  persona: "operator";
}

/** A member's signed link (Ed25519, 30 days, revocable): read-only, one line. */
export interface MemberLinkCredential extends Base {
  kind: "member_link";
  workspaceId: string;
  lineId: string;
  jti: string;
  role: "member";
}

/** A brand link (Ed25519, 30 days): the Proof brand tier for one workspace. */
export interface BrandLinkCredential extends Base {
  kind: "brand_link";
  workspaceId: string;
  brand: string;
  jti: string;
  role: "brand";
}

export type Credential =
  | FrameCredential
  | DeviceCredential
  | JudgeSessionCredential
  | OperatorCredential
  | MemberLinkCredential
  | BrandLinkCredential;

export type CredentialKind = Credential["kind"];

/** What `frame_or_session` commands accept: a person acting inside one workspace. */
export type ActingCredential = FrameCredential | DeviceCredential | JudgeSessionCredential;

export const ACTING_KINDS = ["frame", "device", "judge_session"] as const satisfies readonly CredentialKind[];

export function isActing(c: Credential | null | undefined): c is ActingCredential {
  return !!c && (ACTING_KINDS as readonly string[]).includes(c.kind);
}

/** The workspace a credential is bound to, or null for the operator. */
export function workspaceOf(c: Credential): string | null {
  return c.kind === "operator" ? null : c.workspaceId;
}

/**
 * The actor recorded on every event and ledger entry this credential writes (S3.8): the persona as
 * `{role}:{persona}`, impersonated by `judge_session:{sid}` when a judge session minted the token.
 */
export function actorOf(c: Credential): Actor {
  switch (c.kind) {
    case "frame":
    case "device":
      return {
        kind: "human",
        id: `${c.role}:${c.persona}`,
        impersonatedBy: c.sessionId ? `judge_session:${c.sessionId}` : null,
      };
    case "judge_session":
      return { kind: "human", id: "judge", impersonatedBy: `judge_session:${c.sessionId}` };
    case "operator":
      return { kind: "human", id: "operator", impersonatedBy: null };
    case "member_link":
      return { kind: "human", id: `member-link:${c.jti}`, impersonatedBy: null };
    case "brand_link":
      return { kind: "human", id: `brand:${c.brand}`, impersonatedBy: null };
  }
}

/** The repository scope for this credential (`@fairsplit/db` repos take nothing else). Null for the operator. */
export function scopeOf(c: Credential): WorkspaceScope | null {
  if (c.kind === "operator") return null;
  const via =
    c.kind === "frame"
      ? "frame_token"
      : c.kind === "device"
        ? "device"
        : c.kind === "judge_session"
          ? "session"
          : "signed_link";
  return workspaceScope({ workspaceId: c.workspaceId, actor: actorOf(c), via });
}

/** The role a credential acts in. */
export function roleOf(c: Credential): Role {
  return c.role;
}
