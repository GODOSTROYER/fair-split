/**
 * Which credentials the migrate CLI uses (S3.4; WS-OPS's render.yaml contract):
 * - DATABASE_OWNER_URL — the owner, who runs migrations. On Render it is the only URL migrate may use, because
 *   DATABASE_URL there is fs_app's own login.
 * - DATABASE_URL — accepted as the owner only off Render (local development, CI), where it is the one URL.
 * - FS_APP_DB_PASSWORD — optional: give fs_app LOGIN with this password, so the app logs in as fs_app itself.
 * Nothing here is ever printed except the database name.
 */
export interface MigrateEnv {
  ownerUrl: string;
  /** where the owner URL came from (for the log line) */
  source: "DATABASE_OWNER_URL" | "DATABASE_URL";
  appPassword: string | null;
}

export function resolveMigrateEnv(env: Record<string, string | undefined>): MigrateEnv {
  const appPassword = env.FS_APP_DB_PASSWORD?.length ? env.FS_APP_DB_PASSWORD : null;
  if (env.DATABASE_OWNER_URL)
    return { ownerUrl: env.DATABASE_OWNER_URL, source: "DATABASE_OWNER_URL", appPassword };
  if (env.RENDER) {
    throw new Error(
      "DATABASE_OWNER_URL is not set: on Render, migrate never uses DATABASE_URL (that is fs_app's login)",
    );
  }
  if (env.DATABASE_URL) return { ownerUrl: env.DATABASE_URL, source: "DATABASE_URL", appPassword };
  throw new Error("DATABASE_OWNER_URL (or DATABASE_URL for local development) is not set");
}

/** The database name, the only part of a connection string the CLI ever logs. */
export function databaseName(url: string): string {
  return new URL(url).pathname.replace(/^\//, "") || "(default)";
}
