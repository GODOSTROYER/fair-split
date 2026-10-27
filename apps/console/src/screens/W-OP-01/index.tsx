// W-OP-01 /ops: health, the outbox, PayPal's notices, the kill switches and the treasurer's key registration
// (S3.15). Read-only for judges. `data-state` is "ready" or "degraded" (liveness down or readiness not ready), and
// "loading" until the first health read answers.

import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { usePaypalRail } from "../../data/hooks.js";
import { OpsPage } from "../../features/ops/OpsPage.js";
import { opsDegraded } from "../../features/ops/opsModel.js";
import { useHealth, useTreasurerKey } from "../../features/ops/useOps.js";
import type { OpsScreenProps } from "../contract.js";
import "../../features/ops/ops.css";

export function Screen(_props: OpsScreenProps) {
  const rail = usePaypalRail() ?? "simulator";
  const health = useHealth();
  const treasurerKey = useTreasurerKey();
  const state =
    health.live === undefined ? "loading" : opsDegraded(health.live, health.ready) ? "degraded" : "ready";
  return (
    <ScreenRoot id="W-OP-01" state={state} as="main" labelledBy="W-OP-01-title" className="op-root">
      <OpsPage rail={rail} treasurerKey={treasurerKey} />
    </ScreenRoot>
  );
}
