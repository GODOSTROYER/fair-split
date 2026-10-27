// src/routes/rate-cards: owned by the RUNS slice (apps/api/SPLIT.md).
// Rate-card read and ratify; any edit to a ratified card answers 409 RATE_CARD_RATIFIED citing the hash (MM-4).
// IC-01 commands here: addDeduction (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "rate-cards",
  commands: {
    addDeduction: notImplemented,
  },
});
