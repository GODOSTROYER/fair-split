import type { RunEvent } from "@fairsplit/contracts";
export function tamperWasRefused(events: readonly RunEvent[]): boolean {
  return events.some(
    (event) =>
      event.type === "run.state" &&
      event.payload.from === "APPROVED" &&
      event.payload.to === "IN_REVIEW" &&
      event.payload.cause.ref === "DIGEST_MISMATCH",
  );
}
