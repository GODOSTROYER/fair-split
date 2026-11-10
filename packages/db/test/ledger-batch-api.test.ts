import { expect, it } from "vitest";
import * as ledger from "../src/ledger.js";

it("exports the atomic multi-entry ledger append for cold judge materialization", () => {
  expect(ledger).toHaveProperty("appendLedgerBatch", expect.any(Function));
});
