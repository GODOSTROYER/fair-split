// src/routes/judge: owned by the JUDGE slice (apps/api/SPLIT.md).
// Judge sessions (cookie 24 h, pooled workspace clone, runSeq block, Reset ~10 s), quotas (single-flight live lane with a visible queue, the daily-post formula, 3 per cookie), the labelled "Try to break it" controls, and presence (at most 1 Hz).
// IC-01 commands here: createJudgeSession, presence (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "judge",
  commands: {
    createJudgeSession: notImplemented,
    presence: notImplemented,
  },
});
