// The credential store fs-api runs with, built in one place so the server and the test harness can never wire
// it differently: frame_tokens joined with workspaces (shell, src/credentials/verify) plus member and brand
// link revocation read from the attribution ledger (`link.revoked` entries, written by the judge slice's
// `revokeLink`). With it, a revoked link stops verifying on every route that resolves credentials, not only
// on the judge slice's own `/v1/credential` and `/s` · `/b` redirects.
import type { Db } from "@fairsplit/db";
import { isLinkRevoked } from "../credentials/issue/links.js";
import { type CredentialStore, dbCredentialStore } from "../credentials/verify/index.js";

export function appCredentialStore(db: Db): CredentialStore {
  return dbCredentialStore(db, { isLinkRevoked: (workspaceId, jti) => isLinkRevoked(db, workspaceId, jti) });
}
