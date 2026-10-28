// src/routes/slips: owned by the RUNS slice (apps/api/SPLIT.md).
// Slip capture (Content-Digest + Idempotency-Key are enforced by the shell before the handler runs) and the
// extraction dispatch to apps/tasks through the outbox (an `extract` row in the capture's transaction, I7).
import { defineRouteFolder } from "../../lib/slice.js";
import { captureHandler } from "../../runs/capture.js";

export default defineRouteFolder({
  folder: "slips",
  commands: {
    capture: captureHandler,
  },
});
