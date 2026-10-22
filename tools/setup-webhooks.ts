// Registers (or repairs) the PayPal webhook for one sandbox REST app. Idempotent.
//
//   corepack pnpm tsx tools/setup-webhooks.ts --app fs-dev --url https://<tunnel>.trycloudflare.com/webhooks/paypal
//   corepack pnpm tsx tools/setup-webhooks.ts --app fs-judge --url https://<service>.onrender.com/webhooks/paypal
//
// Credentials come from the environment (PP_CLIENT_ID / PP_CLIENT_SECRET, or the PAYPAL_* names in
// .env.example), loaded from .env.local and .env at the repo root when present. Only non-secret ids
// are printed: the webhook id (as PP_WEBHOOK_ID=…), the lookup id, the URL and scope names.
// Logic and tests live in @fairsplit/paypal-core (src/admin/setup-webhooks.ts).
//
// The repo root has no "type": "module", so this file avoids import.meta and top-level await and
// loads the (ESM) package with a dynamic import; it runs the same under CommonJS or ESM.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return start;
    dir = parent;
  }
}

/** Load env files without overriding variables that are already set (.env.local beats .env). Never prints values. */
function loadEnvFiles(root: string): void {
  for (const name of [".env.local", ".env"]) {
    const path = join(root, name);
    if (!existsSync(path)) continue;
    const before = { ...process.env };
    process.loadEnvFile(path);
    for (const [key, value] of Object.entries(before)) process.env[key] = value;
  }
}

async function main(): Promise<number> {
  loadEnvFiles(findRepoRoot(process.cwd()));
  const { runSetupWebhooks } = await import("@fairsplit/paypal-core");
  return runSetupWebhooks(process.argv.slice(2), process.env, {
    out: (line) => process.stdout.write(`${line}\n`),
    err: (line) => process.stderr.write(`${line}\n`),
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`setup-webhooks failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
