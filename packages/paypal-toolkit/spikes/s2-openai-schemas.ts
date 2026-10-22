// Spike S2, schema half (register §12): are the toolkit's /openai JSON Schemas accepted as tool
// input_schema on claude-opus-5-5, and does a draft come back that the toolkit's zod accepts and
// that equals the code-built invoice (I1)? The PayPal half (create → send → rule → record →
// verified PAID) waits for the sandbox credentials from spike S1.
//
// Run: corepack pnpm --filter @fairsplit/paypal-toolkit spike:s2 [--live]
// Without --live it prints the cached result. Spend: two small Opus 5.5 calls (< US$0.10).
// Server-side fallbacks are deliberately off here: a fallback would hide what Opus 5.5 itself does.

import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { agentToolSchemas, buildInvoicePlan, reconcileAgentDraft, toolkitZodSchemas } from "../src/index.js";

const here = dirname(fileURLToPath(import.meta.url));
// One JSON line per live run; JSON Lines also keeps the gitignored cache out of Biome's way.
const cacheFile = join(here, "..", ".cache", "spikes", "s2.jsonl");
const MODEL = "claude-opus-5-5";
const SPIKE_CARD = createHash("sha256").update("spike S2 rate card").digest("hex");
const PRICE_PER_MTOK = { input: 4, output: 20 };

interface Probe {
  name: string;
  ok: boolean;
  ms: number;
  stopReason?: string | null;
  toolCalls?: { name: string; input: unknown; zodValid: boolean }[];
  usage?: { input_tokens: number; output_tokens: number };
  costUsd?: number;
  error?: string;
  notes?: string[];
}

function loadEnv(): void {
  const envFile = join(here, "..", "..", "..", ".env");
  if (existsSync(envFile)) process.loadEnvFile(envFile); // values are never printed
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
}

const cost = (u: { input_tokens: number; output_tokens: number }) =>
  Math.round(
    ((u.input_tokens * PRICE_PER_MTOK.input + u.output_tokens * PRICE_PER_MTOK.output) / 1e6) * 1e4,
  ) / 1e4;

async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    if (!existsSync(cacheFile)) throw new Error("No cached S2 result; run with --live");
    const runs = readFileSync(cacheFile, "utf8").trim().split("\n");
    console.log(JSON.stringify(JSON.parse(runs.at(-1) ?? "{}"), null, 2));
    return;
  }
  loadEnv();
  const client = new Anthropic({ maxRetries: 1 });
  const tools: Anthropic.Tool[] = agentToolSchemas().map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema,
  }));
  const zod = toolkitZodSchemas();
  const probes: Probe[] = [];

  const timed = async <T>(fn: () => Promise<T>) => {
    const t0 = performance.now();
    const value = await fn();
    return { value, ms: Math.round(performance.now() - t0) };
  };

  // 1. Free validation: count_tokens parses the whole request, tools included.
  try {
    const { value, ms } = await timed(() =>
      client.messages.countTokens({ model: MODEL, tools, messages: [{ role: "user", content: "ping" }] }),
    );
    probes.push({
      name: "count_tokens with the four /openai schemas",
      ok: true,
      ms,
      usage: { input_tokens: value.input_tokens, output_tokens: 0 },
    });
  } catch (error) {
    probes.push({
      name: "count_tokens with the four /openai schemas",
      ok: false,
      ms: 0,
      error: String(error),
    });
  }

  const run = async (
    name: string,
    system: string,
    prompt: string,
    notes: (p: Probe) => string[] = () => [],
  ) => {
    try {
      const { value, ms } = await timed(() =>
        client.messages.create({
          model: MODEL,
          max_tokens: 4096,
          output_config: { effort: "low" },
          system,
          tools,
          messages: [{ role: "user", content: prompt }],
        }),
      );
      const toolCalls = value.content
        .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
        .map((b) => ({
          name: b.name,
          input: b.input,
          zodValid: zod.get(b.name as never)?.safeParse(b.input).success ?? false,
        }));
      const usage = { input_tokens: value.usage.input_tokens, output_tokens: value.usage.output_tokens };
      const probe: Probe = {
        name,
        ok: true,
        ms,
        stopReason: value.stop_reason,
        toolCalls,
        usage,
        costUsd: cost(usage),
      };
      probe.notes = notes(probe);
      probes.push(probe);
    } catch (error) {
      probes.push({ name, ok: false, ms: 0, error: String(error) });
    }
  };

  const system =
    "You operate a co-op's PayPal sandbox account through the tools provided. Call a tool when the user asks for an action. Use values exactly as given.";

  await run(
    "get_invoice tool call",
    system,
    "Look up PayPal invoice INV2-Z56S-5LLA-Q52L-CPZ5 and tell me its status.",
  );

  const plan = buildInvoicePlan(
    {
      runId: "spike-s2",
      runSeq: 900_001,
      seasonCode: "2026-A",
      rateCardSha256: SPIKE_CARD,
      lotCode: "LB-PH-2026-03",
      quote: {
        currency: "USD",
        items: [
          { key: "PREMIUM", name: "Premium", quantity: "1", unitAmountCents: 288_750 },
          { key: "BONUS", name: "Quality bonus", quantity: "1", unitAmountCents: 138_600 },
          { key: "DISBURSEMENT", name: "Disbursement costs", quantity: "1", unitAmountCents: 6_000 },
        ],
        totalCents: 433_350,
        premiumPoolCents: 288_750,
        bonusPoolCents: 138_600,
        poolCents: 427_350,
        disbursementCents: 6_000,
        lotCode: "LB-PH-2026-03",
        rateCardSha256: SPIKE_CARD,
      },
      payer: { businessName: "Lantern Bay Chocolate Co.", email: "lantern-bay@example.test" },
    },
    { businessEmail: "coop-business@example.test" },
  );
  const a = plan.createArgs;
  const lines = a.items
    .map(
      (i) =>
        `- ${i.name}: quantity ${i.quantity}, unit amount ${i.unit_amount.value} USD, unit_of_measure AMOUNT`,
    )
    .join("\n");
  await run(
    "create_invoice draft (I1 check)",
    system,
    [
      "Draft and create this invoice with create_invoice. Use every value below exactly, except the three item names: " +
        "give each line a short label of your own (at most 40 characters: letters, spaces and ,'()- only; no digits and no number words).",
      `currency_code ${a.currency_code}; invoice_number ${a.invoice_number}; reference ${a.reference}`,
      `note: ${a.note}`,
      `invoicer_email_address ${a.invoicer_email_address}`,
      `primary recipient: business_name ${a.primary_recipients[0]?.billing_info.business_name}, email_address ${a.primary_recipients[0]?.billing_info.email_address}`,
      "items:",
      lines,
      "Do not set any other field.",
    ].join("\n"),
    (p) => {
      const draft = p.toolCalls?.find((c) => c.name === "create_invoice")?.input;
      if (draft === undefined) return ["no create_invoice call"];
      const r = reconcileAgentDraft(draft, plan);
      return r.ok
        ? ["draft reconciles with the code-built invoice (I1 holds)"]
        : r.mismatches.map((m) => `mismatch: ${m}`);
    },
  );

  const result = {
    spike: "S2 (schema half)",
    model: MODEL,
    toolkit: "@paypal/agent-toolkit 1.11.0 /openai",
    ranAt: new Date().toISOString(),
    totalCostUsd: Math.round(probes.reduce((s, p) => s + (p.costUsd ?? 0), 0) * 1e4) / 1e4,
    probes,
  };
  mkdirSync(dirname(cacheFile), { recursive: true });
  appendFileSync(cacheFile, `${JSON.stringify(result)}\n`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
