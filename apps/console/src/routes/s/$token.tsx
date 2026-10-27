import { appRoutes } from "@fairsplit/contracts";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { useDocumentTitle } from "../../chrome/Fallbacks.js";

// `/s/:token` is the member's signed link; fs-api answers it with a redirect to `/app/s/:token` before the
// console loads (register §4). If the console sees it anyway (a static preview), it hands over the same way,
// keeping any fragment, and never keeps the token in its own history.
export const Route = createFileRoute("/s/$token")({
  component: function MemberLinkRoute() {
    const { token } = Route.useParams();
    useDocumentTitle("Opening your statement");
    useEffect(() => {
      window.location.replace(`${appRoutes.memberLink(token)}${window.location.hash}`);
    }, [token]);
    return (
      <main className="fsc-fallback" data-testid="member-link">
        <p className="fs-t-title-2">Opening your statement.</p>
      </main>
    );
  },
});
