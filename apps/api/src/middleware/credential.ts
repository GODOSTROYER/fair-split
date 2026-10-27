// Credential resolution per request, memoised: the command builder and any slice route call these helpers;
// none of them reads a workspace from the request. `frame_or_session` commands use `requireActing`.
import type { Role } from "@fairsplit/contracts";
import { getCookie } from "hono/cookie";
import {
  type ActingCredential,
  type Credential,
  type CredentialKind,
  isActing,
  type ResolveResult,
} from "../credentials/verify/index.js";
import type { AppContext } from "../lib/context.js";
import { problem } from "../lib/problem.js";

export function credentialResult(c: AppContext): Promise<ResolveResult> {
  let pending = c.get("credentialResult");
  if (!pending) {
    pending = c.get("deps").credentials.resolver.resolve({
      authorization: c.req.header("authorization") ?? null,
      cookies: getCookie(c),
    });
    c.set("credentialResult", pending);
  }
  return pending;
}

/** The verified credential, or null when none was presented or it does not verify (public and `none` routes). */
export async function optionalCredential(c: AppContext): Promise<Credential | null> {
  const r = await credentialResult(c);
  return r.kind === "ok" ? r.credential : null;
}

/** Any verified credential of the given kinds; 401 when missing or invalid, 403 for another kind. */
export async function requireCredential<K extends CredentialKind>(
  c: AppContext,
  kinds?: readonly K[],
): Promise<Extract<Credential, { kind: K }>> {
  const r = await credentialResult(c);
  if (r.kind === "none") throw problem.unauthenticated();
  if (r.kind === "invalid") throw r.problem;
  if (kinds && !kinds.includes(r.credential.kind as K)) {
    throw problem.forbidden(`This needs a ${kinds.join(" or ")} credential.`);
  }
  return r.credential as Extract<Credential, { kind: K }>;
}

/** A person acting inside one workspace: frame or device token, or the judge cookie (`frame_or_session`). */
export async function requireActing(c: AppContext): Promise<ActingCredential> {
  const r = await credentialResult(c);
  if (r.kind === "none") throw problem.unauthenticated();
  if (r.kind === "invalid") throw r.problem;
  if (!isActing(r.credential)) {
    throw problem.forbidden("Read-only links and the operator session cannot do this.");
  }
  return r.credential;
}

/** 403 unless the credential acts in one of `roles`. The judge acts as personas in their own workspace. */
export function requireRole(credential: Credential, roles: readonly Role[]): void {
  if (!roles.includes(credential.role)) {
    throw problem.forbidden(`This needs the ${roles.join(" or ")} role.`);
  }
}

export async function requireOperator(c: AppContext) {
  return requireCredential(c, ["operator"] as const);
}
