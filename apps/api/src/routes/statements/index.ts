// src/routes/statements: owned by the PROOF slice (apps/api/SPLIT.md).
// Statements (StatementPlan + a pure renderStatement for display, spoken and SMS) and the member's review request ("Ipasusi pag-usab").
// IC-01 commands here: createReviewRequest (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "statements",
  commands: {
    createReviewRequest: notImplemented,
  },
});
