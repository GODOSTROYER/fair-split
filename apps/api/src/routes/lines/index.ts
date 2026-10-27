// src/routes/lines: owned by the RUNS slice (apps/api/SPLIT.md).
// Line actions: pay in cash (cancel an UNCLAIMED item, then OFF_RAIL_DUE) and the P1 re-route (`resend`),
// with their outbox tasks (`cancelUnclaimed`, `reroute`).
import { defineRouteFolder } from "../../lib/slice.js";
import { payCashHandler } from "../../runs/paypal.js";
import { rerouteTasks, resendHandler } from "../../runs/reroute.js";
import { lineTasks } from "../../runs/tasks.js";

export default defineRouteFolder({
  folder: "lines",
  commands: {
    payCash: payCashHandler,
    resend: resendHandler,
  },
  tasks: (deps) => ({ ...lineTasks(deps), ...rerouteTasks(deps) }),
});
