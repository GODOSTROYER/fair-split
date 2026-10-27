// src/routes/wellknown: owned by the PROOF slice (apps/api/SPLIT.md).
// /.well-known/fairsplit-keys.json: officer keys and the ledger key (sample keys flagged so Proof reads Sample).
// No IC-01 command lives here yet; add extra routes with `routes: (r) => r.route(…)`.
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "wellknown",
  commands: {},
});
