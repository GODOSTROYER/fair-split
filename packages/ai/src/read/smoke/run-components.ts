// SMOKE ONLY: the live check the S3 smoke run left out (review: AI-3 zoom, AI-4 screen, AI-5 rate card
// and AI-6 classifier had never reached the real API). One live call per component on the synthetic
// smoke images and the stub rate-card page (never eval, C-24). Reads A and B replay from the
// committed recordings; every new answer is recorded (scrubbed) beside them, so
// `smoke.replay.test.ts` replays it with no network, and its stop reason, tokens (thinking included),
// latency and cost go into fixtures/report.json under "components". Capped at US$1.50 a day on the
// dev lane, metered in packages/ai/.cache/ (never committed).
// Run: `corepack pnpm --filter @fairsplit/ai smoke:components`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { type ClassifyOutcome, classifyDeduction } from "../../classify/classify.js";
import {
  ClaudeGateway,
  envFlagSource,
  FileSpendMeter,
  FsReplayStore,
  type GatewayResult,
  isGatewayError,
  JsonlCallLedger,
  loadEnv,
  usd,
} from "../../gateway/index.js";
import { readRateCard } from "../../ratecard/read.js";
import type { TextLayer } from "../../ratecard/schema.js";
import type { PhotoFixture } from "../_shims/contracts.js";
import type { ReadDeps } from "../calls.js";
import { type ExtractResult, extract } from "../extract.js";
import { SMOKE_DIR, SMOKE_IMAGES } from "./make-images.js";
import { RATECARD_STUB_FILE, RATECARD_STUB_ID, STUB_DEDUCTION_TERMS, STUB_RC8 } from "./ratecard-stub.js";

const CACHE = fileURLToPath(new URL("../../../.cache/", import.meta.url));
const CAP_USD = 1.5;
/** The component calls were first recorded live on this day; the reads A and B are older. */
const COMPONENTS_SINCE = "2026-10-22T12:00:00.000Z";

/** The registry the smoke slips are validated against (what was drawn on them). */
export const SMOKE_REGISTRY = new Map(
  [
    ["M-101", "Rosa Lim"],
    ["M-102", "Benjie Tan"],
    ["M-103", "Cora Diaz"],
  ].map(([memberNo, name]) => [memberNo as string, { memberNo: memberNo as string, name: name as string }]),
);

/** The smoke documents' extract input; `zoom` and `screen` on, as in production. */
export function smokeInput(id: string, over: { zoom?: boolean; screen?: boolean } = {}) {
  const img = SMOKE_IMAGES.find((i) => i.id === id);
  if (!img) throw new Error(`no smoke image ${id}`);
  const fixture = JSON.parse(readFileSync(`${SMOKE_DIR}${img.id}.fixture.json`, "utf8")) as PhotoFixture;
  return {
    docId: img.id,
    kind: fixture.slips.length > 1 ? ("slip_photo" as const) : ("slip_page" as const),
    bytes: readFileSync(`${SMOKE_DIR}${img.file}`),
    fixture,
    validation: { registry: SMOKE_REGISTRY },
    zoom: over.zoom ?? true,
    screen: over.screen ?? true,
  };
}

/** The stub page and its text layer (AI-5). */
export function ratecardStubInput() {
  return {
    documentId: RATECARD_STUB_ID,
    pages: [readFileSync(`${SMOKE_DIR}${RATECARD_STUB_FILE}`)],
    textLayer: JSON.parse(readFileSync(`${SMOKE_DIR}${RATECARD_STUB_ID}.text.json`, "utf8")) as TextLayer,
  };
}

/** The two classifier smoke lines: an unruled fine (H3's kind) and a correct hauling charge (R2). */
export function classifyInputs(lines: { multa: string; hauling: string }) {
  return [
    {
      docId: "smoke-2-overwrite-smudge",
      row: 0,
      line: lines.multa,
      quarantined: false,
      terms: STUB_DEDUCTION_TERMS,
      rc8: STUB_RC8,
      amount: { netGrams: 80_750 },
    },
    {
      docId: "smoke-1-clean",
      row: 0,
      line: lines.hauling,
      quarantined: false,
      terms: STUB_DEDUCTION_TERMS,
      rc8: STUB_RC8,
      amount: { netGrams: 64_500 },
    },
  ];
}

