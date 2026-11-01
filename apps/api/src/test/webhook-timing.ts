import { expect } from "vitest";

/** Keep MM-1's 100 ms gate in an isolated run; parallel suites tolerate shared-machine scheduling. */
export function assertWebhookLatency(p95: number, strict: boolean): void {
  expect(p95).toBeLessThanOrEqual(strict ? 100 : 300);
}
