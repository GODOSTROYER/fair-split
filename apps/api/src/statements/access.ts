// Who may read a member's statement (and its audio): the line's own member link, or an acting credential in the
// line's workspace (a member only for their own line; the treasurer, the Chair, the clerk and a judge for any).
// No credential → 401; a credential that did not verify → its own problem; another workspace's line → 404.
import type { Lang } from "@fairsplit/contracts";
import type { Credential } from "../credentials/verify/index.js";
import type { AppDeps } from "../lib/context.js";
import { problem } from "../lib/problem.js";
import { loadStatementContext, type StatementContext } from "./facts.js";

const OFFICER_ROLES = new Set(["treasurer", "board", "clerk", "judge"]);

export async function readableStatement(
  deps: Pick<AppDeps, "db">,
  credential: Credential | null,
  credentialProblem: Error | null,
  lineId: string,
  lang: Lang | undefined,
): Promise<StatementContext> {
  if (!credential) throw credentialProblem ?? problem.unauthenticated();
  if (credential.kind === "operator" || credential.kind === "brand_link") {
    throw problem.forbidden("Statements are the member's and the co-op officers'.");
  }
  if (credential.kind === "member_link" && credential.lineId.toLowerCase() !== lineId.toLowerCase()) {
    throw problem.notFound("No such line.");
  }
  const ctx = await loadStatementContext(deps.db, credential.workspaceId, lineId, lang);
  if (!ctx) throw problem.notFound("No such line in this workspace.");
  if (credential.kind === "frame" || credential.kind === "device") {
    if (credential.role === "member") {
      if (!credential.memberId || credential.memberId.toLowerCase() !== ctx.memberId.toLowerCase()) {
        throw problem.forbidden("A member reads their own statement only.");
      }
    } else if (!OFFICER_ROLES.has(credential.role)) {
      throw problem.forbidden("Statements are the member's and the co-op officers'.");
    }
  }
  return ctx;
}