interface ComponentCall {
  component: string;
  subject: string;
  /** How the answer was made when it was recorded ("live", or "seed_synthetic"), and when. */
  recorded: string;
  recorded_at: string;
  /** This run: "live" (a new answer, now recorded) or "replay" (no call, no cost). */
  this_run: string;
  model: string;
  model_served: string;
  effort: string;
  stop_reason: string | null;
  latency_ms: number;
  first_delta_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  thinking_tokens: number | null;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

async function main(): Promise<void> {
  const env = loadEnv(process.cwd(), ["ANTHROPIC_API_KEY"]);
  console.log(
    `env: ${env.file ? "loaded .env" : "no .env"}; ANTHROPIC_API_KEY ${env.present.ANTHROPIC_API_KEY ? "present" : "MISSING"}`,
  );
  const store = new FsReplayStore(`${SMOKE_DIR}recordings`);
  const gateway = new ClaudeGateway({
    store,
    ledger: new JsonlCallLedger(`${CACHE}smoke-ledger.jsonl`),
    spend: new FileSpendMeter(`${CACHE}spend.jsonl`),
    flags: envFlagSource(),
    caps: { dev: CAP_USD },
  });
  const deps: ReadDeps = { gateway, mode: "auto", lane: "dev" };
  const calls: ComponentCall[] = [];
  const results: Record<string, unknown> = {};

  const record = async (component: string, subject: string, r: GatewayResult) => {
    const rec = await store.get(r.cacheKey);
    calls.push({
      component,
      subject,
      recorded: rec?.provenance ?? "live",
      recorded_at: r.recordedAt,
      this_run: r.provenance,
      model: r.requestedModel,
      model_served: r.modelServed,
      effort: rec?.effort ?? "?",
      stop_reason: r.stopReason,
      latency_ms: r.latencyMs,
      first_delta_ms: rec?.first_delta_ms ?? null,
      input_tokens: r.usage.input_tokens,
      output_tokens: r.usage.output_tokens,
      thinking_tokens: r.usage.thinking_tokens,
      cache_read_input_tokens: r.usage.cache_read_input_tokens,
      cache_creation_input_tokens: r.usage.cache_creation_input_tokens,
      cost_usd: usd(r.recordedCostMicros),
    });
  };
  /** Tags each call of an extract result by its recording's purpose (reads A/B replay at no cost). */
  const recordExtract = async (subject: string, r: ExtractResult) => {
    for (const c of r.calls) {
      const rec = await store.get(c.cacheKey);
      const component =
        rec?.purpose === "zoom"
          ? "AI-3 zoom"
          : rec?.purpose === "screen"
            ? r.rescreen?.result?.cacheKey === c.cacheKey
              ? "AI-4 re-screen"
              : "AI-4 screen"
            : `AI-${rec?.variant === "B" ? "2" : "1"} read ${rec?.variant ?? "?"}`;
      await record(component, subject, c);
    }
  };

  // AI-3 and AI-4 through the whole pipeline. smoke-2: a stained net weight both reads call SMUDGED
  // (rule 5), so the zoom re-reads it on a sanitised crop.
  const r2 = await extract(smokeInput("smoke-2-overwrite-smudge"), deps);
  await recordExtract("smoke-2-overwrite-smudge", r2);
  const net = r2.rows[0]?.fields.net_kg;
  results["smoke-2-overwrite-smudge"] = {
    screen: {
      suspected: r2.screen?.suspected ?? null,
      refusal: r2.screen?.refusal ?? null,
      failed: r2.screen?.failed,
    },
    crops_withheld: r2.cropsWithheld,
    net_kg: {
      a: `${net?.a.value_text} ${net?.a.legibility}`,
      b: `${net?.b.value_text} ${net?.b.legibility}`,
      zoom: net?.zoom ? `${net.zoom.value_text} ${net.zoom.legibility}` : null,
      zoom_error: net?.zoomError ?? null,
      zoom_box_ok: net?.boxOk.zoom ?? null,
      outcome: net?.outcome,
    },
    holds: r2.holds,
  };
  // smoke-3: a margin note addressed to an AI on slip 0903. The screen should fire, both reads
  // located the note, so the remaining strings are re-screened text only.
  const r3 = await extract(smokeInput("smoke-3-two-slips-note"), deps);
  await recordExtract("smoke-3-two-slips-note", r3);
  results["smoke-3-two-slips-note"] = {
    screen: {
      suspected: r3.screen?.suspected ?? null,
      refusal: r3.screen?.refusal ?? null,
      failed: r3.screen?.failed,
    },
    rescreen: r3.rescreen
      ? { suspected: r3.rescreen.suspected, refusal: r3.rescreen.refusal, failed: r3.rescreen.failed }
      : null,
    crops_withheld: r3.cropsWithheld,
    quarantined: r3.quarantined,
    holds: r3.holds,
  };

  // AI-5 on the stub page; the checks run on the text layer.
  try {
    const card = await readRateCard(ratecardStubInput(), deps);
    await record("AI-5 rate card", RATECARD_STUB_ID, card.result);
    results[RATECARD_STUB_ID] = {
      resolution_no: card.draft.resolution_no,
      ratified_on_as_written: card.draft.ratified_on_as_written,
      ok: card.draft.ok,
      terms: card.draft.terms.map((t) => ({
        rule_id: t.rule_id,
        kind: t.kind,
        pool: t.pool,
        basis: t.basis,
        value: t.value,
        cap: t.cap,
        checks: t.checks.map((c) => c.code),
      })),
      amendments: card.draft.amendments.map((a) => a.verbatim),
      quarantined: card.draft.quarantined.map((a) => a.verbatim),
      signatories: card.draft.signatories,
    };
  } catch (err) {
    if (isGatewayError(err) && err.details.result)
      await record("AI-5 rate card", RATECARD_STUB_ID, err.details.result);
    results[RATECARD_STUB_ID] = { error: err instanceof Error ? err.message : String(err) };
  }

  // AI-6 on two agreed lines from the smoke slips (smoke-1 replays its reads only: no new calls).
  const r1 = await extract(smokeInput("smoke-1-clean", { zoom: false, screen: false }), deps);
  const multa = r2.rows[0]?.deductions[0]?.text ?? "";
  const hauling = r1.rows[0]?.deductions[0]?.text ?? "";
  const classified: Array<
    Pick<ClassifyOutcome, "status" | "ruleId" | "writtenMinor" | "amount" | "hold"> & { line: string }
  > = [];
  for (const input of classifyInputs({ multa, hauling })) {
    const out = await classifyDeduction(input, deps);
    if (out.result) await record("AI-6 classify", `${input.docId}: ${input.line}`, out.result);
    classified.push({
      line: input.line,
      status: out.status,
      ruleId: out.ruleId,
      writtenMinor: out.writtenMinor,
      amount: out.amount,
      hold: out.hold,
    });
  }
  results.classify = classified;

  const fresh = calls.filter((c) => c.recorded_at >= COMPONENTS_SINCE);
  const report = JSON.parse(readFileSync(`${SMOKE_DIR}report.json`, "utf8")) as Record<string, unknown>;
  report.components = {
    note: "One live call per component the read smoke run left out; reads A and B replay. SMOKE ONLY (C-24).",
    generated_at: new Date().toISOString(),
    calls,
    /** What the component calls cost when they were recorded live (the reads were paid for earlier). */
    components_cost_usd: Number(fresh.reduce((s, c) => s + c.cost_usd, 0).toFixed(6)),
    this_run_cost_usd: Number(
      calls
        .filter((c) => c.this_run === "live")
        .reduce((s, c) => s + c.cost_usd, 0)
        .toFixed(6),
    ),
    results,
  };
  writeFileSync(`${SMOKE_DIR}report.json`, `${JSON.stringify(report, null, 2)}\n`);
  for (const c of calls) {
    console.log(
      `${c.component.padEnd(15)} ${c.subject.slice(0, 40).padEnd(40)} ${c.recorded}/${c.this_run.padEnd(6)} ${c.model_served} stop=${c.stop_reason} ${c.latency_ms}ms in=${c.input_tokens} out=${c.output_tokens} think=${c.thinking_tokens} $${c.cost_usd.toFixed(4)}`,
    );
  }
  const totals = report.components as { components_cost_usd: number; this_run_cost_usd: number };
  console.log(
    `components cost US$${totals.components_cost_usd.toFixed(4)}; this run US$${totals.this_run_cost_usd.toFixed(4)}`,
  );
  console.log(JSON.stringify(results, null, 2));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
