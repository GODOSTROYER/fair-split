// Spike S6 database probe (S3.14 UNVERIFIED items): can a workflow reach fs-db over Render's
// private network, can the connecting role CREATE ROLE (S3.4 owner/fs_app split), and is the role
// fs-tasks runs as barred from rewriting history (register §7: the app role cannot UPDATE
// ledger_entries)? Returns booleans, timings and an error *code* only: never the URL, host, user or
// error text.
import postgres from "postgres";

export interface DbProbeResult {
  /** DATABASE_URL was present. */
  readonly configured: boolean;
  /** `SELECT 1` succeeded. */
  readonly reachable: boolean;
  /** `rolcreaterole OR rolsuper` for `current_user`; null when unreachable. */
  readonly canCreateRole: boolean | null;
  /**
   * `has_table_privilege(current_user, 'ledger_entries', 'UPDATE')`. Must be false for the role
   * fs-tasks runs as (S3.4 boot rule). Null when unreachable or before the migrations created the table.
   */
  readonly ledgerWritable?: boolean | null;
  readonly connectMs?: number;
  readonly queryMs?: number;
  /** Driver or SQLSTATE code, e.g. ECONNREFUSED or 28P01. */
  readonly errorCode?: string;
}

/** The queries the probe needs; tests inject a fake. */
export interface ProbeClient {
  query(text: string): Promise<readonly Record<string, unknown>[]>;
  end(): Promise<void>;
}

export type ProbeConnect = (url: string) => ProbeClient;

export const defaultProbeConnect: ProbeConnect = (url) => {
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    idle_timeout: 1,
    prepare: false,
    onnotice: () => undefined,
  });
  return {
    query: async (text) => (await sql.unsafe(text)) as unknown as readonly Record<string, unknown>[],
    end: () => sql.end({ timeout: 1 }),
  };
};

/** One round trip for both role questions; `to_regclass` keeps it valid before the first migration. */
export const ROLE_QUERY = `SELECT (r.rolcreaterole OR r.rolsuper) AS can_create_role,
       CASE WHEN to_regclass('public.ledger_entries') IS NULL THEN NULL
            ELSE has_table_privilege(current_user, 'public.ledger_entries', 'UPDATE') END AS ledger_writable
  FROM pg_roles r WHERE r.rolname = current_user`;

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "UNKNOWN";
}

const boolOrNull = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export async function probeDatabase(
  url: string | undefined,
  connect: ProbeConnect = defaultProbeConnect,
  now: () => number = () => performance.now(),
): Promise<DbProbeResult> {
  if (!url) return { configured: false, reachable: false, canCreateRole: null };
  const t0 = now();
  let client: ProbeClient | undefined;
  let reached = false;
  try {
    client = connect(url);
    await client.query("SELECT 1 AS one");
    reached = true;
    const connectMs = Math.round(now() - t0);
    const t1 = now();
    const [row] = await client.query(ROLE_QUERY);
    const queryMs = Math.round(now() - t1);
    return {
      configured: true,
      reachable: true,
      canCreateRole: row?.can_create_role === true,
      ledgerWritable: boolOrNull(row?.ledger_writable),
      connectMs,
      queryMs,
    };
  } catch (err) {
    return {
      configured: true,
      reachable: reached,
      canCreateRole: null,
      ledgerWritable: null,
      connectMs: Math.round(now() - t0),
      errorCode: errorCode(err),
    };
  } finally {
    await client?.end().catch(() => undefined);
  }
}
