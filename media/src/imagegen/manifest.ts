import { relative } from "node:path";
import { z } from "zod";
import { Composition } from "../compose/schema.js";
import { MEDIA_ROOT } from "../util/env.js";
import { readJsonOr, writeJson } from "../util/json.js";
import { withFileLock } from "../util/lock.js";

/** The only image generator this project uses (C-24, AI-11). */
export const GENERATOR = "gpt-image-2 via Codex built-in image_gen";
export const SYNTHETIC_LABEL = "Synthetic sample";

const Usage = z.object({
  input_tokens: z.number(),
  cached_input_tokens: z.number(),
  output_tokens: z.number(),
  reasoning_output_tokens: z.number(),
});

const Derived = z.object({
  file: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().positive(),
});

export const Attempt = z.object({
  n: z.number().int().positive(),
  purpose: z.enum(["accept", "trial"]),
  promptFile: z.string(),
  promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** The prompt skeleton version the attempt used (recorded from 23 Oct; older attempts lack it). */
  promptVersion: z.string().optional(),
  inputImages: z.array(z.string()),
  threadId: z.string().nullable(),
  startedAt: z.string(),
  durationMs: z.number().nonnegative(),
  exitCode: z.number().nullable(),
  outcome: z.enum(["accepted", "rejected", "no_output", "trial_ok"]),
  reason: z.string().optional(),
  raw: z.string().optional(),
  output: z
    .object({ sha256: z.string(), width: z.number(), height: z.number(), bytes: z.number() })
    .optional(),
  usage: Usage.nullable(),
});
export type Attempt = z.infer<typeof Attempt>;

export const FieldMatch = z.object({
  matched: z.number().int().nonnegative(),
  total: z.number().int().positive(),
  mismatches: z.array(z.object({ where: z.string(), expected: z.string(), visible: z.string() })),
});
export type FieldMatch = z.infer<typeof FieldMatch>;

export const Review = z.object({
  status: z.enum(["pending", "agent-checked", "human-reviewed"]),
  reviewer: z.string().nullable(),
  at: z.string().nullable(),
  method: z.string().nullable(),
  fieldMatch: FieldMatch.nullable(),
  deviations: z.array(z.string()),
});
export type Review = z.infer<typeof Review>;

export const AssetEntry = z
  .object({
    id: z.string(),
    kind: z.enum(["slip_photo", "slip_page", "rate_card_page", "logbook_page"]),
    title: z.string(),
    /** I8: nothing simulated goes unlabelled. Every generated asset is synthetic and says so. */
    synthetic: z.literal(true),
    label: z.literal(SYNTHETIC_LABEL),
    pipeline: z.enum(["direct", "edit"]),
    generator: z.literal(GENERATOR),
    codexCli: z.string(),
    promptVersion: z.string(),
    prompt: z.object({ file: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
    source: z.union([
      z.object({ kind: z.literal("provisional"), note: z.string() }),
      z.object({ kind: z.literal("seed"), snapshotSha256: z.string() }),
      z.object({ kind: z.literal("text-layer"), file: z.string() }),
    ]),
    editOf: z.string().optional(),
    attempts: z.array(Attempt),
    master: Derived.nullable(),
    display: Derived.nullable(),
    fixture: z.string().nullable(),
    review: Review,
    trials: z
      .array(z.object({ raw: z.string(), sha256: z.string(), fieldMatch: FieldMatch.nullable() }))
      .default([]),
  })
  .superRefine((e, ctx) => {
    // The accepted attempt is the master's provenance (see currentMasterAttempt): exactly one per master.
    const accepted = e.attempts.filter((a) => a.outcome === "accepted").map((a) => a.n);
    const message =
      accepted.length > 1
        ? `only one accepted attempt, the one that made the master: attempts ${accepted.join(", ")} are all accepted (a new master supersedes the attempt of the one it replaces)`
        : e.master && accepted.length === 0
          ? "a master needs the one accepted attempt that made it"
          : !e.master && accepted.length === 1
            ? `attempt ${accepted[0]} is accepted, but the entry has no master`
            : null;
    if (message) ctx.addIssue({ code: "custom", path: ["attempts"], message });
  });
export type AssetEntry = z.infer<typeof AssetEntry>;

/**
 * The attempt that made the entry's current master, or null without one. A new master (`gen --force`,
 * `adopt`, `promote`) supersedes the attempt of the master it replaces, so an entry with a master names
 * exactly one accepted attempt (schema-enforced). Every lookup of "the master's exec" goes through here:
 * its start time dates WS-READ reports (`trap-verdict`, `replay-check`), its output's sha256 is what a check
 * file names (`apply-review`), and its prompt is the entry's prompt (`migrate`).
 */
export function currentMasterAttempt(e: Pick<AssetEntry, "master" | "attempts">): Attempt | null {
  if (!e.master) return null;
  const accepted = e.attempts.filter((a) => a.outcome === "accepted");
  return accepted.length === 1 ? (accepted[0] ?? null) : null;
}

export const Manifest = z.object({
  v: z.literal(1),
  synthetic: z.literal(true),
  notice: z.string(),
  assets: z.record(z.string(), AssetEntry),
  /** D3(b): deterministic desk compositions, never represented as an image-model generation. */
  compositions: z.record(z.string(), Composition).default({}),
});
export type Manifest = z.infer<typeof Manifest>;

export const MANIFEST_NOTICE =
  "Every image listed here is synthetic. Assets are generated by OpenAI's image model through the user's Codex CLI. Compositions are made in code from those hero flats and code-drawn slips, with each source labelled. People, slips, documents and the co-op are fictional. Images carry synthetic specimen labels.";

export function emptyManifest(): Manifest {
  return { v: 1, synthetic: true, notice: MANIFEST_NOTICE, assets: {}, compositions: {} };
}

export const MANIFEST_PATH = `${MEDIA_ROOT}/manifest.json`;

export async function loadManifest(path = MANIFEST_PATH): Promise<Manifest> {
  return Manifest.parse(await readJsonOr(path, emptyManifest()));
}

export async function saveManifest(m: Manifest, path = MANIFEST_PATH): Promise<void> {
  const sorted: Manifest = {
    ...m,
    assets: Object.fromEntries(Object.entries(m.assets).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeJson(path, Manifest.parse(sorted));
}

/**
 * Serialises read-modify-write updates: in-process through a promise chain, across processes through a
 * lock file, so parallel generations never lose an entry.
 */
export class ManifestStore {
  private chain: Promise<unknown> = Promise.resolve();
  constructor(readonly path = MANIFEST_PATH) {}

  update(fn: (m: Manifest) => void | Promise<void>): Promise<Manifest> {
    const next = this.chain.then(() =>
      withFileLock(this.path, async () => {
        const m = await loadManifest(this.path);
        await fn(m);
        await saveManifest(m, this.path);
        return m;
      }),
    );
    this.chain = next.catch(() => undefined);
    return next;
  }

  read(): Promise<Manifest> {
    return this.chain.then(() => loadManifest(this.path));
  }
}

/** Paths in manifests and fixtures are relative to media/, with forward slashes. */
export function mediaRelative(absPath: string, root = MEDIA_ROOT): string {
  return relative(root, absPath).split("\\").join("/");
}
