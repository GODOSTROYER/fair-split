// Mutation testing (handoff T3). From this folder, see tools/stryker/base.mjs for the npx command:
//   npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 -p vitest@5.0.5 \
//     -p typescript@6.0.3 stryker run stryker.config.mjs
import { strykerConfig } from "../../tools/stryker/base.mjs";

// The canonical figures and the world built from them; cli.ts only writes the snapshot to disk.
export default strykerConfig({
  mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/cli.ts"],
  // Less photo-hashes.test.ts, whose path to the repo's media/ does not resolve from Stryker's sandbox.
  vitestConfig: "vitest.stryker.config.ts",
});
