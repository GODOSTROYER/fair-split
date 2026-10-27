import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findAsset, SLIP_0462 } from "../src/content/spike.js";
import type { SlipPageAsset } from "../src/content/types.js";
import { Fixture, type SlipImageFixture } from "../src/fixtures/schema.js";
import { main } from "../src/imagegen/cli.js";
import { type CodexRunResult, findGeneratedImages } from "../src/imagegen/codex.js";
import { AssetEntry, currentMasterAttempt, ManifestStore } from "../src/imagegen/manifest.js";
import { planMigration } from "../src/imagegen/migrate.js";
import { adoptAttempt, generateAsset, type PipelineDeps } from "../src/imagegen/pipeline.js";
import { planGeneration } from "../src/imagegen/plan.js";
import { applyObservations, applyReview, fixtureFields, type ReviewFile } from "../src/imagegen/review.js";
import type { TerminalIo } from "../src/review/confirm.js";
import { entry, slipPageFixture } from "./support.js";

/**
 * verify:media major: `imagegen gen <id> --force` (README decision 2 regenerates 0462 this way) used to leave
 * the replaced master's attempt `accepted` beside the new one, and every lookup took the oldest. A report of
 * the old pixels then counted as evidence for the new master, a check of the old image was written into the
 * new master's fixture, and `migrate` pointed the prompt back at the old one. A new master now supersedes
 * the old (as `promote` always did), and every lookup asks `currentMasterAttempt`.
 */

const T1 = new Date("2026-10-22T07:00:00.000Z");
const T2 = new Date("2026-10-25T10:00:00.000Z");
const AT = "2026-10-26T01:00:00.000Z";
const agentShell: TerminalIo = { interactive: false, ask: async () => "", say: () => undefined };

let logs: string[] = [];
beforeEach(() => {
  logs = [];
  const keep = (...a: unknown[]) => void logs.push(a.join(" "));
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation(keep);
});
afterEach(() => vi.restoreAllMocks());

const asset = findAsset("spike-0462") as SlipPageAsset;
/** README decision 2's other answer: the stain covers box 11 too, so 0462 is regenerated. */
const restained: SlipPageAsset = {
  ...asset,
  slip: {
    ...SLIP_0462,
    artifacts: [
      { kind: "WATER_STAIN", visible: { gross_kg: "6?.80", net_kg: "6?.50", payable_kg: "6?.50" } },
    ],
  },
};

/** A stand-in for `codex exec`: run k "generates" one distinct portrait image and reports it started at times[k]. */
function fakeCodex(home: string, times: readonly Date[]) {
  let k = 0;
  return async (): Promise<CodexRunResult> => {
    const i = k++;
    const threadId = `thread-${i}`;
    const dir = join(home, "generated_images", threadId);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `ig_${i}.png`);
    await sharp({
      create: { width: 1199, height: 1312, channels: 3, background: { r: 20 + 70 * i, g: 120, b: 200 } },
    })
      .png()
      .toFile(path);
    return {
      exitCode: 0,
      timedOut: false,
      threadId,
      usage: null,
      agentMessages: ["DONE"],
      errors: [],
      savedPaths: [path],
      startedAt: times[i] ?? new Date(),
      durationMs: 90_000,
    };
  };
}

function pipeline(times: readonly Date[]): PipelineDeps & { store: ManifestStore } {
  const mediaRoot = mkdtempSync(join(tmpdir(), "fs-regen-"));
  const codexHome = mkdtempSync(join(tmpdir(), "fs-regen-codex-"));
  return {
    mediaRoot,
    store: new ManifestStore(join(mediaRoot, "manifest.json")),
    codexCli: "codex-cli test",
    run: fakeCodex(codexHome, times),
    find: findGeneratedImages,
    codexHome,
  };
}

/** `imagegen gen spike-0462` at T1, then `imagegen gen spike-0462 --force` with box 11 stained at T2. */
async function regenerated() {
  const d = pipeline([T1, T2]);
  expect((await generateAsset(asset, d)).ok).toBe(true);
  expect((await generateAsset(restained, d)).ok).toBe(true);
  const e = (await d.store.read()).assets["spike-0462"];
  const [replaced, current] = e?.attempts ?? [];
  if (!e?.master || !replaced?.output || !current?.output) throw new Error("two generated masters expected");
  return { d, e, master: e.master, replaced: replaced.output.sha256, current: current.output.sha256 };
}

