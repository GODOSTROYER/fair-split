// src/routes/season: owned by the RUNS slice (apps/api/SPLIT.md).
// Season reads for W-TR-01 (run strip, figures) and the reading room's slips.
// No IC-01 command lives here yet; add extra routes with `routes: (r) => r.route(…)`.
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "season",
  commands: {},
});
