// R1 is an offline exhibit generator. This entry point cannot perform a live read.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ClaudeGateway,
  FsReplayStore,
  type LlmCallRow,
  MemorySpendMeter,
  type Recording,
  sha256Hex,
  staticFlags,
} from "@fairsplit/ai/gateway";
import type { ExtractResult } from "@fairsplit/ai/read";
import { ablateSingleReadA } from "./ablation.js";
import { loadCases, repoRoot } from "./cases.js";
import { registryFromLabels } from "./pipeline.js";
import { defaultOptions, runEval } from "./run.js";
import { type CaseRun, score } from "./score.js";

const PKG = fileURLToPath(new URL("../", import.meta.url));
const ROOT = repoRoot(PKG);
export interface LivePass {
  pass: number;
  lane_scope: string;
  recorded_cost_usd: number;
  calls: LlmCallRow[];
}

function reading(run: CaseRun) {
  const result: ExtractResult | null = run.kind === "slips" ? run.result : null;
  return {
    id: run.label.case,
    image: run.label.image,
    image_sha256: sha256Hex(readFileSync(join(ROOT, "media", run.label.image))),
    fixture_sha256: run.label.fixture
      ? sha256Hex(readFileSync(join(ROOT, "media", run.label.fixture)))
      : null,
    error: run.error,
    call_keys: result?.calls.map((c) => c.cacheKey).sort() ?? [],
    rows:
      result?.rows.map((r) => ({
        row: r.row,
        serial: r.serial,
        copy: r.copy,
        state: r.state,
        fields: r.fields,
        deductions: r.deductions,
      })) ?? [],
    holds: result?.holds ?? [],
    quarantined: result?.quarantined ?? [],
    crops_withheld: result?.cropsWithheld ?? null,
    screen_suspected: result?.screen?.suspected ?? null,
  };
}

