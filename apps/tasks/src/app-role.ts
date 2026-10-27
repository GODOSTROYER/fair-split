// The S3.4 role check every entry makes before it runs a task: "Boot and /readyz refuse to run if
// has_table_privilege(current_user, 'ledger_entries', 'UPDATE') is true" (the plan: "boot refuses …
// a ledger-writable role"). It runs once per process, on the first task rather than at import: in
// register mode the Workflows entry only announces its tasks and must not need the database.
//
// Stand-in until @fairsplit/db merges: then call its `assertAppRole(db)` (WS-DATA, packages/db/src/
// roles.ts), which also refuses DELETE and TRUNCATE on run_events, ledger_entries and agent_sessions.
import type { DbProbeResult } from "./db-probe.js";
import { PermanentTaskError } from "./handlers.js";

/** The role this process connects as could rewrite history. Permanent: retrying cannot fix the role. */
export class LedgerWritableError extends PermanentTaskError {
  constructor() {
    super(
      "BOOT_REFUSED",
      "the database role can UPDATE ledger_entries; refusing to run tasks until DATABASE_URL is fs_app's (S3.4)",
    );
  }
}

/** The check could not be made (database unreachable, or not migrated yet). Transient: the next run retries it. */
export class RoleCheckUnavailableError extends Error {
  override readonly name = "RoleCheckUnavailableError";
}

async function checkRole(probe: () => Promise<DbProbeResult>): Promise<void> {
  const r = await probe();
  // No database configured: nothing to protect. Render always configures one (boot refuses a
  // half-configured environment), so this is a local run of handlers that need none.
  if (!r.configured) return;
  if (!r.reachable || r.errorCode !== undefined)
    throw new RoleCheckUnavailableError(`database role check failed (${r.errorCode ?? "unreachable"})`);
  if (r.ledgerWritable === true) throw new LedgerWritableError();
  if (r.ledgerWritable !== false)
    throw new RoleCheckUnavailableError("ledger_entries does not exist yet; run the migrations first");
}

/**
 * The check as an `InvokeContext.preflight`. A pass is kept for the life of the process, and so is a
 * refusal, which every later run returns without asking the database again; a check that could not
 * be made is asked again by the next run. Concurrent runs share one check.
 */
export function appRoleGate(probe: () => Promise<DbProbeResult>): () => Promise<void> {
  let verdict: Promise<void> | undefined;
  return () => {
    verdict ??= checkRole(probe).catch((err: unknown) => {
      if (!(err instanceof PermanentTaskError)) verdict = undefined;
      throw err;
    });
    return verdict;
  };
}
