/**
 * Web frames file Judge Mode sample slips only; they live for the tab's life. (expo-sqlite on web needs
 * SharedArrayBuffer and cross-origin isolation headers that the same-origin judge frames do not set.)
 */
import type { OutboxStore } from "../lib/outbox";
import { MemoryOutboxStore } from "../lib/outbox-stores";

export async function openOutboxStore(): Promise<OutboxStore> {
  return new MemoryOutboxStore();
}
