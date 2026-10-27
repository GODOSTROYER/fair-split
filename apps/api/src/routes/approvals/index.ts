// src/routes/approvals: owned by the RUNS slice (apps/api/SPLIT.md).
// Two keys: the payload returns the items; verify against device_keys with distinct keys and approvers, a used-nonce store and exp within 30 minutes.
// IC-01 commands here: approvalPayload, submitApproval, declineApproval (each answers 501 NOT_IMPLEMENTED until filled in).
// Replace `notImplemented` with a handler; the shell validates input, credentials and the response contract.
import { notImplemented } from "../../lib/command.js";
import { defineRouteFolder } from "../../lib/slice.js";

export default defineRouteFolder({
  folder: "approvals",
  commands: {
    approvalPayload: notImplemented,
    submitApproval: notImplemented,
    declineApproval: notImplemented,
  },
});
