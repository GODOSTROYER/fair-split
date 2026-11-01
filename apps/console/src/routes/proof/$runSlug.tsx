import { webRoutes } from "@fairsplit/contracts";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useDocumentTitle } from "../../chrome/Fallbacks.js";
import { Surface } from "../../chrome/Surface.js";
import { useJudgeSession } from "../../data/hooks.js";
import { snapshotQuery } from "../../data/query.js";
import { ProofAutoplay } from "../../features/judge/ProofAutoplay.js";
import { requireRunSlug } from "../../lib/route-params.js";
import { Screen } from "../../screens/W-PF-01/index.js";

// W-PF-01 Proof (public, Adlaw only, one 680 px column). W-BR-01's brand header joins it for the brand tier.
export const Route = createFileRoute("/proof/$runSlug")({
  beforeLoad: ({ params }) => requireRunSlug(params.runSlug),
  // The seed (85 KB gz) is fetched beside the page, never before it: Proof's own read starts at once, and the
  // seeded figures fill in when it lands (S2.11's Proof budget; the page treats the snapshot as optional).
  loader: ({ context }) => {
    void context.runtime.client.prefetchQuery(snapshotQuery(context.runtime.adapter));
  },
  component: function ProofRoute() {
    const { runSlug } = Route.useParams();
    const { session } = useJudgeSession();
    useDocumentTitle(`Proof ${runSlug}`);
    return (
      <Surface theme="adlaw" face="proof" className="fsc-surface fsc-surface--proof">
        {session?.runSlug === runSlug && (
          <nav aria-label="Judge stage" className="pf-page">
            <Link to={webRoutes.judge()} className="fs-link fs-t-label">
              Back to the stage
            </Link>
          </nav>
        )}
        <Screen runSlug={runSlug} />
        <ProofAutoplay runSlug={runSlug} />
      </Surface>
    );
  },
});