describe("a new master supersedes the one it replaces", () => {
  it("gen --force leaves one accepted attempt, and gen, plan and migrate name the new one", async () => {
    const { d, e, replaced } = await regenerated();
    expect(e.attempts.map((a) => [a.n, a.outcome])).toEqual([
      [1, "trial_ok"],
      [2, "accepted"],
    ]);
    expect(e.attempts[0]?.reason).toMatch(/^superseded by attempt 2/);
    // The replaced image stays on record as a trial, raw file and all; nothing is deleted.
    expect(e.trials.map((t) => t.sha256)).toEqual([replaced]);
    expect(currentMasterAttempt(e)).toMatchObject({ n: 2, startedAt: T2.toISOString() });
    const m = await d.store.read();
    const plan = planGeneration([asset], m, () => null, { all: false, force: false, replaceReviewed: false });
    expect(plan.skipped).toEqual([
      { id: "spike-0462", reason: "has an accepted master (attempt 2); pass --force to replace it" },
    ]);
    // The two masters came from different prompts; the manifest keeps the new master's, and migrate agrees.
    expect(e.attempts[0]?.promptSha256).not.toBe(e.attempts[1]?.promptSha256);
    expect(e.prompt).toEqual({ file: e.attempts[1]?.promptFile, sha256: e.attempts[1]?.promptSha256 });
    expect(planMigration(m, [asset])).toEqual([]);
  });

  it("trap-verdict dates a report against the exec that made the current master, not the replaced one", async () => {
    const { d, master } = await regenerated();
    const f = slipPageFixture("spike-0462", restained.slip, { sha: master.sha256 });
    applyObservations(f, { allFieldsChecked: true, observed: [], mismatches: [], traps: [] }, AT);
    mkdirSync(join(d.mediaRoot, "fixtures"), { recursive: true });
    writeFileSync(join(d.mediaRoot, "fixtures", "spike-0462.json"), JSON.stringify(f));
    const repo = mkdtempSync(join(tmpdir(), "fs-regen-repo-"));
    mkdirSync(join(repo, "packages", "eval", "report", "history"), { recursive: true });
    /** A live READ report generated at `at` that read and passed spike-0462#ONLY. */
    const report = (at: string) => {
      const rel = `packages/eval/report/history/${at.replace(/[:.]/g, "-")}-live-dev.json`;
      writeFileSync(
        join(repo, rel),
        JSON.stringify({
          v: 1,
          generated_at: at,
          mode: "live",
          set: "dev",
          cases: [{ id: "spike-0462#ONLY", kind: "slip", pass: true, reasons: [] }],
        }),
      );
      return rel;
    };
    const verdict = (rel: string) =>
      main(
        ["trap-verdict", "spike-0462", "ONLY", "WATER_STAIN", "--status", "HOLDS", "--evidence", rel],
        d.mediaRoot,
        agentShell,
        repo,
      );
    const trap = () =>
      (
        Fixture.parse(
          JSON.parse(readFileSync(join(d.mediaRoot, "fixtures", "spike-0462.json"), "utf8")),
        ) as SlipImageFixture
      ).slips[0]?.trapChecks[0];
    // Read between the two execs: it read the replaced pixels.
    expect(await verdict(report("2026-10-23T12:00:00.000Z"))).toBe(1);
    expect(logs.join("\n")).toMatch(/predates this master \(its exec started 2026-10-25T10:00:00\.000Z\)/);
    expect(trap()).toMatchObject({ status: "UNVERIFIED", by: null });
    // Read after the new master was made.
    expect(await verdict(report("2026-10-26T00:00:00.000Z"))).toBe(0);
    expect(trap()).toMatchObject({ status: "HOLDS", by: "read" });
  });

  it("apply-review writes a check of the new master into its fixture, and a check of the replaced image only into its trial", async () => {
    const { d, replaced, current, master } = await regenerated();
    const fixtures = new Map<string, Fixture>([
      ["spike-0462", slipPageFixture("spike-0462", restained.slip, { sha: master.sha256 })],
    ]);
    const io = {
      readFixture: async (id: string) => structuredClone(fixtures.get(id) ?? null),
      writeFixture: async (f: Fixture) => void fixtures.set(f.id, Fixture.parse(f)),
    };
    const check = (sha: string, gross: string): ReviewFile => ({
      v: 2,
      reviewer: "Claude (agent)",
      method: "visual check",
      reviewedAt: AT,
      images: [
        {
          asset: "spike-0462",
          sha256Prefix: sha.slice(0, 12),
          promptVersion: "p2",
          checked: 17,
          mismatches: [],
          allFieldsChecked: true,
          cropsChecked: true,
          observed: [{ where: "fields.gross_kg", visible: gross, legibility: "SMUDGED" }],
        },
      ],
    });
    const gross = () => fixtureFields(fixtures.get("spike-0462") as Fixture).get("fields.gross_kg");

    // A stale check file of the replaced image measures that image, now a trial, and nothing else.
    const stale = await applyReview(d.store, check(replaced, "OLD-IMAGE"), io);
    expect(stale).toMatchObject({ images: 1, fixtures: [], agentChecked: [], skippedFixtures: [] });
    expect(gross()).toMatchObject({ visible: "6?.80", legibility: "UNVERIFIED", checkedBy: null });
    expect(fixtures.get("spike-0462")?.review.status).toBe("draft");
    let e = (await d.store.read()).assets["spike-0462"];
    expect(e?.review.status).toBe("pending");
    expect(e?.trials.find((t) => t.sha256 === replaced)?.fieldMatch).toMatchObject({
      matched: 17,
      total: 17,
    });

    // A check of the new master's pixels becomes its fixture's readings.
    const fresh = await applyReview(d.store, check(current, "6?.80"), io);
    expect(fresh).toMatchObject({ images: 1, fixtures: ["spike-0462"], agentChecked: ["spike-0462"] });
    expect(gross()).toMatchObject({ visible: "6?.80", legibility: "SMUDGED", checkedBy: "agent" });
    e = (await d.store.read()).assets["spike-0462"];
    expect(e?.review).toMatchObject({ status: "agent-checked", fieldMatch: { matched: 17, total: 17 } });
  });

  it("adopting an earlier attempt as the master supersedes the master it replaces", async () => {
    const now = Date.now();
    const d = pipeline([new Date(now - 120_000), new Date(now - 60_000)]);
    await generateAsset(asset, d);
    // An over-strict check missed the second exec's image: it is recorded without output, then adopted.
    await generateAsset(asset, { ...d, find: async () => [] }, { maxAttempts: 1 });
    await adoptAttempt(asset, d, 2, "accept");
    const e = (await d.store.read()).assets["spike-0462"];
    expect(e?.attempts.map((a) => [a.n, a.outcome])).toEqual([
      [1, "trial_ok"],
      [2, "accepted"],
    ]);
    expect(e?.attempts[0]?.reason).toMatch(/^superseded by attempt 2/);
    expect(e?.trials.map((t) => t.sha256)).toEqual([e?.attempts[0]?.output?.sha256]);
    expect(e && currentMasterAttempt(e)?.n).toBe(2);
  });
});

describe("the manifest names one attempt as the maker of the master", () => {
  it("refuses a second accepted attempt, a master no accepted attempt made, and an accepted attempt without a master", () => {
    const e = entry("spike-0462");
    const [first] = e.attempts;
    if (!first) throw new Error("support entry has an accepted attempt");
    expect(AssetEntry.safeParse(e).success).toBe(true);
    const twice = { ...e, attempts: [first, { ...first, n: 2, startedAt: T2.toISOString() }] };
    expect(AssetEntry.safeParse(twice).error?.message).toMatch(/one accepted attempt/);
    expect(AssetEntry.safeParse({ ...e, attempts: [] }).success).toBe(false);
    expect(AssetEntry.safeParse({ ...e, master: null, display: null }).success).toBe(false);
  });

  it("currentMasterAttempt is the accepted attempt, and nothing without a master", () => {
    const e = entry("spike-0462");
    expect(currentMasterAttempt(e)).toMatchObject({ n: 1, outcome: "accepted" });
    expect(currentMasterAttempt({ ...e, master: null })).toBeNull();
  });
});
