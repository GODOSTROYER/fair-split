// W-AU-01 Sign in. Real accounts are P2 (plan, "Cut"): judges need no login and the operator uses /ops. The
// shell owns this screen; it is final, not a placeholder.

import { webRoutes } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { AppLink } from "../../chrome/AppLink.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { Wordmark } from "../../chrome/Wordmark.js";

export function Screen() {
  return (
    <ScreenRoot id="W-AU-01" state="not-built" className="fsc-signin" labelledBy="W-AU-01-title" as="main">
      <Wordmark />
      <h1 id="W-AU-01-title" className="fs-t-title-1">
        Sign-in comes with real co-ops.
      </h1>
      <p className="fsc-signin__body">
        This prototype has no accounts. Judges open the Judge stage and act as the treasurer, with a demo key
        made in their browser. The operator uses Ops.
      </p>
      <p className="fsc-signin__links">
        <AppLink href={webRoutes.judge()} className="fs-flat" data-testid="W-AU-01.judge">
          <Glyph name="sack" size={18} />
          Open the Judge stage
        </AppLink>
        <AppLink href={webRoutes.ops()} className="fs-link fs-t-label" data-testid="W-AU-01.ops">
          Ops
        </AppLink>
      </p>
    </ScreenRoot>
  );
}
