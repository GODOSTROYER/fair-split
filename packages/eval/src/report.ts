// TEMPORARY SHIM: replace with @fairsplit/contracts `EvalReport` after WS-CORE merges (S4.11
// contract ask: cases[40], metrics, baseline, bars, green, versions).
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLASSIFY_PROMPT_V } from "@fairsplit/ai/classify";
import { RATECARD_PROMPT_V, RATECARD_SCHEMA_V, ratecardPrompt } from "@fairsplit/ai/ratecard";
import { EXTRACTION_SCHEMA_V, PREP_V, prompt, SCREEN_SCHEMA_V, ZOOM_SCHEMA_V } from "@fairsplit/ai/read";
import type { BARS, Cell, Metrics } from "./score.js";

export interface EvalReport {
  v: 1;
  generated_at: string;
  mode: "replay" | "live" | "batch";
  set: "test" | "dev";
  /** "40 synthetic cases, generated with Codex": the waffle always states the count. */
  case_count: number;
  case_note: string;
  cases: Cell[];
  metrics: Metrics;
  baseline: { name: string; status: "not_run" | "ok"; reason?: string; metrics?: Partial<Metrics> };
  bars: typeof BARS;
  green: boolean;
  failures: string[];
  versions: {
    models: { read: string; zoom: string; screen: string; ratecard: string; classify: string };
    prompts: Record<string, string>;
    schemas: Record<string, string>;
    prep: string;
  };
  invalid_labels: Array<{ file: string; error: string }>;
  unscored_exhibits: Array<{ image: string; status: "not scored"; error: string | null }>;
  /** Where the validators' member registry came from: the seed snapshot (a file) or the labels. */
  registry: { source: "file" | "labels"; members: number; path: string | null };
  /** Why the numbers are not yet the production measure (null when they are). */
  provisional: string | null;
}

export function versions(): EvalReport["versions"] {
  const p = (n: "a.v1" | "b.v1" | "zoom.v2" | "screen.v1") => `${n}@${prompt(n).sha256.slice(0, 12)}`;
  return {
    models: {
      read: "claude-opus-5-5 (low)",
      zoom: "claude-opus-5-5 (medium)",
      screen: "claude-haiku-5-5 (low)",
      ratecard: "claude-opus-5-5 (medium)",
      classify: "claude-sonnet-5-5 (low)",
    },
    prompts: {
      readA: p("a.v1"),
      readB: p("b.v1"),
      zoom: p("zoom.v2"),
      screen: p("screen.v1"),
      ratecard: `${RATECARD_PROMPT_V}@${ratecardPrompt().sha256.slice(0, 12)}`,
      classify: CLASSIFY_PROMPT_V,
    },
    schemas: {
      extraction: EXTRACTION_SCHEMA_V,
      zoom: ZOOM_SCHEMA_V,
      screen: SCREEN_SCHEMA_V,
      ratecard: RATECARD_SCHEMA_V,
    },
    prep: PREP_V,
  };
}

/**
 * Writes `report/latest.json` (S4 register deviation 3: it lives in packages/eval) and, when asked,
 * a dated copy under `report/history/`.
 */
export function writeReport(
  dir: string,
  report: EvalReport,
  history: boolean,
): { latest: string; history: string | null } {
  mkdirSync(dir, { recursive: true });
  const latest = join(dir, "latest.json");
  const text = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(latest, text);
  if (!history) return { latest, history: null };
  const hdir = join(dir, "history");
  mkdirSync(hdir, { recursive: true });
  const file = join(hdir, `${report.generated_at.replace(/[:.]/g, "-")}-${report.mode}-${report.set}.json`);
  writeFileSync(file, text);
  return { latest, history: file };
}
