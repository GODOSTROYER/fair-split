// Who sees /ops (W-OP-01, S3.15): the operator sees everything; a judge sees only their own workspace,
// read-only; the co-op's treasurer and Chair see their own workspace too. Writes (key registration and
// revocation) are the operator's alone.
import type { Credential } from "../credentials/verify/index.js";
import { problem } from "../lib/problem.js";
import { workspaceKey } from "../proof/tier.js";

export type OpsView = { kind: "operator" } | { kind: "workspace"; workspaceId: string };

const WORKSPACE_ROLES = new Set(["judge", "treasurer", "board"]);

export function opsView(credential: Credential | null, credentialProblem: Error | null): OpsView {
  if (!credential)
    throw credentialProblem ?? problem.unauthenticated("Sign in to /ops, or open it from Judge Mode.");
  if (credential.kind === "operator") return { kind: "operator" };
  if (
    (credential.kind === "judge_session" || credential.kind === "frame" || credential.kind === "device") &&
    WORKSPACE_ROLES.has(credential.role)
  ) {
    return { kind: "workspace", workspaceId: workspaceKey(credential.workspaceId) };
  }
  throw problem.forbidden("/ops is the operator's, and a judge's or an officer's for their own workspace.");
}
