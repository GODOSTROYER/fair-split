// Mutation testing (handoff T3). From this folder, see tools/stryker/base.mjs for the npx command:
//   npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 -p vitest@5.0.5 \
//     -p typescript@6.0.3 stryker run stryker.config.mjs
// The tests need Postgres: the embedded cluster, or FS_TEST_DATABASE_URL (an admin URL).
import { strykerConfig } from "../../tools/stryker/base.mjs";

export default strykerConfig({
  mutate: ["src/**/*.ts", "!src/_shims/**"],
  // One test process: each Vitest instance's global setup drops the suite's leftover test databases, and two
  // instances in one sandbox share the suite name, so a second one could drop the first one's databases.
  concurrency: 1,
});
