// W-OP-01 /ops: health, the kill switches, PayPal (scopes, the limiter and circuit, webhook latency, the last
// reconciliation, the balance), PayPal's notices, the outbox, Claude (spend, eval), quotas and the treasurer key
// (S3.15). Read-only for judges: only the operator's session makes or registers the key. `data-state` is "loading"
// until both health reads answer, "ready" only when liveness is up and readiness says ready, and "degraded"
// otherwise, readiness the API doesn't serve included (unknown is not ready).

import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { usePaypalRail } from "../../data/hooks.js";
import { OpsPage } from "../../features/ops/OpsPage.js";
import { opsVerdict } from "../../features/ops/opsModel.js";
import { useHealth, useOperator, useTreasurerKey } from "../../features/ops/useOps.js";
import type { OpsScreenProps } from "../contract.js";
import "../../features/ops/ops.css";

export function Screen(_props: OpsScreenProps) {
  const rail = usePaypalRail() ?? "simulator";
  const health = useHealth();
  const { operator } = useOperator();
  // Nothing touches WebCrypto or IndexedDB unless the operator is signed in.
  const treasurerKey = useTreasurerKey({ enabled: operator });
  const verdict = opsVerdict(health.live, health.ready);
  return (
    <ScreenRoot id="W-OP-01" state={verdict.state} as="main" labelledBy="W-OP-01-title" className="op-root">
      <OpsPage rail={rail} treasurerKey={treasurerKey} operator={operator} verdict={verdict} />
    </ScreenRoot>
  );
}
