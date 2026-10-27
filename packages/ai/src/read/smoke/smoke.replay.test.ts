// Replays the recorded live smoke runs through the production code: reads A+B on three synthetic
// smoke images (the S3 smoke run), then the components that run recorded once more (AI-3 zoom, AI-4
// screen and re-screen, AI-5 rate card, AI-6 classifier). No network: the gateway runs replay_only
// with kill_ai_live on, and a missing recording fails.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CLASSIFY_PROMPT_V, classifyDeduction } from "../../classify/classify.js";
import {
  ClaudeGateway,
  FsReplayStore,
  MemorySpendMeter,
  Semaphore,
  sha256Hex,
  staticFlags,
} from "../../gateway/index.js";
import { RATECARD_PROMPT_V, ratecardPrompt, readRateCard } from "../../ratecard/read.js";
import type { ReadingEvent } from "../_shims/contracts.js";
import type { ReadDeps } from "../calls.js";
import { type ExtractResult, extract } from "../extract.js";
import { loadPromptFile, prompt } from "../prompts.js";
import { SMOKE_DIR } from "./make-images.js";
import { classifyInputs, ratecardStubInput, smokeInput } from "./run-components.js";

function replayDeps(): ReadDeps {
  const gateway = new ClaudeGateway({
    store: new FsReplayStore(`${SMOKE_DIR}recordings`),
    flags: staticFlags({ kill_ai_live: true }),
    spend: new MemorySpendMeter(),
    semaphore: new Semaphore(6),
  });
  return { gateway, mode: "replay_only", lane: "dev" };
}

/** The reads alone (the S3 smoke run recorded reads A and B only). */
async function run(
  id: string,
  over: { zoom?: boolean; screen?: boolean } = { zoom: false, screen: false },
): Promise<{ result: ExtractResult; events: ReadingEvent[] }> {
  const events: ReadingEvent[] = [];
  const result = await extract({ ...smokeInput(id, over), emit: (e) => events.push(e) }, replayDeps());
  return { result, events };
}

/** Prompts are frozen: every committed recording was made with the prompt text in the repo today. */
const noDrift = (r: ExtractResult) => r.calls.every((c) => !c.promptDrift);

const boxRate = (r: ExtractResult) => {
  const checks = r.rows.flatMap((row) =>
    Object.values(row.fields).flatMap((fo) =>
      [fo?.boxOk.a, fo?.boxOk.b].filter((x): x is boolean => typeof x === "boolean"),
    ),
  );
  return checks.filter(Boolean).length / checks.length;
};

/** The sha256 of every prompt as the repo has it today, by promptV. */
const PROMPT_SHA: Record<string, string> = {
  ...Object.fromEntries(
    (["a.v1", "b.v1", "zoom.v2", "screen.v1"] as const).map((n) => [n, prompt(n).sha256]),
  ),
  [RATECARD_PROMPT_V]: ratecardPrompt().sha256,
  [CLASSIFY_PROMPT_V]: sha256Hex(
    loadPromptFile(new URL("../../classify/prompts/", import.meta.url), CLASSIFY_PROMPT_V),
  ),
};

describe("committed recordings", () => {
  it("every one answers the prompt text in the repo today: none would replay with prompt drift", () => {
    const dir = join(SMOKE_DIR, "recordings");
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const rec = JSON.parse(readFileSync(join(dir, f), "utf8")) as { prompt_v: string; prompt_sha?: string };
      expect(
        PROMPT_SHA[rec.prompt_v],
        `${f}: a prompt this repo does not have (${rec.prompt_v})`,
      ).toBeDefined();
      expect(rec.prompt_sha, `${f} (${rec.prompt_v})`).toBe(PROMPT_SHA[rec.prompt_v]);
    }
  });
});

