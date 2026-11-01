import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import sharp from "sharp";
import { z } from "zod";
import { CaseLabel } from "./labels.js";

/** The repo root: the nearest ancestor holding pnpm-workspace.yaml. */
export function repoRoot(from: string = process.cwd()): string {
  let dir = resolve(from);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error("repo root not found (no pnpm-workspace.yaml above)");
    dir = parent;
  }
}

export interface LoadedCases {
  mediaRoot: string;
  labelsDir: string;
  cases: CaseLabel[];
  /** Label files that failed the schema: they fail the run rather than being skipped silently. */
  invalid: Array<{ file: string; error: string }>;
}

/** `cases.ts`: loads `media/eval/labels/*.json` (S4.8), filtered to one set. */
export function loadCases(opts: { mediaRoot: string; labelsDir?: string; set: "test" | "dev" }): LoadedCases {
  const labelsDir = opts.labelsDir ?? join(opts.mediaRoot, "eval", "labels");
  const cases: CaseLabel[] = [];
  const invalid: LoadedCases["invalid"] = [];
  if (!existsSync(labelsDir)) return { mediaRoot: opts.mediaRoot, labelsDir, cases, invalid };
  for (const file of readdirSync(labelsDir)
    .filter((f) => f.endsWith(".json"))
    .sort()) {
    try {
      const parsed = CaseLabel.safeParse(JSON.parse(readFileSync(join(labelsDir, file), "utf8")));
      if (!parsed.success) invalid.push({ file, error: parsed.error.message });
      else if (parsed.data.set === opts.set) cases.push(parsed.data);
    } catch (err) {
      invalid.push({ file, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { mediaRoot: opts.mediaRoot, labelsDir, cases, invalid };
}

/** An exhibit has no truth labels and must never enter a metric denominator. */
export function unscoredCase(mediaRoot: string, image: string): CaseLabel {
  const id = basename(image).replace(/\.[^.]+$/, "");
  const fixture = `fixtures/${id}.json`;
  return CaseLabel.parse({
    case: id,
    set: "dev",
    kind: "slip_photo",
    image,
    fixture: existsSync(join(mediaRoot, fixture)) ? fixture : null,
    slips: [],
    reviewer: "Unscored exhibit, no label",
    reviewed_at: "not reviewed",
  });
}

const rect = z
  .object({
    x1: z.number().min(0).max(1),
    y1: z.number().min(0).max(1),
    x2: z.number().min(0).max(1),
    y2: z.number().min(0).max(1),
  })
  .refine((r) => r.x2 > r.x1 && r.y2 > r.y1, "empty fixture rectangle");
const fixtureSchema = z.object({
  photo: z.string().optional(),
  id: z.string().optional(),
  slips: z.array(
    z.object({
      rect,
      fields: z.record(z.string(), rect),
      deductions: z.array(rect).optional(),
    }),
  ),
});

/** Validate the entire set before the first call can reserve spend. No partial billable set. */
export async function preflightCases(
  loaded: LoadedCases,
  exhibits: readonly CaseLabel[] = [],
): Promise<void> {
  if (loaded.invalid.length)
    throw new Error(`preflight: invalid label ${loaded.invalid.map((x) => x.file).join(", ")}`);
  for (const label of [...loaded.cases, ...exhibits]) {
    try {
      const paths = label.rate_card?.pages.length ? label.rate_card.pages : [label.image];
      for (const path of paths) await sharp(readFileSync(join(loaded.mediaRoot, path))).metadata();
      if (label.fixture)
        fixtureSchema.parse(JSON.parse(readFileSync(join(loaded.mediaRoot, label.fixture), "utf8")));
      if (label.rate_card)
        JSON.parse(readFileSync(join(loaded.mediaRoot, label.rate_card.text_layer), "utf8"));
    } catch {
      throw new Error(`preflight: missing or invalid image, fixture or text layer for ${label.case}`);
    }
  }
}
