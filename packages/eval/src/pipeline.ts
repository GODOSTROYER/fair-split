import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isGatewayError } from "@fairsplit/ai/gateway";
import { readRateCard, type TextLayer } from "@fairsplit/ai/ratecard";
import {
  extract,
  type PhotoFixture,
  type ReadDeps,
  type RegistryMember,
  type ValidationContext,
} from "@fairsplit/ai/read";
import type { CaseLabel } from "./labels.js";
import type { CaseRun } from "./score.js";

/**
 * The member registry the validators check against. Until WS-CORE's seed snapshot lands, it is built
 * from the labelled slips themselves (member number → visible name).
 */
export function registryFromLabels(cases: readonly CaseLabel[]): Map<string, RegistryMember> {
  const reg = new Map<string, RegistryMember>();
  for (const c of cases) {
    for (const s of c.slips) {
      const no = s.fields.member_no?.visible;
      const name = s.fields.member_name?.visible;
      if (no && name && !reg.has(no)) reg.set(no, { memberNo: no, name });
    }
  }
  return reg;
}

export interface PipelineOptions {
  mediaRoot: string;
  deps: ReadDeps;
  validation: ValidationContext;
  /** AI-3 zoom and AI-4 screen run unless the case set was recorded without them. */
  zoom?: boolean;
  screen?: boolean;
}

/** Runs one labelled case through the production pipeline (extract or readRateCard). */
export async function runCase(label: CaseLabel, opts: PipelineOptions): Promise<CaseRun> {
  const path = (p: string) => join(opts.mediaRoot, p);
  try {
    if (label.kind === "rate_card_page") {
      const rc = label.rate_card;
      if (!rc) throw new Error("rate_card_page label without rate_card");
      const textLayer = JSON.parse(readFileSync(path(rc.text_layer), "utf8")) as TextLayer;
      const pages = (rc.pages.length > 0 ? rc.pages : [label.image]).map((p) => readFileSync(path(p)));
      const result = await readRateCard({ documentId: label.case, pages, textLayer }, opts.deps);
      return { label, kind: "rate_card", result, error: null };
    }
    const fixture = label.fixture
      ? (JSON.parse(readFileSync(path(label.fixture), "utf8")) as PhotoFixture)
      : undefined;
    const result = await extract(
      {
        docId: label.case,
        kind: label.kind,
        bytes: readFileSync(path(label.image)),
        fixture,
        validation: opts.validation,
        zoom: opts.zoom,
        screen: opts.screen,
      },
      opts.deps,
    );
    return { label, kind: "slips", result, error: null };
  } catch (err) {
    // A missing recording in replay mode is a configuration error the run must fail on, loudly.
    const message = isGatewayError(err, "AI_LIVE_DISABLED")
      ? `missing recording (${err.details.cacheKey ?? "?"}): run --mode live first`
      : err instanceof Error
        ? err.message
        : String(err);
    return label.kind === "rate_card_page"
      ? { label, kind: "rate_card", result: null, error: message }
      : { label, kind: "slips", result: null, error: message };
  }
}

/** Runs cases with bounded concurrency (the gateway also caps in-flight calls at 6). */
export async function runCases(
  cases: readonly CaseLabel[],
  opts: PipelineOptions,
  concurrency = 3,
): Promise<CaseRun[]> {
  const out: CaseRun[] = new Array(cases.length);
  let next = 0;
  const worker = async () => {
    while (next < cases.length) {
      const i = next++;
      out[i] = await runCase(cases[i] as CaseLabel, opts);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker));
  return out;
}
