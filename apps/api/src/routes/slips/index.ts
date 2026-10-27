// src/routes/slips: owned by the RUNS slice (apps/api/SPLIT.md).
// Slip capture (Content-Digest + Idempotency-Key are enforced by the shell before the handler runs) and extraction dispatch to apps/tasks through the outbox.
// IC-01 commands here: capture (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "slips",
  commands: {
    capture: notImplemented,
  },
});
