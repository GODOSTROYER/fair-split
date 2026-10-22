// Starts the Fair Split PayPal sandbox SIMULATOR (simulated rail, ADR-0002 — not PayPal).
//   corepack pnpm exec tsx tools/paypal-sim.ts [--port 4010] [--host 127.0.0.1] [--speed 1]
//                                               [--public-url https://…] [--fresh]
// --fresh ignores the saved snapshot (keys stay). Options map onto the SIM_* variables documented in
// packages/paypal-sim/README.md; flags win over the environment.
// (The repo root has no "type": "module", so this file is CommonJS and loads the ESM package dynamically.)

const env: NodeJS.ProcessEnv = { ...process.env };
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
    case "--fresh":
      env.SIM_PERSIST = "0";
      break;
    case "--help":
    case "-h":
      console.log(
        "usage: tsx tools/paypal-sim.ts [--port 4010] [--host 127.0.0.1] [--speed 1] [--public-url URL] [--fresh]",
      );
      process.exit(0);
      break;
    default:
      console.error(`unknown flag ${flag}`);
      process.exit(2);
  }
}

import("../packages/paypal-sim/src/bin/start.js")
  .then(({ main }) => main(env))
  .catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
