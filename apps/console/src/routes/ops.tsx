import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../chrome/Fallbacks.js";
import { Surface } from "../chrome/Surface.js";
import { Screen } from "../screens/W-OP-01/index.js";

// W-OP-01 /ops: health, outbox, PayPal notices and kill switches; read-only for judges (register §4).
export const Route = createFileRoute("/ops")({
  component: function OpsRoute() {
    useDocumentTitle(SCREENS["W-OP-01"].name);
    return (
      <Surface theme="tablea" className="fsc-surface fsc-surface--ops">
        <Screen />
      </Surface>
    );
  },
});
