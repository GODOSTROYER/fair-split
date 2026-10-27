import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// TEMPORARY: apps/api has no package.json yet (WS-API owns it). Until it does, the webhook route in
// apps/api/src/webhooks (owned by WS-PPCORE) is tested from here. Delete the "api-webhooks" project
// when apps/api gets its own vitest setup, which will pick these tests up unchanged.
const webhooksRoot = fileURLToPath(new URL("../../apps/api/src/webhooks", import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "paypal-core",
          include: ["src/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        root: webhooksRoot,
        test: {
          name: "api-webhooks",
          include: ["**/*.test.ts"],
          environment: "node",
        },
      },
    ],
  },
});
