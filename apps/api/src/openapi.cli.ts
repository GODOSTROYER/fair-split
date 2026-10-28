// Prints the OpenAPI document (`corepack pnpm --filter @fairsplit/api openapi > openapi.json`), built from the
// same app the server runs, with no database and no network: CI diffs it, Postman and the console read it.
import { writeFileSync } from "node:fs";
import { API_VERSION, createApp } from "./app.js";
import { createFakeClock } from "./lib/clock.js";
import { createTestDeps } from "./test/deps.js";

const clock = createFakeClock();
const { deps } = createTestDeps({
  clock,
  env: { PUBLIC_ORIGIN: process.env.PUBLIC_ORIGIN ?? "https://fs-api.onrender.com" },
});
const app = createApp({
  deps,
  static: false,
  health: { db: async () => undefined, version: API_VERSION, startedAt: clock.now() },
});
const json = `${JSON.stringify(app.openapi(), null, 2)}\n`;
const out = process.argv[2];
if (out) writeFileSync(out, json);
else process.stdout.write(json);
