// src/routes/print: owned by the PROOF slice (apps/api/SPLIT.md).
// 80 mm print data for cash members (W-TR-09).
// No IC-01 command lives here yet; add extra routes with `routes: (r) => r.route(…)`.
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "print",
  commands: {},
});
