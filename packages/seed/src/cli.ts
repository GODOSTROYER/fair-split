// `corepack pnpm --filter @fairsplit/seed run generate` writes snapshot/season-2026A.json.
// The output is deterministic; Biome then formats it so the pre-commit check stays green.
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSnapshot } from "./build.js";

const here = dirname(fileURLToPath(import.meta.url));
export const SNAPSHOT_PATH = resolve(here, "../snapshot/season-2026A.json");

const { snapshot } = buildSnapshot();
mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
writeFileSync(SNAPSHOT_PATH, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");

const require = createRequire(import.meta.url);
try {
  const biomeBin = join(dirname(require.resolve("@biomejs/biome/package.json")), "bin", "biome");
  const out = spawnSync(process.execPath, [biomeBin, "format", "--write", SNAPSHOT_PATH], {
    stdio: "inherit",
  });
  if (out.status !== 0) process.exitCode = out.status ?? 1;
} catch {
  console.warn("Biome not found; the snapshot is written but not formatted.");
}
const f = snapshot.figures;
console.log(
  `season-2026A.json: ${snapshot.members.length} members, ${snapshot.slips.length} slip images, ${snapshot.photos.length} photos; ` +
    `net ${f.display.net}, batch ${f.batchItemCount} items ${f.display.batchTotal}; rc ${f.display.rc}; attempt ${snapshot.generator.attempt}`,
);
