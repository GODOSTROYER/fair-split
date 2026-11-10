/**
 * The application role (S3.4, register §7): `fs_app` may append to run_events, ledger_entries and agent_sessions
 * but never UPDATE, DELETE or TRUNCATE them, may not DELETE workspaces, and cannot see purge tickets.
 *
 * Three ways a process can be connected, reported by `inspectAppRole` and enforced at boot by `assertAppRole`:
 *
 * - login   — fs_app has LOGIN and its own password (the migrate CLI sets it from FS_APP_DB_PASSWORD when the
 *             owner may manage roles). session_user is fs_app, so no SET ROLE leads back to the owner and only
 *             the owner can disable a trigger. This is the production posture.
 * - assumed — the owner's login sends `role=fs_app` at connect (createDb's `role` option). Grants and triggers
 *             then stop bugs, not a compromised app: session_user is still the owner, so `SET ROLE <owner>`
 *             restores every privilege. Tests and local runs use it; production only if S6 finds no CREATE ROLE.
 * - owner   — no app role at all (the S6 fallback). Only the triggers guard history. Boot refuses it unless
 *             explicitly allowed.
 *
 * Passwords never reach the server: `enableAppLogin` sends a SCRAM-SHA-256 verifier computed here (RFC 5802 /
 * RFC 7677), which Postgres stores verbatim. Nothing in this module logs a password, a verifier or a URL.
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import postgres from "postgres";
import { APP_ROLE, type DbOrTx } from "./client.js";

export type AppRoleMode = "login" | "assumed" | "owner";

/** Tables fs_app may only append to (register §7) plus `notes` once it exists; checked for UPDATE/DELETE/TRUNCATE. */
export const HISTORY_TABLES = ["run_events", "ledger_entries", "agent_sessions"] as const;

export interface AppRoleReport {
  currentUser: string;
  sessionUser: string;
  mode: AppRoleMode;
  /** `table:PRIVILEGE` pairs on history tables the current user holds; must be empty for login and assumed */
  writableHistory: string[];
  canDeleteWorkspaces: boolean;
  canReadPurgeTickets: boolean;
}

export class AppRoleError extends Error {
  override readonly name = "AppRoleError";
  constructor(
    readonly report: AppRoleReport,
    readonly problems: string[],
  ) {
    super(`database role check failed (${report.mode} as ${report.currentUser}): ${problems.join("; ")}`);
  }
}

interface RoleRow {
  current_user: string;
  session_user: string;
  can_delete_workspaces: boolean;
  can_read_tickets: boolean;
  writable: string[] | null;
}

export async function inspectAppRole(db: DbOrTx): Promise<AppRoleReport> {
  const tables = sql.join(
    HISTORY_TABLES.map((t) => sql`(${t})`),
    sql`, `,
  );
  const res = await db.execute(sql`
    select current_user::text as current_user,
           session_user::text as session_user,
           has_table_privilege(current_user, 'workspaces', 'DELETE') as can_delete_workspaces,
           -- by oid from the catalogs: naming fs_private.* would itself need USAGE on the schema
           coalesce((select has_schema_privilege(current_user, n.oid, 'USAGE')
                            and has_table_privilege(current_user, c.oid, 'SELECT')
                       from pg_class c join pg_namespace n on n.oid = c.relnamespace
                      where n.nspname = 'fs_private' and c.relname = 'purge_tickets'), false) as can_read_tickets,
           (select array_agg(t.name || ':' || p.priv order by t.name, p.priv)
              from (values ${tables}) as t(name)
              cross join (values ('UPDATE'), ('DELETE'), ('TRUNCATE')) as p(priv)
             -- UPDATE also by column: has_table_privilege answers only for a table-level grant, so a column-level
             -- GRANT UPDATE (col) would pass unseen (TRUNCATE and DELETE have no column form)
             where has_table_privilege(current_user, t.name, p.priv)
                or (p.priv = 'UPDATE' and has_any_column_privilege(current_user, t.name, 'UPDATE'))) as writable`);
  const row = (res as unknown as RoleRow[])[0];
  if (!row) throw new Error("inspectAppRole: no row");
  const mode: AppRoleMode =
    row.session_user === APP_ROLE ? "login" : row.current_user === APP_ROLE ? "assumed" : "owner";
  return {
    currentUser: row.current_user,
    sessionUser: row.session_user,
    mode,
    writableHistory: row.writable ?? [],
    canDeleteWorkspaces: row.can_delete_workspaces,
    canReadPurgeTickets: row.can_read_tickets,
  };
}

/**
 * Boot and /readyz (S3.4): refuse to run when the connection could rewrite history. `allow` lists the accepted
 * modes (default login and assumed); allowing "owner" is the recorded S6 fallback, where only triggers guard.
 */
