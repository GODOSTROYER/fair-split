// src/routes/ops: owned by the PROOF slice (apps/api/SPLIT.md).
// /ops endpoints (W-OP-01): health, outbox, webhooks, kill switches, limiter, treasurer web-key registration (fs-analyn-w1), metrics.
// No IC-01 command lives here yet; add extra routes with `routes: (r) => r.route(…)`.
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "ops",
  commands: {},
});
