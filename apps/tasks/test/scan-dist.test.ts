import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  distFiles,
  isSecretEnvName,
  MIN_SECRET_LENGTH,
  main,
  parseArgs,
  SECRET_PATTERNS,
  scanBytes,
  scanDist,
  secretNeedles,
} from "../../../tools/scan-dist.js";

// Credential-shaped strings are assembled at runtime so that no literal sits in the source for the
// pre-commit secret guards to (rightly) refuse.
const fakeAnthropic = () => ["sk", "ant", "api03", "Q".repeat(40)].join("-");
const fakePayPalToken = () => `${"A21"}${"AA"}${"Fq".repeat(20)}`;
const fakeRender = () => `${"rnd"}_${"7".repeat(32)}`;
const CLIENT_SECRET = ["EJ", "x9", "not-a-real", "secret", "value"].join("_");
const ENV: NodeJS.ProcessEnv = {
  PP_CLIENT_SECRET: CLIENT_SECRET,
  PP_ENV: "sandbox",
  PP_MODE: "simulator",
  EXPO_PUBLIC_API_ORIGIN: "https://fs-api.onrender.com",
  COOKIE_KEY: "short",
  NODE_VERSION: "24.22.1",
};

let root: string;
const tree = (files: Record<string, string | Buffer>) => {
  root = mkdtempSync(join(tmpdir(), "fs-scan-dist-"));
  for (const [rel, body] of Object.entries(files)) {
    const path = join(root, rel);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, body);
  }
  return root;
};

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("tools/scan-dist (S3.13: secrets never reach apps/*/dist)", () => {
  it("passes a clean build and says what it scanned", () => {
    tree({
      "apps/console/dist/assets/index.js": 'const origin="https://fs-api.onrender.com";',
      "apps/api/dist/index.js": "export const env = process.env.PP_ENV;",
    });
    const lines: string[] = [];
    expect(main([`--root=${root}`], ENV, (l) => lines.push(l))).toBe(0);
    expect(lines.at(-1)).toBe("scan-dist: PASS");
    expect(lines[0]).toMatch(/2 files under apps\/\*\/dist, 1 secret values/);
  });

  it("fails on a secret env value, naming the variable and the file but never the value", () => {
    tree({ "apps/console/dist/assets/index-abc.js": `var a="${CLIENT_SECRET}";` });
    const lines: string[] = [];
    expect(main([`--root=${root}`], ENV, (l) => lines.push(l))).toBe(1);
    expect(lines).toContain("scan-dist: FOUND env:PP_CLIENT_SECRET in apps/console/dist/assets/index-abc.js");
    expect(lines.join("\n")).not.toContain(CLIENT_SECRET);
    expect(lines.at(-1)).toMatch(/^scan-dist: FAIL \(1 findings\)/);
  });

  it("finds the URL-encoded form of a value, and values inside source maps", () => {
    const password = "Zm9v+YmFy/=@:?#";
    tree({
      "apps/api/dist/index.js.map": JSON.stringify({
        sourcesContent: [`u="${encodeURIComponent(password)}"`],
      }),
    });
    const r = scanDist(root, { FS_APP_DB_PASSWORD: password });
    expect(r.findings).toEqual([{ file: "apps/api/dist/index.js.map", what: "env:FS_APP_DB_PASSWORD" }]);
  });

  it("ignores public names, PayPal switches and values under 8 characters, even when they ship", () => {
    tree({ "apps/mobile/dist/app.js": "sandbox simulator short https://fs-api.onrender.com 24.22.1" });
    expect(scanDist(root, ENV).findings).toEqual([]);
    expect(secretNeedles(ENV).map((n) => n.name)).toEqual(["PP_CLIENT_SECRET"]);
    expect(MIN_SECRET_LENGTH).toBe(8);
  });

  it("recognises PayPal, Anthropic and Render credentials by shape, in text and binary files", () => {
    const binary = Buffer.concat([
      Buffer.from([0, 255, 1, 128]),
      Buffer.from(fakeRender()),
      Buffer.from([7, 0]),
    ]);
    tree({
      "apps/console/dist/a.js": `x("${fakeAnthropic()}")`,
      "apps/console/dist/b.js": `Authorization: Bearer ${fakePayPalToken()}`,
      "apps/console/dist/media/c.webp": binary,
    });
    const what = scanDist(root, {}).findings.map((f) => `${f.file} ${f.what}`);
    expect(what).toEqual([
      "apps/console/dist/a.js pattern:Anthropic API key (sk-ant-…)",
      "apps/console/dist/b.js pattern:PayPal access token (A21AA…)",
      "apps/console/dist/media/c.webp pattern:Render API key (rnd_…)",
    ]);
    expect(SECRET_PATTERNS.map((p) => p.label)).toContain("PEM private key");
  });

  it("does not trip on the bare prefixes in ordinary minified code", () => {
    expect(scanBytes(Buffer.from('var rnd_=Math.random,k="sk-ant-",t="A21AA";'), [])).toEqual([]);
  });

  it("scans only apps/<app>/dist, recursively", () => {
    tree({
      "apps/api/src/index.ts": CLIENT_SECRET,
      "packages/db/dist/index.js": CLIENT_SECRET,
      "apps/console/dist/deep/er/x.js": "ok",
    });
    expect(distFiles(root).map((f) => f.slice(root.length + 1).replaceAll("\\", "/"))).toEqual([
      "apps/console/dist/deep/er/x.js",
    ]);
    expect(scanDist(root, ENV).findings).toEqual([]);
  });

  it("never follows a symlink out of dist", () => {
    tree({ "apps/console/dist/ok.js": "ok", "outside/secret.txt": CLIENT_SECRET });
    try {
      symlinkSync(join(root, "outside"), join(root, "apps/console/dist/link"), "junction");
    } catch {
      return; // no symlink privilege on this machine; the walker's isSymbolicLink() guard is still typed in
    }
    expect(scanDist(root, ENV).findings).toEqual([]);
  });

  it("passes with nothing to scan, and parses its one flag strictly", () => {
    tree({ "apps/api/package.json": "{}" });
    expect(scanDist(root, ENV)).toEqual({ files: 0, needles: 1, findings: [] });
    expect(parseArgs([], "/repo")).toEqual({ root: "/repo" });
    expect(() => parseArgs(["--verbose"], "/repo")).toThrow(/unknown argument/);
  });

  it("treats render.yaml's secrets and database URLs as secret, public and switch names as not", () => {
    for (const name of [
      "PP_CLIENT_SECRET",
      "PP_BUSINESS_EMAIL",
      "ANTHROPIC_API_KEY",
      "RENDER_API_KEY",
      "STATEMENT_SIGNING_KEY",
      "OPS_PASSWORD_SCRYPT",
      "JUDGE_CODE_SHA256",
      "FS_APP_DB_PASSWORD",
      "DATABASE_URL",
      "DATABASE_OWNER_URL",
      "FS_TEST_DATABASE_URL",
      "PAYPAL_CLIENT_SECRET",
      "EXPO_PUSH_TOKEN",
    ])
      expect(isSecretEnvName(name), name).toBe(true);
    for (const name of [
      "PP_ENV",
      "PP_MODE",
      "EXPO_PUBLIC_API_ORIGIN",
      "VITE_PUBLIC_KEY_ID",
      "NODE_VERSION",
      "FS_KILL",
    ])
      expect(isSecretEnvName(name), name).toBe(false);
  });
});
