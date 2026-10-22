// run.ts: `--mode replay|live|batch --set test|dev` (S4.8). Replay is the default: deterministic,
// no secrets, and any missing recording fails the run. Live is opt-in, capped (US$3 by default) and
// writes the recordings replay runs need.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClaudeGateway,
  envFlagSource,
  FsReplayStore,
  JsonlCallLedger,
  loadEnv,
  MemorySpendMeter,
  staticFlags,
} from "@fairsplit/ai/gateway";
import type { ReadDeps } from "@fairsplit/ai/read";
import { loadCases, repoRoot } from "./cases.js";
import { registryFromLabels, runCases } from "./pipeline.js";
import { type EvalReport, versions, writeReport } from "./report.js";
import { BARS, barsMet, score } from "./score.js";

const PKG = fileURLToPath(new URL("../", import.meta.url));

export interface EvalOptions {
  mode: "replay" | "live" | "batch";
  set: "test" | "dev";
  capUsd: number;
  mediaRoot: string;
  labelsDir?: string;
  recordingsDir: string;
  outDir: string;
  allowEmpty: boolean;
  zoom: boolean;
  screen: boolean;
  history: boolean;
  /** Injected for tests; defaults per mode. */
  gateway?: ClaudeGateway;
  now?: () => Date;
}

export function defaultOptions(over: Partial<EvalOptions> = {}): EvalOptions {
  const root = repoRoot(PKG);
  return {
    mode: "replay",
    set: "test",
    capUsd: 3,
    mediaRoot: join(root, "media"),
    recordingsDir: join(PKG, "recordings"),
    outDir: join(PKG, "report"),
    allowEmpty: false,
    zoom: true,
    screen: true,
    history: false,
    ...over,
  };
}

export function parseArgs(argv: readonly string[]): Partial<EvalOptions> {
  const out: Partial<EvalOptions> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === "--mode") {
      const m = val();
      if (m !== "replay" && m !== "live" && m !== "batch")
        throw new Error(`--mode must be replay | live | batch, got ${m}`);
      out.mode = m;
    } else if (a === "--set") {
      const s = val();
      if (s !== "test" && s !== "dev") throw new Error(`--set must be test | dev, got ${s}`);
      out.set = s;
    } else if (a === "--cap-usd") {
      const n = Number(val());
      if (!(n > 0 && n <= 10)) throw new Error("--cap-usd must be in (0, 10]");
      out.capUsd = n;
    } else if (a === "--media") out.mediaRoot = val();
    else if (a === "--labels") out.labelsDir = val();
    else if (a === "--recordings") out.recordingsDir = val();
    else if (a === "--out") out.outDir = val();
    else if (a === "--allow-empty") out.allowEmpty = true;
    else if (a === "--no-zoom") out.zoom = false;
    else if (a === "--no-screen") out.screen = false;
    else if (a === "--history") out.history = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return out;
}

function gatewayFor(o: EvalOptions): { gateway: ClaudeGateway; deps: Omit<ReadDeps, "gateway"> } {
  const now = (o.now ?? (() => new Date()))();
  const store = new FsReplayStore(o.recordingsDir);
  if (o.mode === "replay") {
    return {
      gateway:
        o.gateway ??
        new ClaudeGateway({
          store,
          flags: staticFlags({ kill_ai_live: true }),
          spend: new MemorySpendMeter(),
        }),
      deps: { mode: "replay_only", budget: "eval", budgetScope: `replay-${now.toISOString()}` },
    };
  }
  return {
    gateway:
      o.gateway ??
      new ClaudeGateway({
        store,
        flags: envFlagSource(),
        spend: new MemorySpendMeter(),
        caps: { eval: o.capUsd },
        ledger: new JsonlCallLedger(join(PKG, ".cache", "eval-ledger.jsonl")),
      }),
    deps: { mode: "auto", budget: "eval", budgetScope: `live-${now.toISOString()}` },
  };
}

export interface EvalOutcome {
  report: EvalReport;
  exitCode: number;
  paths: { latest: string; history: string | null } | null;
}

export async function runEval(o: EvalOptions): Promise<EvalOutcome> {
  if (o.mode === "batch") throw new Error("--mode batch (Message Batches) is not built yet; use --mode live");
  const loaded = loadCases({ mediaRoot: o.mediaRoot, labelsDir: o.labelsDir, set: o.set });
  const { gateway, deps } = gatewayFor(o);
  const runs = await runCases(loaded.cases, {
    mediaRoot: o.mediaRoot,
    deps: { gateway, ...deps },
    validation: { registry: registryFromLabels(loaded.cases) },
    zoom: o.zoom,
    screen: o.screen,
  });
  const scored = score(runs);
  const bars = barsMet(scored.metrics);
  const failures = [...bars.failures, ...loaded.invalid.map((x) => `invalid label ${x.file}`)];
  const report: EvalReport = {
    v: 1,
    generated_at: (o.now ?? (() => new Date()))().toISOString(),
    mode: o.mode,
    set: o.set,
    case_count: scored.cells.length,
    case_note: `${scored.cells.length} synthetic cases, generated with Codex`,
    cases: scored.cells,
    metrics: scored.metrics,
    baseline: {
      name: "ppu-paddle-ocr 6.6.1 (V5_EN_SERVER_MODEL)",
      status: "not_run",
      reason: "the OCR-only baseline lands with the labelled test set (S4.11: 30–31 Oct)",
    },
    bars: BARS,
    green: bars.green && loaded.invalid.length === 0,
    failures,
    versions: versions(),
    invalid_labels: loaded.invalid,
  };
  const empty = loaded.cases.length === 0;
  const paths = writeReport(o.outDir, report, o.history || o.mode === "live");
  const exitCode = report.green ? 0 : empty && o.allowEmpty ? 0 : 1;
  return { report, exitCode, paths };
}

async function main(): Promise<void> {
  const opts = defaultOptions(parseArgs(process.argv.slice(2)));
  if (opts.mode === "live") {
    const env = loadEnv(process.cwd(), ["ANTHROPIC_API_KEY"]);
    if (!env.present.ANTHROPIC_API_KEY) throw new Error("live mode needs ANTHROPIC_API_KEY (in .env)");
  }
  const out = await runEval(opts);
  const m = out.report.metrics;
  console.log(
    `eval ${out.report.mode}/${out.report.set}: ${out.report.case_note}; exact-row ${m.exactRowRate ?? "n/a"}, unsafe ${m.unsafeAutoAccepts}, injection ${m.injectionCatchRate ?? "n/a"}, dup F1 ${m.duplicateF1 ?? "n/a"}, recorded cost US$${m.reported.recordedCostUsd.toFixed(4)}`,
  );
  console.log(out.report.green ? "GREEN" : `NOT GREEN: ${out.report.failures.join("; ")}`);
  if (out.paths)
    console.log(`wrote ${out.paths.latest}${out.paths.history ? ` and ${out.paths.history}` : ""}`);
  process.exitCode = out.exitCode;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 2;
  });
}
