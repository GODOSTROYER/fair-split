import type { DbOrTx } from "@fairsplit/db";
import { schema } from "@fairsplit/db";
import { expect, it, vi } from "vitest";
import { readWorkspaceLedger } from "./chain.js";

it("HD6-3: an oversized head refuses without selecting ledger entries", async () => {
  const tables: unknown[] = [];
  const select = vi.fn(() => ({
    from(table: unknown) {
      tables.push(table);
      const q = {
        where: () => q,
        orderBy: () => q,
        limit: async () => (table === schema.ledgerHeads ? [{ seq: 20_001 }] : []),
      };
      return q;
    },
  }));
  const db = { select } as unknown as DbOrTx;
  await expect(readWorkspaceLedger(db, "00000000-0000-4000-8000-000000000001")).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
  expect(tables).toEqual([schema.ledgerHeads]);
});
