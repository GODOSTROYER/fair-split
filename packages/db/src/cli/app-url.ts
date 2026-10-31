// fs_app's database URL at boot (S3.4; ADR-0005). "The app and tasks swap the fs_app credentials into
// DATABASE_URL"; register §7: the app role cannot UPDATE or DELETE run_events, ledger_entries or
// agent_sessions, so no running process should keep the owner's credentials.
//
// On Render (render.yaml), fs-api holds the owner's URL only as DATABASE_OWNER_URL, which `migrate`
// (./migrate.ts, the preDeployCommand) reads, plus FS_APP_DB_PASSWORD (generated), from which migrate gives
// fs_app its LOGIN. fs-api's entry calls `useAppDatabaseUrl()` before anything reads DATABASE_URL: it builds
// fs_app's URL from the owner URL's host, port and database, then deletes the owner URL and the password from
// process.env. The process's initial environment (/proc/<pid>/environ) still holds them: ADR-0005 records that
// residual risk, and why fs-db accepts no external connection. A process given only fs-db's host, port and name
// (FS_DB_HOST, FS_DB_PORT, FS_DB_NAME) plus the password builds the same URL without the owner's credentials.
// Lifted unchanged in behaviour from apps/tasks/src/db-env.ts, WS-OPS's tested reference.
export const APP_DB_ROLE = "fs_app";

/**
 * How DATABASE_URL was obtained: built from fs-db's parts (FS_DB_HOST, …), built from the owner URL
 * (fs-api), swapped into an owner DATABASE_URL (local runs with FS_APP_DB_PASSWORD), given as-is
 * (local runs, or fs_app's own login next to DATABASE_OWNER_URL), or absent.
 */
export type DbUrlSource = "parts" | "from-owner" | "swapped" | "as-is" | "none";

export class DbEnvError extends Error {
  override readonly name = "DbEnvError";
}

const nonEmpty = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** A hostname or IPv4 literal, or an IPv6 literal with or without brackets. Nothing that could carry userinfo or a path. */
const HOST =
  /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|\[[0-9A-Fa-f:.]+\]|[0-9A-Fa-f.]*:[0-9A-Fa-f:.]*)$/;

function hostForUrl(host: string): string {
  if (!HOST.test(host)) throw new DbEnvError("FS_DB_HOST is not a hostname or IP address");
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function parseUrl(text: string, what: string): URL {
  try {
    return new URL(text);
  } catch {
    throw new DbEnvError(`${what} is not a URL`);
  }
}

/** Parses a postgres URL; the error names the variable, never its value. */
function parsePostgresUrl(text: string, what: string): URL {
  const url = parseUrl(text, what);
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new DbEnvError(`${what} is not a postgres URL`);
  }
  return url;
}

function withAppRole(url: URL, password: string): string {
  // Encode first: the WHATWG setter leaves `%` alone, and postgres.js decodes userinfo with
  // decodeURIComponent, so a raw `%` in the password would make every connection attempt throw.
  url.username = APP_DB_ROLE;
  url.password = encodeURIComponent(password);
  return url.toString();
}

/** Pure: the connection string fs_app should use, from whatever this process was given. */
export function resolveAppDatabaseUrl(env: NodeJS.ProcessEnv): { url?: string; source: DbUrlSource } {
  const host = nonEmpty(env.FS_DB_HOST);
  const password = nonEmpty(env.FS_APP_DB_PASSWORD);
  const given = nonEmpty(env.DATABASE_URL);
  const owner = nonEmpty(env.DATABASE_OWNER_URL);

  if (host) {
    if (given || owner) {
      throw new DbEnvError("set FS_DB_HOST (with FS_DB_NAME) or a database URL, not both");
    }
    if (!password) {
      throw new DbEnvError(
        "FS_DB_HOST is set but FS_APP_DB_PASSWORD is not: from fs-db's parts the process connects only as fs_app " +
          "(the password migrate set from fs-api's FS_APP_DB_PASSWORD)",
      );
    }
    const name = nonEmpty(env.FS_DB_NAME);
    if (!name) throw new DbEnvError("FS_DB_NAME is required with FS_DB_HOST");
    const port = nonEmpty(env.FS_DB_PORT) ?? "5432";
    if (!/^\d{1,5}$/.test(port) || Number(port) > 65_535) throw new DbEnvError("FS_DB_PORT is not a port");
    const url = parseUrl(
      `postgresql://${hostForUrl(host)}:${port}/${encodeURIComponent(name)}`,
      "FS_DB_HOST",
    );
    const sslmode = nonEmpty(env.FS_DB_SSLMODE);
    if (sslmode) url.searchParams.set("sslmode", sslmode);
    return { url: withAppRole(url, password), source: "parts" };
  }

  if (owner) {
    const ownerUrl = parsePostgresUrl(owner, "DATABASE_OWNER_URL");
    if (given) {
      // packages/db's model: next to the owner URL, DATABASE_URL is fs_app's own login.
      const app = parsePostgresUrl(given, "DATABASE_URL");
      if (decodeURIComponent(app.username) !== APP_DB_ROLE) {
        throw new DbEnvError("DATABASE_OWNER_URL is set, so DATABASE_URL must be fs_app's own login");
      }
      return { url: given, source: "as-is" };
    }
    if (!password) {
      throw new DbEnvError(
        "DATABASE_OWNER_URL is set but FS_APP_DB_PASSWORD is not: the app never runs as the owner",
      );
    }
    return { url: withAppRole(ownerUrl, password), source: "from-owner" };
  }

  if (given && password) {
    return { url: withAppRole(parsePostgresUrl(given, "DATABASE_URL"), password), source: "swapped" };
  }

  if (given) return { url: given, source: "as-is" };
  return { source: "none" };
}

/**
 * Boot step: point DATABASE_URL at fs_app and drop every other database credential from process.env,
 * so no library that reads the environment, and no child process, gets the owner's. It cannot erase
 * the process's initial environment block (ADR-0005). Throws DbEnvError on a half-configured
 * environment: the entry refuses to start rather than guess.
 */
export function useAppDatabaseUrl(env: NodeJS.ProcessEnv = process.env): DbUrlSource {
  const { url, source } = resolveAppDatabaseUrl(env);
  if (url) env.DATABASE_URL = url;
  delete env.FS_APP_DB_PASSWORD;
  delete env.DATABASE_OWNER_URL;
  return source;
}
