import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ClaudeGateway,
  MemoryCallLedger,
  MemoryReplayStore,
  MemorySpendMeter,
  type Recording,
  staticFlags,
} from "@fairsplit/ai/gateway";
import {
  EXTRACTION_SCHEMA_V,
  type Extraction,
  type FieldRead,
  prepareImage,
  prompt,
  READ_MODEL,
  ROW_FIELDS,
} from "@fairsplit/ai/read";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { ablateSingleReadA } from "./ablation.js";
import type { CaseLabel } from "./labels.js";

async function fixture() {
  const mediaRoot = mkdtempSync(join(tmpdir(), "fs-ablation-"));
  const bytes = await sharp({ create: { width: 100, height: 100, channels: 3, background: "white" } })
    .jpeg()
    .toBuffer();
  writeFileSync(join(mediaRoot, "page.jpg"), bytes);
  const prepared = await prepareImage(bytes);
  const field = (value_text: string, legibility: FieldRead["legibility"] = "CLEAR"): FieldRead => ({
    value_text,
    legibility,
    overwritten_from: "",
    box: { x1: 10, y1: 10, x2: 40, y2: 40 },
  });
  const row = {
    ...Object.fromEntries(ROW_FIELDS.map((name) => [name, field("", "ABSENT")])),
    serial: field("403"),
    date: field("5/21/26"),
    net_kg: field("80.75"),
    slip_box: { x1: 0, y1: 0, x2: 100, y2: 100 },
    copy: "WHITE_ORIGINAL",
    deductions: [],
    signature: "SIGNED",
  };
  const text = JSON.stringify({ page: { rotation: "0", issues: [] }, rows: [row], anomalies: [] });
  const p = prompt("a.v1");
  const rec: Recording = {
    v: 1,
    cache_key: ClaudeGateway.keyOf({
      inputSha: prepared.identity.A,
      variant: "A",
      promptV: p.promptV,
      schemaV: EXTRACTION_SCHEMA_V,
      model: READ_MODEL,
      effort: "low",
    }),
    purpose: "read",
    model: READ_MODEL,
    model_served: READ_MODEL,
    effort: "low",
    variant: "A",
    prompt_v: p.promptV,
    prompt_sha: p.sha256,
    schema_v: EXTRACTION_SCHEMA_V,
    input_sha: prepared.identity.A,
    sent_sha: prepared.sentSha.A,
    usage: {
      input_tokens: 100,
      output_tokens: 100,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      thinking_tokens: null,
      iterations: null,
    },
    cost_micros: 1234,
    stop_reason: "end_turn",
    message: {
      id: "test-ablation",
      type: "message",
      role: "assistant",
      model: READ_MODEL,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 100 },
    },
    replay_timeline: [{ ms: 0, d: text }],
    recorded_at: "2026-11-01T00:00:00.000Z",
    latency_ms: 123,
    first_delta_ms: 10,
    provenance: "live",
  };
  const label: CaseLabel = {
    case: "test-A",
    kind: "slip_page",
    set: "dev",
    image: "page.jpg",
    fixture: null,
    slips: [
      {
        slot: "ONLY",
        serial: "0403",
        copy: "WHITE_ORIGINAL",
        fields: {
          serial: { value: "0403", visible: "0403", expect: "AUTO" },
          date: { value: "05/21/2026", visible: "05/21/2026", expect: "AUTO" },
          net_kg: { value: "80.75", visible: "80.75", expect: "HUMAN" },
        },
        deductions: [],
        traps: ["LOW_CONFIDENCE"],
        duplicate_of: null,
        injection: null,
      },
    ],
    rate_card: null,
    reviewer: "test only",
    reviewed_at: "2026-11-01T00:00:00.000Z",
  };
  return { mediaRoot, rec, label };
}

