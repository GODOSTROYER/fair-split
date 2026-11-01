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
  // a content-hashed name: its bytes can never change under that URL
  writeFileSync(path.join(media, "audio", "M-014-ceb.4f1c9a2e.m4a"), Buffer.alloc(2048, 9));
  writeFileSync(path.join(media, "audio", "manifest.json"), '{"v":1,"clips":[]}');
  mkdirSync(path.join(media, "photos"), { recursive: true });
  writeFileSync(path.join(media, "photos", "A.webp"), Buffer.alloc(64, 1));
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

  it("serves a content-hashed /media file immutable, with byte ranges for audio seeking", async () => {
    const r = await t.request("/media/audio/M-014-ceb.4f1c9a2e.m4a", { headers: { range: "bytes=0-99" } });
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-99/2048");
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect((await t.request("/media/../console/index.html")).status).not.toBe(200);
    expect((await t.request("/media/%2e%2e/console/index.html")).status).not.toBe(200);
    expect((await t.request("/media/audio/..%2f..%2fconsole%2findex.html")).status).not.toBe(200);
  });

  it("the audio manifest and other unhashed media are revalidated on every use (no-cache + ETag, 304)", async () => {
    // The manifest changes whenever a clip is added or retaken, and a clip or photo keeps its name across a
    // retake: an immutable copy would keep playing (or showing) the old bytes for a year.
    for (const p of ["/media/audio/manifest.json", "/media/audio/M-014-ceb.m4a", "/media/photos/A.webp"]) {
      const r = await t.request(p);
      expect(r.status, p).toBe(200);
      expect(r.headers.get("cache-control"), p).toBe("no-cache");
      const etag = r.headers.get("etag");
      expect(etag, p).toMatch(/^W\/"[0-9a-f]+-[0-9a-f]+"$/);
      const again = await t.request(p, { headers: { "if-none-match": etag as string } });
      expect(again.status, p).toBe(304);
      expect(again.headers.get("cache-control"), p).toBe("no-cache");
      expect(again.headers.get("etag"), p).toBe(etag);
      expect(await again.text(), p).toBe("");
      const stale = await t.request(p, { headers: { "if-none-match": 'W/"0-0"' } });
      expect(stale.status, p).toBe(200);
    }
    expect(await (await t.request("/media/audio/manifest.json")).text()).toBe('{"v":1,"clips":[]}');
    // an unhashed clip still seeks
    const part = await t.request("/media/audio/M-014-ceb.m4a", { headers: { range: "bytes=0-9" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("cache-control")).toBe("no-cache");
    expect(part.headers.get("etag")).toMatch(/^W\//);
    // a missing media file is a 404, never revalidated into a page
    const missing = await t.request("/media/audio/missing.json");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("etag")).toBeNull();
  });

  it("a brand link /b/:token opens the console whatever the token holds, the signed dotted form included", async () => {
    const signed = `fsb_${"a".repeat(40)}.${"b-_".repeat(29)}`;
    for (const p of [`/b/${signed}`, "/b/fsb_x", "/b/fsb_x.y", "/b/fsb_x.js", "/b/fsb_%3Cx%3E.y"]) {
      const r = await t.request(p, { headers: html });
      expect(r.status, p).toBe(200);
      expect(await r.text(), p).toContain("<title>console</title>");
      expect(r.headers.get("cache-control"), p).toBe("no-cache");
      expect(r.headers.get("content-security-policy"), p).toBe(HTML_CSP);
      expect(r.headers.get("referrer-policy"), p).toBe("no-referrer");
      expect(r.headers.get("x-robots-tag"), p).toBe("noindex, nofollow");
    }
  });

  it("a brand link never reaches a file: traversal in the token still opens only the console's page", async () => {
    for (const p of [
      "/b/..%2Fapp%2Findex.html",
      "/b/..%2F..%2Fapp%2Findex.html",
      "/b/%2e%2e%2fassets%2findex-abc123.js",
      "/b/..%5C..%5Capp%5Cindex.html",
    ]) {
      const r = await t.request(p, { headers: html });
      const body = await r.text();
      expect(body, p).not.toContain("<title>app</title>");
      expect(body, p).not.toContain("console.log(1)");
      if (r.status === 200) expect(body, p).toContain("<title>console</title>");
      else expect(r.status, p).toBe(404);
    }
  });

  it("a missing static asset is a 404, never index.html, whatever the client accepts", async () => {
    for (const p of ["/assets/missing.js", "/favicon-x.png", "/assets/index-abc123.js.map", "/b/x/y.js"]) {
      for (const headers of [html, { accept: "*/*" }, {}]) {
        const r = await t.request(p, { headers });
        expect(r.status, p).toBe(404);
        expect(await r.text(), p).not.toContain("<title>console</title>");
      }
    }
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

  it("resolves a relative STATIC_*_DIR against the repository root, not the working directory", () => {
    // render.yaml sets STATIC_MEDIA_DIR=apps/api/dist/media, the folder tools/assemble-media.ts writes.
    const dirs = staticDirs({ repoRoot: root, mediaDir: "apps/api/dist/media", appDir: "x/app" });
    expect(dirs.media).toBe(path.join(root, "apps", "api", "dist", "media"));
    expect(dirs.app).toBe(path.join(root, "x", "app"));
    expect(staticDirs({ repoRoot: root, mediaDir: path.join(root, "abs") }).media).toBe(
      path.join(root, "abs"),
    );
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
