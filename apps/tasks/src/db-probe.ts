// Spike S6 database probe (S3.14 UNVERIFIED items): can a workflow reach fs-db over Render's
// private network, and can the connecting role CREATE ROLE (S3.4 fs_owner/fs_app split)?
// Returns booleans, timings and an error *code* only: never the URL, host, user or error text.
import postgres from "postgres";

export interface DbProbeResult {
  /** DATABASE_URL was present. */
  readonly configured: boolean;
  /** `SELECT 1` succeeded. */
  readonly reachable: boolean;
  /** `rolcreaterole OR rolsuper` for `current_user`; null when unreachable. */
  readonly canCreateRole: boolean | null;
  readonly connectMs?: number;
  readonly queryMs?: number;
  /** Driver or SQLSTATE code, e.g. ECONNREFUSED or 28P01. */
  readonly errorCode?: string;
}

/** The two queries the probe needs; tests inject a fake. */
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

function errorCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[A-Za-z0-9_]{1,40}$/.test(code) ? code : "UNKNOWN";
}

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
    const rows = await client.query(
      "SELECT (rolcreaterole OR rolsuper) AS can_create_role FROM pg_roles WHERE rolname = current_user",
    );
    const queryMs = Math.round(now() - t1);
    const canCreateRole = rows[0]?.can_create_role === true;
    return { configured: true, reachable: true, canCreateRole, connectMs, queryMs };
  } catch (err) {
    return {
      configured: true,
      reachable: reached,
      canCreateRole: null,
      connectMs: Math.round(now() - t0),
      errorCode: errorCode(err),
    };
  } finally {
    await client?.end().catch(() => undefined);
  }
}
