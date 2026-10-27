// src/routes/lines: owned by the RUNS slice (apps/api/SPLIT.md).
// Line actions: pay in cash (cancel UNCLAIMED), re-route (P1).
// IC-01 commands here: payCash, resend (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "lines",
  commands: {
    payCash: notImplemented,
    resend: notImplemented,
  },
});
