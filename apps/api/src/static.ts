// One origin serves everything (S3.3): the console SPA at `/`, the Expo web export at `/app`, static media at
// `/media` (STATIC_MEDIA_DIR; on Render the curated folder `tools/assemble-media.ts` writes from an explicit
// allowlist, never media/ wholesale). API, webhook and internal paths never fall through to a page. Hashed build assets are cached
// as immutable, `index.html` never is; client-side routes (`/judge`, `/season/…`, `/runs/…`, `/proof/…`,
// `/b/…`, `/ops`, `/prototype`) get the console's index.html, and `/app/*` routes get the app's. A brand link
// `/b/:token` gets it whatever its token holds (the signed `fsb_<payload>.<sig>` has a dot). Media is immutable only
// under a content-hashed name: the audio manifest and every other media file keep their name across a retake or a
// new build, so they are revalidated on every use (no-cache, a weak ETag, 304).
import { existsSync, readFileSync, type Stats, statSync } from "node:fs";
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
  // A relative STATIC_*_DIR is a repository path (render.yaml: STATIC_MEDIA_DIR=apps/api/dist/media), whatever
  // the working directory; an absolute one is used as given.
  return {
    console: path.resolve(root, env.consoleDir ?? path.join("apps", "console", "dist")),
    app: path.resolve(root, env.appDir ?? path.join("apps", "mobile", "dist")),
    media: path.resolve(root, env.mediaDir ?? path.join("media", "public")),
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
  return (
    (c.req.method === "GET" || c.req.method === "HEAD") &&
    (accept.includes("text/html") || accept === "" || accept.includes("*/*"))
  );
}

function isFile(p: string): boolean {
  return fileStats(p) !== null;
}

function fileStats(p: string): Stats | null {
  try {
    const s = statSync(p);
    return s.isFile() ? s : null;
  } catch {
    return null;
  }
}

/** An explicit dot-delimited content hash (`s1.4f1c9a2e.m4a`): hyphenated dates are never hashes. */
const CONTENT_HASHED = /\.[0-9a-f]{8,64}\.[A-Za-z0-9]+$/;

/** serveStatic's own refusals (a dot segment, a doubled or back slash): such a path is never a file here either. */
const UNSAFE_PATH = /(?:^|[/\\])\.{1,2}(?:$|[/\\])|[/\\]{2,}|\\/;

/**
 * The media file a request names, resolved the way serveStatic resolves it, or null (no such file, a percent
 * sign serveStatic refuses, or a path that would leave the root). Only used to read the file's size and mtime.
 */
function mediaFile(root: string, requestPath: string): Stats | null {
  const rel = requestPath.replace(/^\/media/, "");
  if (rel.includes("%") || UNSAFE_PATH.test(rel)) return null;
  const base = path.resolve(root);
  const file = path.resolve(base, `.${rel}`);
  if (!file.startsWith(base + path.sep)) return null;
  return fileStats(file);
}

/** A weak validator from the file's size and mtime: every build rewrites the folder, so a new build is a new tag. */
function weakEtag(s: Stats): string {
  return `W/"${s.size.toString(16)}-${Math.floor(s.mtimeMs).toString(16)}"`;
}

function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  const opaque = (tag: string) => tag.trim().replace(/^W\//, "");
  return header.split(",").some((tag) => tag.trim() === "*" || opaque(tag) === opaque(etag));
}

/**
 * Media that may change under the same URL between deploys: `no-cache` with a weak ETag, and a 304 when the
 * client already holds these bytes (If-None-Match). Ranges still work (serveStatic answers them).
 */
function revalidated(serve: MiddlewareHandler, root: string): MiddlewareHandler {
  return async (c, next) => {
    const method = c.req.method;
    const stats = method === "GET" || method === "HEAD" ? mediaFile(root, c.req.path) : null;
    if (!stats) return serve(c, next);
    const etag = weakEtag(stats);
    if (etagMatches(c.req.header("if-none-match"), etag)) {
      return c.body(null, 304, { ETag: etag, "Cache-Control": NO_CACHE });
    }
    const res = await serve(c, next);
    if (res instanceof Response && res.status < 300) {
      res.headers.set("Cache-Control", NO_CACHE);
      res.headers.set("ETag", etag);
    }
    return res;
  };
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

/** The console's index.html (never cached), or a labelled placeholder when the console is not built. */
function consolePage(dirs: StaticDirs) {
  const index = path.join(dirs.console, "index.html");
  return (c: Context) => {
    if (isFile(index)) return htmlFile(index, NO_CACHE)(c);
    return c.html(
      placeholder(
        "Fair Split console not built",
        "Run <code>corepack pnpm --filter @fairsplit/console build</code>.",
      ),
      200,
    );
  };
}

export function mountStatic(app: Hono<AppEnv>, dirs: StaticDirs): void {
  // /media: audio clips, their manifest and the photos. A content-hashed name is immutable; anything else keeps its
  // name when its bytes change (the manifest on every clip, a clip on a retake), so it is revalidated on every use.
  // Ranges are supported for audio seeking either way.
  const mediaFiles = serveStatic({ root: dirs.media, rewriteRequestPath: (p) => p.replace(/^\/media/, "") });
  const immutableMedia = cached(mediaFiles, () => IMMUTABLE);
  const revalidatedMedia = revalidated(mediaFiles, dirs.media);
  app.use("/media/*", (c, next) =>
    (CONTENT_HASHED.test(path.posix.basename(c.req.path)) ? immutableMedia : revalidatedMedia)(c, next),
  );

  // /b/:token: an operator's brand link opens the console's brand view (W-BR-01), which reads the link's facts from
  // `GET /v1/credential`. Served before the console's files and its page fallback, which reads the dot of a signed
  // `fsb_<payload>.<sig>` as a file extension and answers 404. The token is never a file path: nothing here reads
  // a file by it, so a token full of `..` or slashes still opens only this page. It is never logged (requestContext).
  const consoleIndex = consolePage(dirs);
  app.get("/b/:token", (c) => (wantsHtml(c) ? consoleIndex(c) : c.notFound()));

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
    // Printed statement links are a page route even though their signed token contains a dot. Every other
    // path with an extension is a missing asset, never the app's HTML.
    const memberLink = c.req.path.slice("/app/s/".length);
    const statementPage =
      c.req.path.startsWith("/app/s/") &&
      MEMBER_LINK_TOKEN.test(memberLink) &&
      /^fsm_[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{86}$/.test(memberLink);
    if (!statementPage && path.posix.extname(c.req.path) !== "") return c.notFound();
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
  // A path with an extension is a file that does not exist: 404, never index.html.
  app.get("*", (c) => {
    if (isApiPath(c.req.path) || !wantsHtml(c) || path.extname(c.req.path) !== "") return c.notFound();
    return consoleIndex(c);
  });
}
