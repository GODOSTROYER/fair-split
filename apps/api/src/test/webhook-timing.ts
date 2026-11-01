import { expect } from "vitest";

/**
 * MM-1's 100 ms gate holds only in the isolated serial perf run (`pnpm --filter @fairsplit/api perf`, and its CI
 * step). Inside the parallel suite a shared machine's scheduling decides the number, so there the p95 is measured
 * and logged but not gated.
 */
export function assertWebhookLatency(p95: number, strict: boolean): void {
  expect(Number.isFinite(p95)).toBe(true);
  if (strict) expect(p95).toBeLessThanOrEqual(100);
}
