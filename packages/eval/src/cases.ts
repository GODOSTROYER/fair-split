import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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
