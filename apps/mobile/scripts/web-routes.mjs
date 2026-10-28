// How the local web server answers a path, the way fs-api serves the export (register §4, C-11). Pure, so the
// routing is tested without a socket (web-routes.test.mjs); serve-web.mjs does the I/O.
import { extname } from "node:path";

/**
 * @param {string} pathname The request's decoded path.
 * @param {{ base: string, isFile: (pathname: string) => boolean }} opts `isFile` says whether a path under the base
 *   names a file in the export.
 * @returns {{ kind: "redirect", location: string } | { kind: "file" } | { kind: "index" } | { kind: "not-found" }}
 */
export function routeRequest(pathname, { base, isFile }) {
  if (pathname === "/" || pathname === "") return { kind: "redirect", location: `${base}/` };
  // The member's short link: /s/:token → /app/s/:token.
  const member = /^\/s\/([^/]+)\/?$/.exec(pathname);
  if (member) return { kind: "redirect", location: `${base}/s/${member[1]}` };
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return { kind: "not-found" };
  if (isFile(pathname)) return { kind: "file" };
  // A member link's token is `body.sig`: its dot is not a file extension, so the app always opens it.
  if (pathname.startsWith(`${base}/s/`)) return { kind: "index" };
  // Asset-looking paths that do not exist are real 404s; everything else is a client route.
  if (extname(pathname)) return { kind: "not-found" };
  return { kind: "index" };
}
