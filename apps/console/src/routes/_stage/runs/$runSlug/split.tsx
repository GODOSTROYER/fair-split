import { SCREENS } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../../../chrome/Fallbacks.js";
import { splitSearch } from "../../../../lib/route-params.js";
import { Screen as SplitReview } from "../../../../screens/W-TR-05/index.js";
import { Screen as HoldDrawer } from "../../../../screens/W-TR-06/index.js";
import { Screen as MemberLine } from "../../../../screens/W-TR-09/index.js";

// W-TR-05 Split review; `?hold=H1` opens W-TR-06 (the hold drawer) and `?member=M-014` opens W-TR-09 (the
// member line) beside it (register §4). The split screen hears both so it can make room (S1.6 drawers).
export const Route = createFileRoute("/_stage/runs/$runSlug/split")({
  validateSearch: splitSearch,
  component: function SplitRoute() {
    const { runSlug } = Route.useParams();
    const { hold, member } = Route.useSearch();
    useDocumentTitle(hold ? `${SCREENS["W-TR-06"].name} ${hold}` : SCREENS["W-TR-05"].name);
    return (
      <>
        <SplitReview runSlug={runSlug} hold={hold} member={member} />
        {hold && <HoldDrawer runSlug={runSlug} holdId={hold} />}
        {member && !hold && <MemberLine runSlug={runSlug} memberNo={member} />}
      </>
    );
  },
});
