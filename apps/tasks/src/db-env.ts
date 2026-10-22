// Database credentials at boot. S3.4: "The app and tasks swap the fs_app credentials into
// DATABASE_URL"; register §7: the app role cannot UPDATE or DELETE run_events, ledger_entries or
// agent_sessions, so no running process should keep the owner's credentials.
//
// On Render (render.yaml):
// - fs-api holds the owner's URL only as DATABASE_OWNER_URL, which `@fairsplit/db migrate` reads in
//   the preDeployCommand (packages/db's env contract: on Render, migrate never uses DATABASE_URL),
//   plus FS_APP_DB_PASSWORD (generated). Its boot builds fs_app's DATABASE_URL from the owner URL's
//   host, port and database, then deletes the owner URL from the process environment.
// - fs-tasks never receives the owner's credentials: it gets fs-db's host, port and database name
//   (`fromDatabase`) plus FS_APP_DB_PASSWORD (shared from fs-api), and builds fs_app's URL.
// `useAppDatabaseUrl` does both. fs-api's boot is WS-API's code: this file is its tested reference
// (HANDOFF; lift into packages/db with WS-DATA).
export const APP_DB_ROLE = "fs_app";

/**
 * How DATABASE_URL was obtained: built from Render's parts (fs-tasks), built from the owner URL
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
      throw new DbEnvError("set FS_DB_HOST (fs-tasks on Render) or a database URL, not both");
    }
    if (!password) {
      throw new DbEnvError(
        "FS_DB_HOST is set but FS_APP_DB_PASSWORD is not: fs-tasks connects only as fs_app " +
          "(copy fs-api's FS_APP_DB_PASSWORD if Render did not share it)",
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
 * Boot step: point DATABASE_URL at fs_app and drop every other database credential from this
 * process's environment, so no later code (or a child process) can reach the owner's. Throws
 * DbEnvError on a half-configured environment: the entry refuses to start rather than guess.
 */
export function useAppDatabaseUrl(env: NodeJS.ProcessEnv = process.env): DbUrlSource {
  const { url, source } = resolveAppDatabaseUrl(env);
  if (url) env.DATABASE_URL = url;
  delete env.FS_APP_DB_PASSWORD;
  delete env.DATABASE_OWNER_URL;
  return source;
}
