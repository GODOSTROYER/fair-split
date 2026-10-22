import { existsSync } from "node:fs";
import { mkdir, readFile, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { AssetSpec } from "../content/types.js";
import { sha256 } from "../util/hash.js";
import { readJsonOr, writeJson } from "../util/json.js";
import type { Manifest, ManifestStore } from "./manifest.js";
import { displayPath } from "./pipeline.js";

/**
 * Brings manifest entries made before 23 Oct in line with the current rules, without a new exec:
 * - a display WebP moves to {@link displayPath} (spike photos leave `photos/`, which holds only IC-11's
 *   A–L and P01–P54, so a consumer globbing `photos/*.webp` never picks up a spike);
 * - the entry's prompt points at the immutable history copy of the prompt that made its master
 *   (`prompts/history/{id}.{sha8}.md`), never at `prompts/{id}.md`, which a later trial may overwrite.
 */
export interface MigrationStep {
  id: string;
  display?: { from: string; to: string };
  prompt?: { from: string; to: string; sha256: string };
}

export function planMigration(m: Manifest, assets: readonly AssetSpec[]): MigrationStep[] {
  const steps: MigrationStep[] = [];
  for (const a of assets) {
    const e = m.assets[a.id];
    if (!e?.master) continue;
    const step: MigrationStep = { id: a.id };
    const want = displayPath(a);
    if (e.display && e.display.file !== want) step.display = { from: e.display.file, to: want };
    const accepted = e.attempts.find((x) => x.outcome === "accepted");
    if (accepted && (e.prompt.file !== accepted.promptFile || e.prompt.sha256 !== accepted.promptSha256)) {
      step.prompt = { from: e.prompt.file, to: accepted.promptFile, sha256: accepted.promptSha256 };
    }
    if (step.display || step.prompt) steps.push(step);
  }
  return steps;
}

/** Applies the steps: moves files, checks each history prompt's hash, rewrites manifest and fixtures. */
export async function applyMigration(
  mediaRoot: string,
  store: ManifestStore,
  steps: readonly MigrationStep[],
) {
  for (const s of steps) {
    if (s.prompt) {
      const text = await readFile(join(mediaRoot, s.prompt.to));
      if (sha256(text) !== s.prompt.sha256)
        throw new Error(`${s.id}: ${s.prompt.to} does not hash to its attempt's prompt`);
    }
    if (s.display) {
      const from = join(mediaRoot, s.display.from);
      const to = join(mediaRoot, s.display.to);
      if (existsSync(from)) {
        await mkdir(dirname(to), { recursive: true });
        await rename(from, to);
      } else if (!existsSync(to)) {
        throw new Error(`${s.id}: neither ${s.display.from} nor ${s.display.to} exists`);
      }
    }
  }
  await store.update((m) => {
    for (const s of steps) {
      const e = m.assets[s.id];
      if (!e) continue;
      if (s.display && e.display) e.display = { ...e.display, file: s.display.to };
      if (s.prompt) e.prompt = { file: s.prompt.to, sha256: s.prompt.sha256 };
    }
  });
  for (const s of steps) {
    if (!s.display) continue;
    const path = join(mediaRoot, "fixtures", `${s.id}.json`);
    const f = await readJsonOr<{ image?: { display?: string } } | null>(path, null);
    if (f?.image && f.image.display !== s.display.to) {
      f.image.display = s.display.to;
      await writeJson(path, f);
    }
  }
}
