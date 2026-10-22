// Spike (companion to S2): are our two read-only payout tool schemas (zod → JSON Schema, converted
// the same way the toolkit's /openai export converts its own) accepted on claude-opus-5-5, and is
// the model's tool input valid under the vendored PR #107 schema?
//
// Run: corepack pnpm --filter @fairsplit/paypal-payouts spike:s2-payouts [--live]
// Without --live it prints the cached result. Spend: one small Opus 5.5 call (≈ US$0.01).
// Server-side fallbacks are deliberately off: a fallback would hide what Opus 5.5 itself does.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { agentPayoutToolSchemas, agentPayoutTools } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const cacheFile = join(here, "..", ".cache", "spikes", "s2-payouts.jsonl");
const MODEL = "claude-opus-5-5";

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    if (!existsSync(cacheFile)) throw new Error("No cached result; run with --live");
    const runs = readFileSync(cacheFile, "utf8").trim().split("\n");
    console.log(JSON.stringify(JSON.parse(runs.at(-1) ?? "{}"), null, 2));
    return;
  }
  const envFile = join(here, "..", "..", "..", ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile); // values are never printed
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");

  const client = new Anthropic({ maxRetries: 1 });
  const tools: Anthropic.Tool[] = agentPayoutToolSchemas().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const zod = new Map(agentPayoutTools().map((t) => [t.method, t.parameters]));
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        "Payout item 8AELMXH8UB2P8 for member M-031 has not landed. Look it up and tell me its status.",
    },
  ];

  const counted = await client.messages.countTokens({ model: MODEL, tools, messages });
  const t0 = performance.now();
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    output_config: { effort: "low" },
    system:
      "You help a co-op treasurer follow PayPal payouts with the tools provided. Call a tool when asked to look something up.",
    tools,
    messages,
  });
  const ms = Math.round(performance.now() - t0);
  const toolCalls = res.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      name: b.name,
      input: b.input,
      zodValid: zod.get(b.name)?.safeParse(b.input).success ?? false,
    }));
  const usage = { input_tokens: res.usage.input_tokens, output_tokens: res.usage.output_tokens };
  const result = {
    spike: "S2 companion: payout read tools",
    model: MODEL,
    ranAt: new Date().toISOString(),
    countTokens: counted.input_tokens,
    ms,
    stopReason: res.stop_reason,
    toolCalls,
    usage,
    costUsd: Math.round(((usage.input_tokens * 4 + usage.output_tokens * 20) / 1e6) * 1e4) / 1e4,
  };
  mkdirSync(dirname(cacheFile), { recursive: true });
  appendFileSync(cacheFile, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
