import { describe, expect, it } from "vitest";
import { routeRequest } from "./web-routes.mjs";

const files = new Set(["/app/index.html", "/app/favicon.ico", "/app/_expo/static/js/web/entry-abc.js"]);
const route = (pathname) => routeRequest(pathname, { base: "/app", isFile: (p) => files.has(p) });

describe("the local web server routes like fs-api (register §4, C-11)", () => {
  it("sends the bare origin and the short member link to the app", () => {
    expect(route("/")).toEqual({ kind: "redirect", location: "/app/" });
    expect(route("/s/eyJ2IjoxfQ.c2ln")).toEqual({ kind: "redirect", location: "/app/s/eyJ2IjoxfQ.c2ln" });
    expect(route("/s/abc~def/")).toEqual({ kind: "redirect", location: "/app/s/abc~def" });
  });

  it("serves the app for a member link whose token has a dot (body.sig), never a 404", () => {
    expect(route("/app/s/eyJ2IjoxfQ.c2ln")).toEqual({ kind: "index" });
    expect(route("/app/s/a.b.c")).toEqual({ kind: "index" });
    expect(route("/app/s/abc~def")).toEqual({ kind: "index" });
  });

  it("serves files that exist, the app for client routes, and 404s for missing assets", () => {
    expect(route("/app/favicon.ico")).toEqual({ kind: "file" });
    expect(route("/app/_expo/static/js/web/entry-abc.js")).toEqual({ kind: "file" });
    expect(route("/app/bayad")).toEqual({ kind: "index" });
    expect(route("/app/pirma/2026A-r37/sign")).toEqual({ kind: "index" });
    expect(route("/app/")).toEqual({ kind: "index" });
    expect(route("/app")).toEqual({ kind: "index" });
    expect(route("/app/_expo/static/js/web/missing.js")).toEqual({ kind: "not-found" });
    expect(route("/app/pair.png")).toEqual({ kind: "not-found" });
  });

  it("serves nothing outside the base path", () => {
    expect(route("/application")).toEqual({ kind: "not-found" });
    expect(route("/v1/statements")).toEqual({ kind: "not-found" });
    expect(route("/s/a/b")).toEqual({ kind: "not-found" });
  });
});
