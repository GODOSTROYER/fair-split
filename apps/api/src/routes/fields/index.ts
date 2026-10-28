// src/routes/fields: owned by the RUNS slice (apps/api/SPLIT.md).
// By-hand fields (slip 0462): code derives the rest and recomputes; an edit after key 1 voids both approvals.
import { defineRouteFolder } from "../../lib/slice.js";
import { enterFieldHandler } from "../../runs/fields.js";

export default defineRouteFolder({
  folder: "fields",
  commands: {
    enterField: enterFieldHandler,
  },
});