export async function reproduceR1(opts: { gateway?: ClaudeGateway } = {}) {
  const labelsDir = join(PKG, "report", "r1-labels");
  const mediaRoot = join(ROOT, "media");
  const recordingsDir = join(PKG, "recordings");
  const records = readdirSync(recordingsDir)
    .filter((f) => /^[a-f0-9]{64}\.json$/.test(f))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(recordingsDir, f), "utf8")) as Recording);
  if (!records.length) throw new Error("R1 has no recordings");
  const recordedDates = [...new Set(records.map((r) => r.recorded_at))].sort();
  const generatedAt = new Date(
    Math.max(...records.map((r) => Date.parse(r.recorded_at) + r.latency_ms)),
  ).toISOString();
  const gateway =
    opts.gateway ??
    new ClaudeGateway({
      store: new FsReplayStore(recordingsDir),
      flags: staticFlags({ kill_ai_live: true }),
      spend: new MemorySpendMeter(),
    });
  const loaded = loadCases({ mediaRoot, labelsDir, set: "dev" });
  const out = await runEval(
    defaultOptions({
      mode: "replay",
      set: "dev",
      labelsDir,
      mediaRoot,
      recordingsDir,
      unscoredImages: ["masters/spike-4up.jpg"],
      gateway,
      now: () => new Date(generatedAt),
      outDir: join(ROOT, ".codex-scratch", "r1-replay"),
    }),
  );
  const ablation = await ablateSingleReadA(loaded.cases, {
    mediaRoot,
    gateway,
    validation: { registry: registryFromLabels(loaded.cases) },
  });
  const scored = score(out.runs);
  const passes = JSON.parse(readFileSync(join(PKG, "report", "R1-ledger.json"), "utf8")) as LivePass[];
  const spendMicros = passes.flatMap((p) => p.calls).reduce((n, c) => n + c.cost_micros, 0);
  if (passes.length > 2 || spendMicros > 10_000_000) throw new Error("R1 live ceiling exceeded");
  for (const p of passes) {
    if (Math.abs(p.recorded_cost_usd - p.calls.reduce((n, c) => n + c.cost_micros, 0) / 1e6) > 1e-9)
      throw new Error("R1 pass cost differs from gateway ledger");
  }
  const incurred = [...out.runs, ...out.exhibits].reduce(
    (n, r) => n + (r.result && r.kind === "slips" ? r.result.costMicros : 0),
    0,
  );
  if (incurred || ablation.incurredCostUsd) throw new Error("R1 reproduction incurred live spend");
  return {
    v: 1,
    reading_started_at: recordedDates[0] as string,
    reading_finished_at: generatedAt,
    label_provenance: "provisional: agent-checked labels, not reviewed by a person",
    image_provenance: "Synthetic Codex-made hero flats; no real farmer documents",
    sample: {
      scored_images: loaded.cases.length,
      scored_slips: scored.slips.length,
      unscored_images: out.exhibits.length,
    },
    labels: readdirSync(labelsDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((file) => ({
        file,
        sha256: sha256Hex(readFileSync(join(labelsDir, file))),
        source: `media/eval/provisional/${file}`,
      })),
    models_served: [...new Set(records.map((r) => r.model_served))].sort(),
    recordings: records.map((r) => ({
      cache_key: r.cache_key,
      purpose: r.purpose,
      variant: r.variant,
      model_served: r.model_served,
      recorded_at: r.recorded_at,
      cost_micros: r.cost_micros,
      stop_reason: r.stop_reason,
      provenance: r.provenance ?? "live",
      input_sha: r.input_sha,
      prompt_sha: r.prompt_sha ?? null,
    })),
    cost: {
      live_spend_usd: spendMicros / 1e6,
      recording_cost_usd: records.reduce((n, r) => n + r.cost_micros, 0) / 1e6,
      replay_incurred_usd: incurred / 1e6,
      live_passes: passes.map((p) => ({
        pass: p.pass,
        lane_scope: p.lane_scope,
        calls: p.calls.length,
        recorded_cost_usd: p.recorded_cost_usd,
      })),
      basis: "Gateway ledger token-cost estimates at the repository rate card; account invoice not queried",
    },
    registry: out.report.registry,
    registry_caveat: out.report.provisional,
    double_read: scored.metrics,
    single_read_a: ablation,
    comparison_note:
      scored.metrics.exactRowRate === ablation.exactRowRate &&
      scored.metrics.unsafeAutoAccepts === ablation.unsafeAutoAccepts
        ? "A-only and double read tie on exact rows and unsafe auto-accepts in this provisional sample; no measured benefit from the second read is demonstrated."
        : "This comparison measures only this small provisional sample; no population-level improvement is claimed.",
    cells: scored.cells,
    green: out.report.green,
    failures: out.report.failures,
    cases: out.runs.map((r) => ({
      ...reading(r),
      scores: scored.slips.filter((s) => s.case === r.label.case),
    })),
    unscored: out.exhibits.map((r) => ({ ...reading(r), status: "not scored" as const })),
    not_measured: [
      "No PP-OCRv5 baseline; no 40-case set; no held-out test set or real handwriting corpus",
      "No logbook, rate-card, deduction classification, NO_MATCH recall, yield or payroll computation evaluated",
      "Injection score is extraction-only: quarantine + exact row + no leaked deduction; recomputed money was not measured",
      "Only one injection example and one labelled duplicate pair; no population-level safety claim",
      "Exact-row/field metrics cover scored fields only; signatures, clerk initials, copy colour and unexpected extra rows are not independently scored",
      "No human completed a review or approved payroll in this evaluation",
      "Judge Mode still replays a labelled seed stand-in; these readings do not replace its seed",
      "No Claude invoice drafting: the audit agent remains paused",
      "PayPal was not called; the product rail is Simulated PayPal sandbox",
    ],
  };
}

export type R1Evidence = Awaited<ReturnType<typeof reproduceR1>>;

/** Use the already installed, catalog-pinned repository formatter; no downloaded tool. */
export function serializeR1(evidence: R1Evidence): string {
  return execFileSync(
    process.execPath,
    [
      join(ROOT, "node_modules", "@biomejs", "biome", "bin", "biome"),
      "format",
      "--stdin-file-path=packages/eval/report/R1.json",
    ],
    { cwd: ROOT, encoding: "utf8", input: JSON.stringify(evidence, null, 2), maxBuffer: 8 * 1024 * 1024 },
  );
}
const cell = (v: unknown) =>
  String(v ?? "n/a")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const pct = (v: number | null) => (v === null ? "not measured" : `${(100 * v).toFixed(2)}%`);

