// Mutation testing (handoff T3). From this folder, see tools/stryker/base.mjs for the npx command:
//   npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 -p vitest@5.0.5 \
//     -p typescript@6.0.3 stryker run stryker.config.mjs
import { strykerConfig } from "../../tools/stryker/base.mjs";

export default strykerConfig({
  // All of the pure domain; sample-keys.ts holds published sample keys only.
  mutate: ["src/**/*.ts", "!src/**/*.test.ts", "!src/__fixtures__/**", "!src/sample-keys.ts"],
});
