// Replays the recorded live smoke run (reads A+B on three synthetic smoke images) through the full
// extraction pipeline. No network: the gateway runs replay_only and a missing recording fails.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ClaudeGateway,
  FsReplayStore,
  MemorySpendMeter,
  Semaphore,
  staticFlags,
} from "../../gateway/index.js";
import type { PhotoFixture, ReadingEvent } from "../_shims/contracts.js";
import { type ExtractResult, extract } from "../extract.js";
import { SMOKE_DIR, SMOKE_IMAGES } from "./make-images.js";

const registry = new Map(
  [
    ["M-101", "Rosa Lim"],
    ["M-102", "Benjie Tan"],
    ["M-103", "Cora Diaz"],
  ].map(([memberNo, name]) => [memberNo as string, { memberNo: memberNo as string, name: name as string }]),
);

async function run(id: string): Promise<{ result: ExtractResult; events: ReadingEvent[] }> {
  const img = SMOKE_IMAGES.find((i) => i.id === id);
  if (!img) throw new Error(id);
  const gateway = new ClaudeGateway({
    store: new FsReplayStore(`${SMOKE_DIR}recordings`),
    flags: staticFlags({ kill_ai_live: true }),
    spend: new MemorySpendMeter(),
    semaphore: new Semaphore(6),
  });
  const fixture = JSON.parse(readFileSync(`${SMOKE_DIR}${img.id}.fixture.json`, "utf8")) as PhotoFixture;
  const events: ReadingEvent[] = [];
  const result = await extract(
    {
      docId: img.id,
      kind: fixture.slips.length > 1 ? "slip_photo" : "slip_page",
      bytes: readFileSync(`${SMOKE_DIR}${img.file}`),
      fixture,
      validation: { registry },
      zoom: false, // the smoke run recorded reads A and B only
      screen: false,
      emit: (e) => events.push(e),
    },
    { gateway, mode: "replay_only", lane: "dev" },
  );
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
