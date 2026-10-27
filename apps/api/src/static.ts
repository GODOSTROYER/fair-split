// One origin serves everything (S3.3): the console SPA at `/`, the Expo web export at `/app`, static media at
// `/media`. API, webhook and internal paths never fall through to a page. Hashed build assets are cached
// as immutable, `index.html` never is; client-side routes (`/judge`, `/season/…`, `/runs/…`, `/proof/…`,
// `/b/…`, `/ops`, `/prototype`) get the console's index.html, and `/app/*` routes get the app's.
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono, MiddlewareHandler } from "hono";
import type { AppEnv } from "./lib/context.js";

export interface StaticDirs {
  console: string;
  app: string;
  media: string;
}

/** The repository root: FS_REPO_ROOT, else the nearest ancestor with pnpm-workspace.yaml. */
export function findRepoRoot(override?: string): string {
  if (override) return path.resolve(override);
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return process.cwd();
}

export function staticDirs(env: {
  repoRoot?: string | undefined;
  consoleDir?: string | undefined;
  appDir?: string | undefined;
  mediaDir?: string | undefined;
}): StaticDirs {
  const root = findRepoRoot(env.repoRoot);
  return {
    console: path.resolve(env.consoleDir ?? path.join(root, "apps", "console", "dist")),
    app: path.resolve(env.appDir ?? path.join(root, "apps", "mobile", "dist")),
    media: path.resolve(env.mediaDir ?? path.join(root, "media", "public")),
  };
}

/** A signed link's characters (base64url segments joined by `_` and `.`); anything else is a 404. */
const MEMBER_LINK_TOKEN = /^[A-Za-z0-9_.-]{16,2048}$/;

const IMMUTABLE = "public, max-age=31536000, immutable";
const NO_CACHE = "no-cache";
const API_PREFIXES = [
  "/v1/",
  "/v1",
  "/webhooks/",
  "/internal/",
  "/healthz",
  "/readyz",
  "/openapi.json",
  "/docs",
];

function isApiPath(p: string): boolean {
  return API_PREFIXES.some(
    (prefix) => p === prefix || p.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`),
  );
}

function wantsHtml(c: Context): boolean {
  const accept = c.req.header("accept") ?? "";
  return c.req.method === "GET" && (accept.includes("text/html") || accept === "" || accept.includes("*/*"));
}

function isFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

function placeholder(title: string, hint: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font:16px system-ui;margin:3rem;max-width:40rem"><h1>${title}</h1><p>${hint}</p><p><a href="/docs">API reference</a> · <a href="/healthz">/healthz</a></p></body></html>`;
}

function htmlFile(file: string, cache: string) {
  return (c: Context) => {
    c.header("Cache-Control", cache);
    return c.html(readFileSync(file, "utf8"));
  };
}

/** Wraps serveStatic: when it answers (it returns the Response itself), set the cache policy for that path. */
function cached(serve: MiddlewareHandler, policy: (requestPath: string) => string): MiddlewareHandler {
  return async (c, next) => {
    const res = await serve(c, next);
    if (res instanceof Response && res.status < 300) res.headers.set("Cache-Control", policy(c.req.path));
    return res;
  };
}

function assetPolicy(hashedDir: string) {
  return (p: string) =>
    p.endsWith(".html") || path.posix.extname(p) === ""
      ? NO_CACHE
      : p.includes(hashedDir)
        ? IMMUTABLE
        : "public, max-age=300";
}

export function mountStatic(app: Hono<AppEnv>, dirs: StaticDirs): void {
  // /media: immutable files (audio clips, archived-photo tiles). Ranges are supported for audio seeking.
  app.use(
    "/media/*",
    cached(
      serveStatic({ root: dirs.media, rewriteRequestPath: (p) => p.replace(/^\/media/, "") }),
      () => IMMUTABLE,
    ),
  );

  // /s/:token: a member's printed or texted link opens the app's statement (S3.3). The token is a signed
  // link (`fsm_…`); it is only forwarded, never logged (access logs drop it: see requestContext) or verified
  // here. A route folder that registers `/s/:token` itself (mounted earlier) takes precedence.
  app.get("/s/:token", (c) => {
    const token = c.req.param("token");
    if (!MEMBER_LINK_TOKEN.test(token)) return c.notFound();
    c.header("Cache-Control", "no-store");
    return c.redirect(`/app/s/${token}`, 302);
  });

  // /app: the Expo web export (web.output "single").
  app.get("/app", (c) => c.redirect("/app/", 308));
  app.use(
    "/app/*",
    cached(
      serveStatic({
        root: dirs.app,
        precompressed: true,
        rewriteRequestPath: (p) => p.replace(/^\/app/, ""),
      }),
      assetPolicy("/_expo/"),
    ),
  );
  app.get("/app/*", (c) => {
    if (!wantsHtml(c)) return c.notFound();
    const index = path.join(dirs.app, "index.html");
    if (isFile(index)) return htmlFile(index, NO_CACHE)(c);
    return c.html(
      placeholder(
        "Fair Split app not built",
        "Run <code>corepack pnpm --filter @fairsplit/mobile export:web</code>.",
      ),
      200,
    );
  });

  // The console SPA: real files first, then index.html for client-side routes.
  const consoleFiles = cached(
    serveStatic({ root: dirs.console, precompressed: true }),
    assetPolicy("/assets/"),
  );
  app.use("*", async (c, next) => {
    if (isApiPath(c.req.path) || c.req.path.startsWith("/media/") || c.req.path.startsWith("/app/"))
      return next();
    return consoleFiles(c, next);
  });
  app.get("*", (c) => {
    if (isApiPath(c.req.path) || !wantsHtml(c) || path.extname(c.req.path) !== "") return c.notFound();
    const index = path.join(dirs.console, "index.html");
    if (isFile(index)) return htmlFile(index, NO_CACHE)(c);
    return c.html(
      placeholder(
        "Fair Split console not built",
        "Run <code>corepack pnpm --filter @fairsplit/console build</code>.",
      ),
      200,
    );
  });
}
