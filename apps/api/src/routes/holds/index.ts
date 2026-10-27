// src/routes/holds: owned by the RUNS slice (apps/api/SPLIT.md).
// Hold resolution (H1–H3, by-hand, mass balance).
// IC-01 commands here: resolveHold (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "holds",
  commands: {
    resolveHold: notImplemented,
  },
});