/** Keep generated tables aligned and whitespace stable under the repository Markdown formatter. */
function formatReportMarkdown(lines: string[]): string {
  const out = lines.map((line) => line.trimEnd());
  for (let i = 0; i < out.length; i++) {
    if (!out[i]?.startsWith("|")) continue;
    let end = i;
    while (out[end]?.startsWith("|")) end++;
    const table = out.slice(i, end).map((line) =>
      line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map((c) => c.trim()),
    );
    const widths = (table[0] ?? []).map((_, column) =>
      Math.max(3, ...table.filter((_, row) => row !== 1).map((row) => row[column]?.length ?? 0)),
    );
    table.forEach((row, index) => {
      out[i + index] =
        `| ${row.map((value, col) => (index === 1 ? "-".repeat(widths[col] ?? 3) : value.padEnd(widths[col] ?? 3))).join(" | ")} |`;
    });
    i = end - 1;
  }
  return out
    .filter((line, i) => !(line === "" && out[i + 1]?.startsWith("- ") && !out[i - 1]?.startsWith("#")))
    .join("\n");
}

export function renderR1(e: R1Evidence): string {
  const a = e.single_read_a;
  const d = e.double_read;
  const lines = [
    "# R1: Claude's real reading of the hero slips",
    "",
    `Recorded ${e.reading_started_at} to ${e.reading_finished_at} (UTC). Models served: ${e.models_served.join(", ")}.`,
    "",
    `${e.label_provenance}. ${e.image_provenance}.`,
    "",
    `N = ${e.sample.scored_images} scored images / ${e.sample.scored_slips} scored slips. spike-4up is an additional unscored exhibit, not an independent scored sample. The optional logbook was excluded. Frozen labels are in r1-labels/.`,
    "",
    `Total live spend: US$${e.cost.live_spend_usd.toFixed(6)} (${e.cost.live_passes.length} live pass(es), ${e.recordings.length} recordings). Replay and A-only ablation incur US$0. ${e.cost.basis}.`,
    "",
    ...e.cost.live_passes.map(
      (p) =>
        `- Pass ${p.pass}: ${p.calls} ledger calls, US$${p.recorded_cost_usd.toFixed(6)}, scope ${p.lane_scope}.`,
    ),
    "",
    "| Metric | Double read + screen + zoom | A-only baseline |",
    "| --- | --- | --- |",
    `| Exact rows (HUMAN fields must defer) | ${d.reported.exactRows}/${d.reported.rows} (${pct(d.exactRowRate)}) | ${a.exactRows}/${a.rows} (${pct(a.exactRowRate)}) |`,
    `| Unsafe auto-accepts (fields) | ${d.unsafeAutoAccepts} | ${a.unsafeAutoAccepts} |`,
    `| Normalized field accuracy | ${pct(d.reported.fieldAccuracy)} | ${pct(a.fieldAccuracy)} |`,
    `| Injection catch (extraction only) | ${pct(d.injectionCatchRate)} | not measured: no screen/quarantine pipeline |`,
    `| Duplicate F1 | ${d.duplicateF1 ?? "not measured"} | not measured: no duplicate pipeline |`,
    `| Case errors | ${d.reported.errors} | ${a.errors} |`,
    "",
    `Duplicate details: ${JSON.stringify(d.reported.duplicates)}. Screen false positives: ${d.reported.screenFalsePositives}. Prompt drift: ${d.reported.promptDrift}.`,
    "",
    e.comparison_note,
    "",
    "The scored cases' recorded cost is US$" +
      d.reported.recordedCostUsd.toFixed(6) +
      "; the ledger total above also includes the unscored four-up. The 0462 label says HUMAN for gross and net; both methods defer those fields. No normalized scored-field mismatch was observed against these provisional labels. This is not a person-reviewed accuracy claim.",
    "",
    "A-only is replay of variant A, with the same normalizers and validators, auto-accepting CLEAR, valid fields (S4.8). It does not fabricate an independent B read and runs no screen or zoom. Raw transcription accuracy and per-field decisions are also in R1.json.",
    "",
    `Registry caveat: ${e.registry_caveat}`,
    "",
    `Configured eval bars: ${e.green ? "met on this provisional sample only" : "NOT MET"}. ${e.failures.join("; ")}`,
    "",
    "The following tables describe proposed review routing. No person actually completed these reviews during R1. A correct transcription can still require review because a bounding box, validator, agreement, or quarantine gate failed.",
    "",
  ];
  for (const c of e.cases) {
    lines.push(`## ${c.id}`, "", `Image: ${c.image}. Record keys: ${c.call_keys.join(", ")}.`, "");
    if (c.error) lines.push(`Error: ${c.error}`, "");
    for (const s of c.scores) {
      lines.push(
        `Row ${s.row ?? "missing"}; exact: ${s.exact}; requires a person: ${s.needsHuman}; quarantined: ${s.quarantined}.`,
        "",
        "| Field | Provisional visible label | Best reading | Correct | Auto-accepted | Score |",
        "| --- | --- | --- | --- | --- | --- |",
        ...s.fields.map(
          (f) =>
            `| ${cell(f.field)} | ${cell(f.visible)} (${f.expect}) | ${cell(f.best)} | ${f.equal} | ${f.autoAccepted} | ${cell(f.score)} |`,
        ),
        "",
      );
    }
    const fields = c.rows.flatMap((r) => [
      ...Object.entries(r.fields)
        .filter(([, f]) => f?.outcome && f.outcome.score < 0.85)
        .map(([name, f]) => `${name}: ${f?.outcome?.state}, score ${f?.outcome?.score}`),
      ...r.deductions
        .filter((f) => f.outcome && f.outcome.score < 0.85)
        .map((f) => `deduction ${f.index}: ${f.outcome?.state}, score ${f.outcome?.score}`),
    ]);
    lines.push(
      `Review reasons: ${fields.join("; ") || "no low-confidence field"}. ${c.holds.map((h) => `${h.kind}: ${h.reason}`).join("; ")}`,
      "",
    );
  }
  lines.push(
    "## spike-4up: not scored",
    "",
    "No provisional label was invented for this composite. Its transcriptions and proposed routing are recorded in R1.json; it contributes to live spend, not to accuracy, injection or duplicate denominators.",
    "",
  );
  for (const u of e.unscored) {
    for (const r of u.rows)
      lines.push(
        `- Row ${r.row}, serial ${r.serial}, ${r.copy}, ${r.state}: ${Object.entries(r.fields)
          .map(([k, f]) => `${k}=${cell(f?.a.value_text)}`)
          .join("; ")}`,
      );
    if (u.error) lines.push(`Error: ${u.error}`);
  }
  lines.push(
    "",
    "## Limits and integration copy",
    "",
    ...e.not_measured.map((n) => `- ${n}`),
    "",
    `Suggested C5d/README copy: "Claude's real reads of these ten synthetic hero slips were recorded on ${e.reading_started_at.slice(0, 10)}. Judge Mode replays a labelled seed stand-in. See R1.md for provisional results and limitations."`,
    "",
    "Reproduce JSON and this Markdown, offline from the repo root: `corepack pnpm --filter @fairsplit/eval exec tsx src/r1.ts`. The command always uses replay_only with kill_ai_live on. R1-ledger.json preserves the gateway ledger for every live pass.",
    "",
  );
  return formatReportMarkdown(lines);
}

async function main() {
  const evidence = await reproduceR1();
  const dir = join(PKG, "report");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "R1.json"), serializeR1(evidence));
  writeFileSync(join(dir, "R1.md"), renderR1(evidence));
  console.log(
    `R1 replay: ${evidence.sample.scored_slips} scored slips, live spend US$${evidence.cost.live_spend_usd.toFixed(6)}, incurred US$0`,
  );
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(() => {
    console.error("R1 replay failed; inspect the local recordings and ledger");
    process.exitCode = 1;
  });
}
