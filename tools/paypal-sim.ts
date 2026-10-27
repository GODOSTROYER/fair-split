// Starts the Fair Split PayPal sandbox SIMULATOR (simulated rail, ADR-0002 — not PayPal).
//   corepack pnpm exec tsx tools/paypal-sim.ts [--port 4010] [--host 127.0.0.1] [--speed 1]
//                                               [--public-url https://…] [--fresh]
//                                               [--webhook-origin http://localhost:8787]… [--allow-loopback-webhooks]
// --fresh ignores the saved snapshot (keys stay). --webhook-origin (repeatable) adds an origin webhooks may be
// delivered to (the server itself never is one). Options map onto the SIM_* variables documented in
// packages/paypal-sim/README.md; flags win over the environment. The admin token is read from SIM_ADMIN_TOKEN
// only, never from a flag, so it does not show up in process listings; bound to a non-loopback --host, the
// admin API answers only with it.
// (The repo root has no "type": "module", so this file is CommonJS and loads the ESM package dynamically.)

const USAGE =
  "usage: tsx tools/paypal-sim.ts [--port 4010] [--host 127.0.0.1] [--speed 1] [--public-url URL] [--fresh] " +
  "[--webhook-origin ORIGIN]… [--allow-loopback-webhooks]";

const env: NodeJS.ProcessEnv = { ...process.env };
const origins: string[] = [];
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const flag = args[i];
  const value = args[i + 1];
  switch (flag) {
    case "--port":
      env.SIM_PORT = value;
      i++;
      break;
    case "--host":
      env.SIM_HOST = value;
      i++;
      break;
    case "--speed":
      env.SIM_SPEED = value;
      i++;
      break;
    case "--public-url":
      env.SIM_PUBLIC_URL = value;
      i++;
      break;
    case "--webhook-origin":
      if (value) origins.push(value);
      i++;
      break;
    case "--allow-loopback-webhooks":
      env.SIM_ALLOW_LOOPBACK_WEBHOOKS = "1";
      break;
    case "--fresh":
      env.SIM_PERSIST = "0";
      break;
    case "--help":
    case "-h":
      console.log(USAGE);
      process.exit(0);
      break;
    default:
      console.error(`unknown flag ${flag}\n${USAGE}`);
      process.exit(2);
  }
}
if (origins.length > 0)
  env.SIM_WEBHOOK_ORIGINS = [env.SIM_WEBHOOK_ORIGINS, ...origins].filter((o) => o).join(",");

import("../packages/paypal-sim/src/bin/start.js")
  .then(({ main }) => main(env))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
