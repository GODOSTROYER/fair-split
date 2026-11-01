import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertWebhookLatency } from "../test/webhook-timing.js";

describe("W1 timing gates", () => {
  it("keeps the strict 100 ms gate in the serial perf run", () => {
    expect(() => assertWebhookLatency(100, true)).not.toThrow();
    expect(() => assertWebhookLatency(100.01, true)).toThrow();
  });

  it("only measures in the parallel suite, where a shared machine's load decides the number", () => {
    expect(() => assertWebhookLatency(108, false)).not.toThrow();
    expect(() => assertWebhookLatency(1000, false)).not.toThrow();
    expect(() => assertWebhookLatency(Number.NaN, false)).toThrow();
  });

  it("exposes a single-worker perf script with the strict flag", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    expect(pkg.scripts.perf).toBe(
      "vitest run --maxWorkers=1 --config vitest.perf.config.ts src/money/webhook-delivery.pg.test.ts",
    );
    const config = readFileSync(new URL("../../vitest.perf.config.ts", import.meta.url), "utf8");
    expect(config).toContain('FS_WEBHOOK_PERF: "1"');
  });
});
