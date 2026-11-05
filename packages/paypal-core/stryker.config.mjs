// Mutation testing (handoff T3). From this folder, see tools/stryker/base.mjs for the npx command:
//   npx --yes -p @stryker-mutator/core@10.0.0 -p @stryker-mutator/vitest-runner@10.0.0 -p vitest@5.0.5 \
//     -p typescript@6.0.3 stryker run stryker.config.mjs
import { strykerConfig } from "../../tools/stryker/base.mjs";

export default strykerConfig({
  // The money paths: webhook self-verification (signature input, CRC32, cert URL, freshness, replay), the
  // event → item-status map and its stored apply, and the HTTP layer that carries the idempotency key.
  mutate: [
    "src/webhook/verify.ts",
    "src/webhook/transmission.ts",
    "src/webhook/cert-url.ts",
    "src/webhook/event.ts",
    "src/webhook/stored-apply.ts",
    "src/item-status.ts",
    "src/http.ts",
  ],
});