export async function assertAppRole(
  db: DbOrTx,
  opts: { allow?: readonly AppRoleMode[] } = {},
): Promise<AppRoleReport> {
  const allow = opts.allow ?? ["login", "assumed"];
  const report = await inspectAppRole(db);
  const problems: string[] = [];
  if (!allow.includes(report.mode))
    problems.push(`mode ${report.mode} is not allowed (allowed: ${allow.join(", ")})`);
  if (report.mode !== "owner") {
    if (report.writableHistory.length > 0) problems.push(`can rewrite ${report.writableHistory.join(", ")}`);
    if (report.canDeleteWorkspaces) problems.push("can DELETE workspaces");
    if (report.canReadPurgeTickets) problems.push("can read fs_private.purge_tickets");
  } else if (!allow.includes("owner")) {
    problems.push(`can rewrite ${report.writableHistory.join(", ") || "history"}`);
  }
  if (problems.length > 0) throw new AppRoleError(report, problems);
  return report;
}

// ─── SCRAM-SHA-256 verifiers ────────────────────────────────────────────────────────────────────────────

export const SCRAM_ITERATIONS = 4096;
const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

/**
 * Printable ASCII without spaces, 16+ characters: SASLprep is then the identity, so the verifier computed here is
 * exactly what Postgres would compute, and the password survives a connection URL once percent-encoded.
 */
export function assertAppPassword(password: string): void {
  if (password.length < 16) throw new RangeError("FS_APP_DB_PASSWORD must be at least 16 characters");
  if (!PRINTABLE_ASCII.test(password))
    throw new RangeError("FS_APP_DB_PASSWORD must be printable ASCII without spaces");
}

const hmac = (key: Buffer, msg: string) => createHmac("sha256", key).update(msg).digest();

/** `SCRAM-SHA-256$<iterations>:<salt>$<StoredKey>:<ServerKey>`, the format pg_authid.rolpassword stores. */
export function scramSha256Verifier(
  password: string,
  opts: { salt?: Buffer; iterations?: number } = {},
): string {
  if (opts.salt === undefined) assertAppPassword(password);
  else if (!PRINTABLE_ASCII.test(password))
    throw new RangeError("password must be printable ASCII without spaces");
  const salt = opts.salt ?? randomBytes(16);
  const iterations = opts.iterations ?? SCRAM_ITERATIONS;
  const salted = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const storedKey = createHash("sha256").update(hmac(salted, "Client Key")).digest();
  const serverKey = hmac(salted, "Server Key");
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

const VERIFIER =
  /^SCRAM-SHA-256\$(\d+):([A-Za-z0-9+/]+={0,2})\$([A-Za-z0-9+/]+={0,2}):([A-Za-z0-9+/]+={0,2})$/;

export function parseScramVerifier(v: string): {
  iterations: number;
  salt: Buffer;
  storedKey: Buffer;
  serverKey: Buffer;
} {
  const m = VERIFIER.exec(v);
  if (!m) throw new TypeError("not a SCRAM-SHA-256 verifier");
  return {
    iterations: Number(m[1]),
    salt: Buffer.from(m[2] ?? "", "base64"),
    storedKey: Buffer.from(m[3] ?? "", "base64"),
    serverKey: Buffer.from(m[4] ?? "", "base64"),
  };
}

// ─── login management (owner only: the migrate CLI) ──────────────────────────────────────────────────────

/**
 * Gives fs_app LOGIN NOINHERIT and the password's SCRAM verifier. Runs as the owner (needs CREATEROLE, or ADMIN
 * OPTION on fs_app since Postgres 16); throws if the database user may not, so a deploy that asked for a
 * login role never silently falls back.
 */
export async function enableAppLogin(ownerUrl: string, password: string): Promise<void> {
  const verifier = scramSha256Verifier(password);
  if (!VERIFIER.test(verifier)) throw new Error("internal: malformed verifier");
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    // utility statements take no bind parameters; the verifier is base64 and '$:' only (checked above)
    await owner.unsafe(`alter role ${APP_ROLE} with login noinherit password '${verifier}'`);
  } finally {
    await owner.end({ timeout: 5 });
  }
}

/** Takes LOGIN away again (and the password with it). */
export async function disableAppLogin(ownerUrl: string): Promise<void> {
  const owner = postgres(ownerUrl, { max: 1, onnotice: () => {}, connect_timeout: 10 });
  try {
    await owner.unsafe(`alter role ${APP_ROLE} with nologin password null`);
  } finally {
    await owner.end({ timeout: 5 });
  }
}

/** fs_app's connection string: the owner's host, port, database and options with fs_app's own credentials. */
export function appDatabaseUrl(url: string, password: string): string {
  const u = new URL(url);
  u.username = APP_ROLE;
  u.password = encodeURIComponent(password);
  return u.toString();
}
