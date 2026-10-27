// src/routes/fields: owned by the RUNS slice (apps/api/SPLIT.md).
// By-hand fields (slip 0462); an edit after key 1 voids both approvals.
// IC-01 commands here: enterField (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "fields",
  commands: {
    enterField: notImplemented,
  },
});
