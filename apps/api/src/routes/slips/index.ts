// src/routes/slips: owned by the RUNS slice (apps/api/SPLIT.md).
// Slip capture (Content-Digest + Idempotency-Key are enforced by the shell before the handler runs) and the
// extraction dispatch through the outbox (an `extract` row in the capture's or the funding's transaction, I7).
// The `extract` task runs inline here: a seeded workspace's replay photos are read from the seed as a labelled
// stand-in (runs/extract.ts); a live reader is not built in this build.
import { defineRouteFolder } from "../../lib/slice.js";
import { captureHandler } from "../../runs/capture.js";
import { extractTask } from "../../runs/extract.js";

export default defineRouteFolder({
  folder: "slips",
  commands: {
    capture: captureHandler,
  },
  tasks: (deps) => ({ extract: extractTask(deps) }),
});
