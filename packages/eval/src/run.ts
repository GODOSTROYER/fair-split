// run.ts: `--mode replay|live|batch --set test|dev` (S4.8). Replay is the default: deterministic,
// no secrets, and any missing recording fails the run. Live is opt-in, capped (US$3 by default) and
// writes the recordings replay runs need.
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
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
import { loadCases, preflightCases, repoRoot, unscoredCase } from "./cases.js";
import { loadRegistry, registryFromLabels, runCases } from "./pipeline.js";
import { type EvalReport, versions, writeReport } from "./report.js";
import { BARS, barsMet, type CaseRun, score } from "./score.js";

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
  unscoredImages: string[];
  /**
   * The member registry the validators check against: the seed snapshot's members (`--registry`).
   * Without it the registry is built from the labels and the report is marked provisional.
   */
  registryPath?: string;
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
    unscoredImages: [],
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
    else if (a === "--registry") out.registryPath = val();
    else if (a === "--unscored") {
      out.unscoredImages ??= [];
      out.unscoredImages.push(val());
    } else throw new Error(`unknown argument ${a}`);
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
      deps: { mode: "replay_only", lane: "eval", laneScope: `replay-${now.toISOString()}` },
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
    deps: { mode: "auto", lane: "eval", laneScope: `live-${now.toISOString()}` },
  };
}

/** A path as the report prints it: relative to the repo with forward slashes, never a local absolute path. */
function displayPath(p: string): string {
  let root: string | null;
  try {
    root = repoRoot(PKG);
  } catch {
    root = null;
  }
  const rel = root ? relative(root, resolve(p)) : "";
  const inside = rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  return inside ? rel.split(sep).join("/") : basename(p);
}

export interface EvalOutcome {
  report: EvalReport;
  runs: CaseRun[];
  exhibits: CaseRun[];
  exitCode: number;
  paths: { latest: string; history: string | null } | null;
}

export async function runEval(o: EvalOptions): Promise<EvalOutcome> {
  if (o.mode === "batch") throw new Error("--mode batch (Message Batches) is not built yet; use --mode live");
  const loaded = loadCases({ mediaRoot: o.mediaRoot, labelsDir: o.labelsDir, set: o.set });
  const exhibitLabels = o.unscoredImages.map((image) => unscoredCase(o.mediaRoot, image));
  await preflightCases(loaded, exhibitLabels);
  const { gateway, deps } = gatewayFor(o);
  const registry = o.registryPath ? loadRegistry(o.registryPath) : registryFromLabels(loaded.cases);
  const allRuns = await runCases([...loaded.cases, ...exhibitLabels], {
    mediaRoot: o.mediaRoot,
    deps: { gateway, ...deps },
    validation: { registry },
    zoom: o.zoom,
    screen: o.screen,
  });
  const runs = allRuns.slice(0, loaded.cases.length);
  const exhibits = allRuns.slice(loaded.cases.length);
  const scored = score(runs);
  const bars = barsMet(scored.metrics);
  const exhibitFailures = exhibits
    .filter((x) => x.error)
    .map((x) => `unscored exhibit ${x.label.case}: ${x.error}`);
  const failures = [
    ...bars.failures,
    ...loaded.invalid.map((x) => `invalid label ${x.file}`),
    ...exhibitFailures,
  ];
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
      reason: "PP-OCRv5 was not run; no OCR-only comparison is claimed",
    },
    bars: BARS,
    green: bars.green && loaded.invalid.length === 0 && exhibitFailures.length === 0,
    failures,
    versions: versions(),
    invalid_labels: loaded.invalid,
    unscored_exhibits: exhibits.map((x) => ({ image: x.label.image, status: "not scored", error: x.error })),
    registry: {
      source: o.registryPath ? "file" : "labels",
      members: registry.size,
      path: o.registryPath ? displayPath(o.registryPath) : null,
    },
    provisional: o.registryPath
      ? null
      : `Member registry built from the labelled slips (${registry.size} members), not the seed's: "not in the registry" is stricter than production, so unsafe auto-accepts may be under-counted. Pass --registry with the seed snapshot's members.`,
  };
  const empty = loaded.cases.length === 0;
  const paths = writeReport(o.outDir, report, o.history || o.mode === "live");
  const exitCode = report.green ? 0 : empty && o.allowEmpty ? 0 : 1;
  return { report, runs, exhibits, exitCode, paths };
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
  if (out.report.provisional) console.log(`PROVISIONAL: ${out.report.provisional}`);
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
