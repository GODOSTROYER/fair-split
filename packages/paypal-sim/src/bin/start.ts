// `corepack pnpm --filter @fairsplit/paypal-sim start` — runs the simulator as a standalone server.
// Env: SIM_PORT (4010), SIM_HOST (127.0.0.1), SIM_DATA_DIR (packages/paypal-sim/.data), SIM_PERSIST (1), plus
// the SIM_* options read by optionsFromEnv(). Nothing secret is printed.
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { optionsFromEnv } from "../config.js";
import { startServer } from "../server.js";

export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const opts = optionsFromEnv(env);
  const dataDir = opts.dataDir ?? fileURLToPath(new URL("../../.data", import.meta.url));
  const started = await startServer({
    ...opts,
    dataDir,
    persist: opts.persist ?? true,
    port: env.SIM_PORT ? Number(env.SIM_PORT) : 4010,
    host: env.SIM_HOST ?? "127.0.0.1",
  });
  const sim = started.simulator;
  const apps = sim.registry.apps.map((a) => a.client_id).join(", ");
  console.log(
    `PayPal sandbox SIMULATOR (Fair Split, simulated rail - not PayPal) listening on ${started.url}`,
  );
  console.log(
    `  speed ${sim.options.speed}, rate limit ${sim.options.rateLimit ? `${sim.options.rateLimit.perMinute}/min` : "off"}`,
  );
  console.log(`  client ids: ${apps} (secrets in packages/paypal-sim/data/accounts.json)`);
  console.log(`  webhook cert: ${sim.certUrl}`);
  const targets = sim.options.webhookTargets;
  console.log(
    `  webhooks delivered only to: ${[...targets.origins].join(", ")}${targets.allowLoopback ? " and loopback hosts (dev)" : ""}`,
  );
  console.log(
    `  admin API: ${sim.options.adminToken ? "x-sim-admin-token required" : sim.localOnly ? "loopback callers only (no SIM_ADMIN_TOKEN)" : "disabled (set SIM_ADMIN_TOKEN)"}`,
  );
  const stop = async () => {
    await started.close();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

function invokedDirectly(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  return resolve(entry).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
}

if (invokedDirectly()) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
