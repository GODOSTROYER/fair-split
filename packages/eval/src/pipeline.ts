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
import { z } from "zod";
import type { CaseLabel } from "./labels.js";
import type { CaseRun } from "./score.js";

/**
 * A member registry built from the labelled slips themselves (member number → visible name). It only
 * stands in until WS-CORE's seed snapshot lands: a registry limited to the test set's members makes
 * "not in the registry" stricter than production (a misread number that names another of the 64
 * members would be auto-accepted there), which flatters the unsafe-auto-accept metric, so a report
 * built on it is marked provisional.
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

const RegistryEntry = z
  .object({
    memberNo: z.string().optional(),
    member_no: z.string().optional(),
    name: z.string().trim().min(1),
  })
  .transform((m, ctx) => {
    const memberNo = m.memberNo ?? m.member_no ?? "";
    if (!/^M-\d{3}$/.test(memberNo)) {
      ctx.addIssue({ code: "custom", message: `member number "${memberNo}" is not M-###` });
      return z.NEVER;
    }
    return { memberNo, name: m.name };
  });
const RegistryFile = z.union([
  z.array(RegistryEntry),
  z.object({ members: z.array(RegistryEntry) }).transform((f) => f.members),
]);

/**
 * The production member registry from a file (`--registry`): the seed snapshot's members, as an array
 * of `{memberNo | member_no, name}` or an object with a `members` array. Empty, malformed or
 * duplicated entries fail the run rather than weaken validation.
 */
export function loadRegistry(path: string): Map<string, RegistryMember> {
  const parsed = RegistryFile.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new Error(`registry ${path}: ${parsed.error.message}`);
  if (parsed.data.length === 0) throw new Error(`registry ${path} lists no members`);
  const reg = new Map<string, RegistryMember>();
  for (const m of parsed.data) {
    if (reg.has(m.memberNo)) throw new Error(`registry ${path} lists ${m.memberNo} twice`);
    reg.set(m.memberNo, m);
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
