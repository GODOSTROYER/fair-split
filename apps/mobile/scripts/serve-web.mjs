// Serves dist/ the way fs-api will: the Expo web export under /app with an SPA fallback, and the member link
// /s/:token redirected to /app/s/:token (register §4). Local verification only; production serving lives in apps/api.
// Usage: node scripts/serve-web.mjs [--port 8087]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const base = "/app";
const portArg = process.argv.indexOf("--port");
const port = Number(portArg > -1 ? process.argv[portArg + 1] : process.env.PORT || 8087);

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".wasm": "application/wasm",
};

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

/** Streams a file; a file removed mid-request (a rebuild clearing dist/) is a 503, never a crashed server. */
function stream(res, file, headers) {
  const rs = createReadStream(file);
  rs.on("open", () => {
    res.writeHead(200, headers);
    rs.pipe(res);
  });
  rs.on("error", () => {
    if (res.headersSent) return res.destroy();
    send(
      res,
      503,
      { "Content-Type": "text/plain" },
      "The web export is missing or rebuilding. Run the build.",
    );
  });
}

function fileFor(pathname) {
  const rel = normalize(decodeURIComponent(pathname.slice(base.length))).replace(/^([/\\])+/, "");
  const full = join(root, rel);
  if (full !== root && !full.startsWith(root + sep)) return null; // path traversal
  return existsSync(full) && statSync(full).isFile() ? full : null;
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const { pathname } = url;
  if (pathname === "/" || pathname === "") return send(res, 302, { Location: `${base}/` });
  const member = /^\/s\/([^/]+)\/?$/.exec(pathname);
  if (member) return send(res, 302, { Location: `${base}/s/${member[1]}` });
  if (pathname !== base && !pathname.startsWith(`${base}/`)) {
    return send(res, 404, { "Content-Type": "text/plain" }, "Not found");
  }
  const file = fileFor(pathname);
  if (file) {
    const immutable = pathname.includes("/_expo/static/") || pathname.includes("/assets/");
    return stream(res, file, {
      "Content-Type": types[extname(file)] ?? "application/octet-stream",
      "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
      "X-Content-Type-Options": "nosniff",
    });
  }
  // Asset-looking paths that do not exist are real 404s; everything else is a client route.
  if (extname(pathname)) return send(res, 404, { "Content-Type": "text/plain" }, "Not found");
  return stream(res, join(root, "index.html"), {
    "Content-Type": types[".html"],
    "Cache-Control": "no-cache",
  });
});

server.listen(port, () => {
  console.log(`Fair Split web export: http://localhost:${port}${base}/  (serving ${root})`);
});
