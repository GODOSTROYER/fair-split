import type { RunEvent } from "@fairsplit/contracts";
import { voidedByChange } from "../approve/model.js";
export function tamperWasRefused(events: readonly RunEvent[]): boolean {
  return voidedByChange({ events }) !== null;
}
