// src/routes/runs: owned by the RUNS slice (apps/api/SPLIT.md).
// The run state machine (compare-and-set), quote → invoice → funding through an AgentMoneyPort over paypal-toolkit and paypal-payouts, kill-switch flags, settle GET scheduling.
// IC-01 commands here: markPaid, setFlag (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "runs",
  commands: {
    markPaid: notImplemented,
    setFlag: notImplemented,
  },
});
