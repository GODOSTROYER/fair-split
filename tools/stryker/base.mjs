// Shared StrykerJS settings for the money core's mutation tests (handoff T3). Each package's
// stryker.config.mjs calls strykerConfig() with what it mutates. Run it from the package folder; it adds no
// dependency:
//   npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 -p vitest@5.0.5 \
//     -p typescript@6.0.3 stryker run stryker.config.mjs
// typescript@6.0.3 and vitest@5.0.5 are the repo's own pins: Stryker's tsconfig step imports typescript from its
// own install, and npm would otherwise add the newest Vitest as the runner's peer. The runner itself loads the
// workspace's Vitest.
//
// Where Stryker writes: the package's coverage/ folder (gitignored, and ignored by Biome). The sandbox must be
//   - inside the repo, so that it resolves the workspace's hoisted vitest (outside, the runner silently falls
//     back to the copy npx installed);
//   - outside node_modules/, which Vitest never searches for tests, and outside dot folders, which its globbing
//     skips;
//   - exactly one folder below the package, because Stryker rewrites the tsconfig "extends" path as if it were.
// So tempDirName is "coverage", and the incremental file and reports go to coverage/stryker/.
import { fileURLToPath } from "node:url";

const OUT = "coverage/stryker";
const RUNNER = fileURLToPath(new URL("./vitest5-runner.mjs", import.meta.url));

/**
 * @param {{ mutate: string[], vitestConfig?: string, timeoutMS?: number, concurrency?: number }} options
 * @returns {import("@stryker-mutator/api/core").PartialStrykerOptions}
 */
export function strykerConfig({
  mutate,
  vitestConfig = "vitest.config.ts",
  timeoutMS = 60_000,
  concurrency = 2,
}) {
  return {
    testRunner: "vitest",
    vitest: { configFile: vitestConfig, related: false },
    // The published Vitest runner, adapted to Vitest 5's test names (see vitest5-runner.mjs).
    plugins: [RUNNER],
    mutate,
    coverageAnalysis: "perTest",
    // A mutant hit only while modules load (a constant table, say) needs the whole suite rerun with a fresh
    // module graph, which costs as much as every other mutant together. Those are skipped ("Ignored") unless
    // STRYKER_STATIC=1; a mutant that tests also cover still runs against those tests either way.
    ignoreStatic: process.env.STRYKER_STATIC !== "1",
    // The machine is shared: two test processes at most.
    concurrency,
    timeoutMS,
    incremental: true,
    incrementalFile: `${OUT}/incremental.json`,
    tempDirName: "coverage",
    cleanTempDir: "always",
    reporters: ["clear-text", "progress", "json", "html"],
    jsonReporter: { fileName: `${OUT}/mutation.json` },
    htmlReporter: { fileName: `${OUT}/mutation.html` },
    clearTextReporter: { allowColor: false, logTests: false, reportScoreTable: true },
    thresholds: { high: 90, low: 75, break: null },
  };
}
