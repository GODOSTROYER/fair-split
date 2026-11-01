import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ClaudeGateway,
  FsReplayStore,
  MemoryCallLedger,
  MemorySpendMeter,
  staticFlags,
} from "@fairsplit/ai/gateway";
import { expect, it, vi } from "vitest";
import { renderR1, reproduceR1, serializeR1 } from "./r1.js";

it("inv.i8.R1 committed real readings reproduce the entire exhibit with live killed and zero calls", {
  timeout: 120_000,
}, async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const ledger = new MemoryCallLedger();
  const gateway = new ClaudeGateway({
    store: new FsReplayStore(`${root}/recordings`),
    flags: staticFlags({ kill_ai_live: true }),
    spend: new MemorySpendMeter(),
    ledger,
  });
  const network = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    throw new Error("R1 replay attempted network");
  });
  try {
    const evidence = await reproduceR1({ gateway });
    expect(evidence).toEqual(JSON.parse(readFileSync(`${root}/report/R1.json`, "utf8")));
    expect(serializeR1(evidence)).toBe(readFileSync(`${root}/report/R1.json`, "utf8"));
    expect(renderR1(evidence)).toBe(readFileSync(`${root}/report/R1.md`, "utf8"));
    expect(evidence.sample.scored_images).toBe(10);
    expect(evidence.sample.unscored_images).toBe(1);
    expect(evidence.unscored[0]?.status).toBe("not scored");
    expect(evidence.recordings.every((r) => r.provenance === "live")).toBe(true);
    expect(evidence.cost.live_spend_usd).toBeLessThanOrEqual(10);
    expect(evidence.cost.replay_incurred_usd).toBe(0);
    expect(evidence.double_read.reported.errors).toBe(0);
    expect(evidence.single_read_a.incurredCostUsd).toBe(0);
    expect(evidence.single_read_a.errors).toBe(0);
    expect(evidence.single_read_a.promptDrift).toBe(0);
    expect(evidence.unscored[0]?.error).toBeNull();
    expect(evidence.unscored[0]?.rows).toHaveLength(4);
    expect(evidence.cost.live_spend_usd).toBe(evidence.cost.recording_cost_usd);
    for (const r of evidence.recordings) {
      const raw = readFileSync(`${root}/recordings/${r.cache_key}.json`, "utf8");
      expect(raw).not.toMatch(/sk-ant-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._~+/-]{16,}/);
      const inspect = (value: unknown): void => {
        if (!value || typeof value !== "object") return;
        for (const [key, child] of Object.entries(value)) {
          expect(key).not.toMatch(/^(?:authorization|headers|request_headers|x-api-key|apiKey)$/i);
          inspect(child);
        }
      };
      inspect(JSON.parse(raw));
    }
    expect(ledger.rows).toEqual([]);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