describe("single-read A ablation", () => {
  it("replays only A with the kill flag on, scores raw fields honestly, and is deterministic", async () => {
    const { mediaRoot, rec, label } = await fixture();
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network forbidden"));
    try {
      const store = new MemoryReplayStore();
      await store.put(rec);
      const ledger = new MemoryCallLedger();
      const gateway = new ClaudeGateway({
        store,
        ledger,
        flags: staticFlags({ kill_ai_live: true }),
        spend: new MemorySpendMeter(),
      });
      const calls = vi.spyOn(gateway, "call");
      const options = { mediaRoot, gateway };
      const report = await ablateSingleReadA([label], options);
      expect(report).toEqual(await ablateSingleReadA([label], options));
      expect(report).toMatchObject({
        variant: "A",
        mode: "replay_only",
        rows: 1,
        exactRows: 0,
        rawExactRows: 1,
        correctFields: 3,
        fields: 3,
        fieldAccuracy: 1,
        incurredCostUsd: 0,
        recordedCostUsd: 0.001234,
        unsafeAutoAccepts: 1,
        injectionCatchRate: null,
        duplicateF1: null,
      });
      expect(report.cases[0]?.rows[0]?.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "serial", normalized: "0403", equal: true }),
          expect.objectContaining({ field: "date", normalized: "2026-05-21", equal: true }),
          expect.objectContaining({
            field: "net_kg",
            expect: "HUMAN",
            equal: true,
            legibility: "CLEAR",
            autoAccepted: true,
            unsafe: true,
          }),
        ]),
      );
      expect(report.cases[0]?.recording).toMatchObject({
        model_served: READ_MODEL,
        recorded_at: rec.recorded_at,
      });
      expect(calls.mock.calls.every(([call]) => call.mode === "replay_only" && call.variant === "A")).toBe(
        true,
      );
      expect(ledger.rows).toHaveLength(0);
      expect(network).not.toHaveBeenCalled();
    } finally {
      network.mockRestore();
      rmSync(mediaRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("reports a missing A recording as an error without making a live call", async () => {
    const { mediaRoot, label } = await fixture();
    try {
      const ledger = new MemoryCallLedger();
      const gateway = new ClaudeGateway({
        store: new MemoryReplayStore(),
        ledger,
        flags: staticFlags({ kill_ai_live: true }),
        spend: new MemorySpendMeter(),
      });
      const report = await ablateSingleReadA([label], { mediaRoot, gateway });
      expect(report.errors).toBe(1);
      expect(report.fields).toBe(3);
      expect(report.fieldAccuracy).toBe(0);
      expect(report.cases[0]?.error).toMatch(/AI_LIVE_DISABLED/);
      expect(report.incurredCostUsd).toBe(0);
      expect(ledger.rows).toHaveLength(0);
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it("uses row arithmetic and reviewed box checks before auto-accepting a CLEAR field", async () => {
    const { mediaRoot, rec, label } = await fixture();
    try {
      const extracted = JSON.parse(rec.message.content[0]?.text ?? "") as Extraction;
      const row = extracted.rows[0];
      if (!row) throw new Error("test row missing");
      row.gross_kg = { ...row.net_kg, value_text: "90.00" };
      row.tare_kg = { ...row.net_kg, value_text: "0.30" };
      rec.message.content = [{ type: "text", text: JSON.stringify(extracted) }];
      writeFileSync(
        join(mediaRoot, "fixture.json"),
        JSON.stringify({
          photo: "test-A",
          slips: [
            {
              slot: "ONLY",
              serial: "0403",
              copy: "WHITE_ORIGINAL",
              rect: { x1: 0, y1: 0, x2: 1, y2: 1 },
              fields: { serial: { x1: 0.8, y1: 0.8, x2: 1, y2: 1 } },
            },
          ],
        }),
      );
      label.fixture = "fixture.json";
      const store = new MemoryReplayStore();
      await store.put(rec);
      const gateway = new ClaudeGateway({
        store,
        flags: staticFlags({ kill_ai_live: true }),
        spend: new MemorySpendMeter(),
      });
      const report = await ablateSingleReadA([label], { mediaRoot, gateway });
      expect(report.unsafeAutoAccepts).toBe(0);
      expect(report.cases[0]?.rows[0]?.fields).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ field: "serial", boxCentreInBox: false, autoAccepted: false }),
          expect.objectContaining({
            field: "net_kg",
            validationError: "row arithmetic",
            autoAccepted: false,
          }),
        ]),
      );
    } finally {
      rmSync(mediaRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