describe("smoke replay (recorded live run, claude-opus-5-5 at effort low)", () => {
  it("smoke-1 clean slip: every field auto-accepted at 0.97, boxes inside their cells", async () => {
    const { result, events } = await run("smoke-1-clean");
    expect(result.provenance).toBe("replay");
    expect(noDrift(result)).toBe(true);
    expect(result.costMicros).toBe(0);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0];
    expect(row).toMatchObject({
      state: "AUTO_ACCEPTED",
      minScore: 0.97,
      serial: "0901",
      memberNo: "M-101",
      copy: "WHITE_ORIGINAL",
    });
    expect(row?.fields.net_kg?.outcome?.value).toBe("64.50");
    expect(row?.deductions.map((d) => d.text)).toEqual(["Hauling ₱96.75"]);
    expect(boxRate(result)).toBe(1);
    expect(result.holds).toEqual([]);
    expect(events.filter((e) => e.type === "extract.row")).toHaveLength(1);
    expect(events.filter((e) => e.type === "extract.field").length).toBeGreaterThanOrEqual(2 * 15);
  });

  it("smoke-2: the overwritten grade scores 0.60 and the smudged net goes to a person; the row is held", async () => {
    const { result } = await run("smoke-2-overwrite-smudge");
    expect(noDrift(result)).toBe(true);
    const row = result.rows[0];
    expect(row?.copy).toBe("PINK_DUPLICATE");
    expect(row?.fields.grade?.a).toMatchObject({
      legibility: "OVERWRITTEN",
      value_text: "G2",
      overwritten_from: "G1",
    });
    expect(row?.fields.grade?.outcome).toMatchObject({ score: 0.6, rule: 2 });
    expect(row?.fields.net_kg?.a.legibility).toBe("SMUDGED");
    expect(row?.fields.net_kg?.outcome).toMatchObject({ score: 0.4, state: "PERSON_TYPES" });
    expect(row?.fields.gross_kg?.outcome?.score).toBe(0.97);
    expect(row?.state).toBe("NEEDS_HUMAN");
    expect(result.holds).toEqual([
      {
        kind: "LOW_CONFIDENCE",
        gate: "BLOCKS_APPROVAL",
        docId: "smoke-2-overwrite-smudge",
        row: 0,
        reason: "By hand: net_kg, grade",
      },
    ]);
    expect(row?.deductions[0]?.text).toBe("Multa (absent GA) 200");
  });

  it("smoke-3: two slips match their fixture slots; the margin note is quarantined without a hold", async () => {
    const { result, events } = await run("smoke-3-two-slips-note");
    expect(noDrift(result)).toBe(true);
    expect(result.rows.map((r) => [r.row, r.serial, r.memberNo, r.state])).toEqual([
      [0, "0903", "M-103", "AUTO_ACCEPTED"],
      [1, "0904", "M-101", "AUTO_ACCEPTED"],
    ]);
    expect(boxRate(result)).toBe(1);
    expect(result.quarantined).toHaveLength(1);
    expect(result.quarantined[0]).toMatchObject({ type: "extract.quarantined", row: 0, source: "read_a" });
    expect(events.filter((e) => e.type === "extract.quarantined")).toHaveLength(1);
    expect(result.anomalies.filter((a) => a.kind === "INSTRUCTION_LIKE_TEXT").map((a) => a.source)).toEqual([
      "read_a",
      "read_b",
    ]);
    expect(result.holds).toEqual([]);
    expect(result.rows[1]?.deductions.map((d) => d.text)).toEqual(["Hauling ₱78.15", "CBU 25"]);
  });
});

