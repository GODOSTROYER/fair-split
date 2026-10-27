// src/routes/brand: owned by the PROOF slice (apps/api/SPLIT.md).
// The brand view: names, masked emails, CSV export.
// No IC-01 command lives here yet; add extra routes with `routes: (r) => r.route(…)`.
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "brand",
  commands: {},
});
