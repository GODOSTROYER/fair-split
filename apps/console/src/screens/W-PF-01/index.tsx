// W-PF-01 Proof (`/proof/:runSlug`; public, Adlaw only, one 680 px column). Members appear by ID only, never by
// name (C-23, RA 10173). Everything on the page is computed from the served bundle and re-checked in this browser
// on a person's press ("Verify in your browser", verify-core against the published keys). The route's data-state
// follows the run's record (none, progress, verified, failed); the browser check's own state is `data-verify`.

import { useMotionMode } from "@fairsplit/ui-web";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { usePaypalRail } from "../../data/hooks.js";
import { ProofView, proofState, verifyAttr } from "../../features/proof/ProofView.js";
import { usePublicProof } from "../../features/proof/usePublicProof.js";
import { useVerification } from "../../features/proof/useVerification.js";
import type { ProofScreenProps } from "../contract.js";
import "../../features/proof/proof.css";

export function Screen({ runSlug }: ProofScreenProps) {
  const page = usePublicProof(runSlug);
  const verification = useVerification(page.bundle, runSlug);
  // Until the API names its rail, PayPal is labelled simulated: never "live" by default (I8, ADR-0002).
  const rail = usePaypalRail() ?? "simulator";
  const motion = useMotionMode();
  return (
    <ScreenRoot id="W-PF-01" state={proofState(page, verification)} as="main" className="pf">
      <div className="pf-page" data-verify={verifyAttr(verification)} data-motion={motion} data-rail={rail}>
        <ProofView page={page} verification={verification} rail={rail} />
      </div>
    </ScreenRoot>
  );
}
