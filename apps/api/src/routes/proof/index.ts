// src/routes/proof: owned by the PROOF slice (apps/api/SPLIT.md).
// The Proof bundle (six plates; member IDs only, C-23), tiered by credential (public, member link, brand), and the public aggregate SSE stream via deps.sse.
// IC-01 commands here: proof, proofJson, proofExport (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "proof",
  commands: {
    proof: notImplemented,
    proofJson: notImplemented,
    proofExport: notImplemented,
  },
});
