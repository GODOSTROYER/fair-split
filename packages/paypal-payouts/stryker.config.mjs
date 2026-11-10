// Mutation testing (handoff T3). From this folder, see tools/stryker/base.mjs for the npx command:
//   npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 -p vitest@5.0.5 \
//     -p typescript@6.0.3 stryker run stryker.config.mjs
import { strykerConfig } from "../../tools/stryker/base.mjs";

export default strykerConfig({
  // The money paths: build, guard and post the batch (service), its ids, idempotency key and wire amounts, the
  // strict batch schema, and the HTTP calls. The toolkit-shaped tool shell and its schema text are left out.
  mutate: [
    "src/service.ts",
    "src/ids.ts",
    "src/money.ts",
    "src/fair-split-schema.ts",
    "src/regex.ts",
    "src/functions.ts",
  ],
});