describe("component smoke replay (recorded live once: zoom, screen, rate card, classifier)", () => {
  it("AI-3 + AI-4: smoke-2's stained net is re-read on a sanitised crop, still smudged, so a person types it", async () => {
    const { result, events } = await run("smoke-2-overwrite-smudge", { zoom: true, screen: true });
    expect(result.provenance).toBe("replay");
    expect(result.calls.every((c) => !c.promptDrift && c.stopReason === "end_turn")).toBe(true);
    expect(result.calls.map((c) => c.modelServed)).toEqual([
      "claude-opus-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
      "claude-opus-5-5",
    ]);
    expect(result.screen).toMatchObject({ suspected: false, refusal: false, failed: null });
    expect(result.cropsWithheld).toBe(false);
    const net = result.rows[0]?.fields.net_kg;
    expect(net?.zoom).toMatchObject({ value_text: "80.75", legibility: "SMUDGED" });
    expect(net?.zoomError).toBeNull();
    expect(net?.boxOk.zoom).toBe(true);
    expect(net?.outcome).toMatchObject({ score: 0.4, rule: 7, state: "PERSON_TYPES", display: "80.75" });
    expect(result.holds).toEqual([
      {
        kind: "LOW_CONFIDENCE",
        gate: "BLOCKS_APPROVAL",
        docId: "smoke-2-overwrite-smudge",
        row: 0,
        reason: "By hand: net_kg, grade",
      },
    ]);
    expect(events.filter((e) => e.type === "extract.row")).toHaveLength(1);
  });

  it("AI-4: the screen fires on smoke-3's margin note; the re-screen of the rest is clean; quarantine only", async () => {
    const { result } = await run("smoke-3-two-slips-note", { zoom: true, screen: true });
    expect(result.calls.map((c) => c.modelServed)).toEqual([
      "claude-opus-5-5",
      "claude-opus-5-5",
      "claude-haiku-5-5",
      "claude-haiku-5-5",
    ]);
    expect(result.screen).toMatchObject({ suspected: true, refusal: false, failed: null });
    expect(result.rescreen).toMatchObject({ suspected: false, refusal: false, failed: null });
    expect(result.cropsWithheld).toBe(false);
    expect(result.quarantined).toEqual([
      expect.objectContaining({ type: "extract.quarantined", row: 0, source: "read_a" }),
    ]);
    expect(result.quarantinedBoxes.length).toBeGreaterThanOrEqual(1);
    expect(result.holds).toEqual([]);
    expect(result.rows.map((r) => r.state)).toEqual(["AUTO_ACCEPTED", "AUTO_ACCEPTED"]);
  });

  it("AI-5: the stub page's six terms pass every check, typed by code; the handwritten line is never a term", async () => {
    const card = await readRateCard(ratecardStubInput(), replayDeps());
    expect(card.result).toMatchObject({
      provenance: "replay",
      modelServed: "claude-opus-5-5",
      stopReason: "end_turn",
    });
    expect(card.draft.ok).toBe(true);
    expect(card.draft.resolution_no).toBe("BR 2026-99");
    expect(card.draft.terms.map((t) => [t.rule_id, t.kind, t.basis, t.checks.length])).toEqual([
      ["R1", "DEDUCTION", "PCT_OF_BONUS", 0],
      ["R2", "DEDUCTION", "PER_NET_KG", 0],
      ["R5", "COSIGN", "BATCH_TOTAL", 0],
      ["R5", "COSIGN", "LINE_TOTAL", 0],
      ["R5", "COSIGN", "OVERRIDE", 0],
      ["CLOSED", "CLOSED_LIST", "NONE", 0],
    ]);
    const byBasis = Object.fromEntries(card.draft.terms.map((t) => [t.basis, t]));
    expect(byBasis.PCT_OF_BONUS).toMatchObject({
      value: { unit: "bp", value: 500 },
      cap: { unit: "centavos", value: 500_000 },
    });
    expect(byBasis.PER_NET_KG?.value).toEqual({ unit: "centavos_per_kg", value: 150 });
    expect(byBasis.BATCH_TOTAL?.value).toEqual({ unit: "cents", value: 30_000 });
    expect(byBasis.LINE_TOTAL?.value).toEqual({ unit: "cents", value: 15_000 });
    expect(card.draft.amendments.map((a) => [a.kind, a.verbatim])).toEqual([
      ["HANDWRITTEN_AMENDMENT", "R7 Iba pa P150"],
    ]);
    expect(card.draft.quarantined).toEqual([]);
    expect(card.draft.signatories.map((s) => [s.role, s.signed])).toEqual([
      ["SECRETARY", "YES"],
      ["CHAIR", "YES"],
    ]);
  });

  it("AI-6: an unruled fine is NO_MATCH (NO_RULE); a correct hauling charge is R2 and its amount checks", async () => {
    const deps = replayDeps();
    const [multa, hauling] = await Promise.all(
      classifyInputs({ multa: "Multa (absent GA) 200", hauling: "Hauling ₱96.75" }).map((i) =>
        classifyDeduction(i, deps),
      ),
    );
    expect(multa).toMatchObject({ status: "NO_MATCH", ruleId: null, writtenMinor: 20_000 });
    expect(multa?.hold).toMatchObject({ kind: "NO_RULE", gate: "RESERVES_LINE", field: "deductions" });
    expect(hauling).toMatchObject({ status: "MATCH", ruleId: "R2", writtenMinor: 9675, hold: null });
    expect(hauling?.amount).toEqual({ ok: true, expectedMinor: 9675 });
    for (const r of [multa?.result, hauling?.result]) {
      expect(r).toMatchObject({
        provenance: "replay",
        modelServed: "claude-sonnet-5-5",
        stopReason: "end_turn",
      });
    }
  });
});
