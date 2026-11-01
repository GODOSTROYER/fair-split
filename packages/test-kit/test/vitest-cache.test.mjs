// Turbo launches one Vitest process per package. Vitest's default filesystem module cache lives at the
// workspace root, where simultaneous startup invalidations can delete one another's freshly written files.
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "vitest/node";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
// These two configs belong to active builders and are explicitly excluded from HD2's editable paths.
const deferred = new Set(["apps/console", "apps/mobile"]);
const packages = [
  ...["apps", "packages"].flatMap((folder) =>
    readdirSync(join(repo, folder), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${folder}/${entry.name}`),
  ),
  "media",
].filter((folder) => {
  if (deferred.has(folder)) return false;
  const pkg = JSON.parse(readFileSync(join(repo, folder, "package.json"), "utf8"));
  return /\bvitest\b/.test(pkg.scripts?.test ?? "");
});

describe("package filesystem module caches", () => {
  it("resolves each package to its own cache, including when the caller's cwd is elsewhere", async () => {
    const caches = new Set();
    for (const folder of packages) {
      const root = join(repo, folder);
      const config = await resolveConfig({ root });
      const cache = config.test.fsModuleCachePath;
      expect(resolve(cache), folder).toBe(resolve(root, "node_modules/.vitest-cache"));
      expect(caches.has(cache), folder).toBe(false);
      caches.add(cache);
    }
    expect(caches.size).toBe(packages.length);
  }, 60_000);
});
