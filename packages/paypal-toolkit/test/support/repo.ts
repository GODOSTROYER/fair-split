import type { InvoiceCheckpoint, InvoiceRepository } from "../../src/index.js";

/** In-memory IC-04 repository double that also logs every save, in order. */
export class MemoryInvoiceRepo implements InvoiceRepository {
  readonly rows = new Map<string, Partial<InvoiceCheckpoint>>();
  readonly saves: { runId: string; patch: Partial<InvoiceCheckpoint> }[] = [];

  constructor(seed: Record<string, Partial<InvoiceCheckpoint>> = {}) {
    for (const [runId, row] of Object.entries(seed)) this.rows.set(runId, { ...row });
  }

  async load(runId: string): Promise<Partial<InvoiceCheckpoint> | null> {
    const row = this.rows.get(runId);
    return row ? { ...row } : null;
  }

  async save(runId: string, patch: Partial<InvoiceCheckpoint>): Promise<void> {
    this.saves.push({ runId, patch: { ...patch } });
    this.rows.set(runId, { ...this.rows.get(runId), ...patch });
  }
}
