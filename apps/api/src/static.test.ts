import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HTML_CSP } from "./middleware/security.js";
import { findRepoRoot, staticDirs } from "./static.js";
import { createTestApp, type TestApp } from "./test/index.js";

let root: string;
let t: TestApp;

beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "fs-static-"));
  const console = path.join(root, "console");
  const app = path.join(root, "app");
  const media = path.join(root, "media");
  mkdirSync(path.join(console, "assets"), { recursive: true });
  mkdirSync(path.join(app, "_expo", "static", "js"), { recursive: true });
  mkdirSync(path.join(media, "audio"), { recursive: true });
  writeFileSync(path.join(console, "index.html"), "<!doctype html><title>console</title>");
  writeFileSync(path.join(console, "assets", "index-abc123.js"), "console.log(1)");
  writeFileSync(path.join(app, "index.html"), "<!doctype html><title>app</title>");
  writeFileSync(path.join(app, "_expo", "static", "js", "entry-1.js"), "1");
  writeFileSync(path.join(media, "audio", "M-014-ceb.m4a"), Buffer.alloc(2048, 7));
  t = await createTestApp({ static: { console, app, media } });
});

afterAll(async () => {
  await t.close();
  rmSync(root, { recursive: true, force: true });
});

const html = { accept: "text/html" };

describe("static serving (one origin)", () => {
  it("serves the console's index.html for client-side routes, never cached, with the HTML CSP", async () => {
    for (const p of [
      "/",
      "/judge",
      "/season/2026-A/rate-card",
      "/runs/2026A-r37/split",
      "/proof/2026A-r37",
      "/b/fsb_x",
      "/ops",
    ]) {
      const r = await t.request(p, { headers: html });
      expect(r.status, p).toBe(200);
      expect(await r.text(), p).toContain("<title>console</title>");
      expect(r.headers.get("cache-control"), p).toBe("no-cache");
      expect(r.headers.get("content-security-policy"), p).toBe(HTML_CSP);
    }
    expect((await t.request("/judge", { headers: html })).headers.get("x-robots-tag")).toBe(
      "noindex, nofollow",
    );
  });

  it("hashed console assets are immutable; a missing asset is a 404, not index.html", async () => {
    const r = await t.request("/assets/index-abc123.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await t.request("/assets/missing.js")).status).toBe(404);
  });

  it("serves the Expo export under /app with its own index.html fallback", async () => {
    expect((await t.request("/app")).status).toBe(308);
    const page = await t.request("/app/pair", { headers: html });
    expect(await page.text()).toContain("<title>app</title>");
    const js = await t.request("/app/_expo/static/js/entry-1.js");
    expect(js.status).toBe(200);
    expect(js.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
  });

  it("serves /media immutable, with byte ranges for audio seeking", async () => {
    const r = await t.request("/media/audio/M-014-ceb.m4a", { headers: { range: "bytes=0-99" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-99/2048");
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await t.request("/media/../console/index.html")).status).not.toBe(200);
  });

  it("a member's /s/:token link opens the app's statement (302), never cached, never referred", async () => {
    const token = `fsm_${"a".repeat(40)}.${"b".repeat(86)}`;
    const r = await t.request(`/s/${token}`, { headers: html, redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe(`/app/s/${token}`);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await t.request("/s/%3Cscript%3E", { headers: html, redirect: "manual" })).status).toBe(404);
  });

  it("API paths never fall through to a page", async () => {
    for (const p of ["/v1/whatever", "/webhooks/other", "/internal/x"]) {
      const r = await t.request(p, { headers: html });
      expect(r.status, p).toBe(404);
      expect(r.headers.get("content-type"), p).toMatch(/application\/json/);
    }
  });
});

describe("static directories", () => {
  it("resolve from the repo root by default and from env overrides", () => {
    const repo = findRepoRoot();
    const dirs = staticDirs({});
    expect(dirs.console).toBe(path.join(repo, "apps", "console", "dist"));
    expect(dirs.app).toBe(path.join(repo, "apps", "mobile", "dist"));
    expect(dirs.media).toBe(path.join(repo, "media", "public"));
    expect(staticDirs({ consoleDir: root }).console).toBe(path.resolve(root));
  });

  it("a missing build shows a labelled placeholder, not an error page", async () => {
    const empty = await createTestApp({
      static: { console: path.join(root, "nope"), app: path.join(root, "nope"), media: root },
    });
    const r = await empty.request("/judge", { headers: html });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain("console not built");
    await empty.close();
  });
});
