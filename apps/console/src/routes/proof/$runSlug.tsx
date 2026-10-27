import { createFileRoute } from "@tanstack/react-router";
import { useDocumentTitle } from "../../chrome/Fallbacks.js";
import { Surface } from "../../chrome/Surface.js";
import { snapshotQuery } from "../../data/query.js";
import { requireRunSlug } from "../../lib/route-params.js";
import { Screen } from "../../screens/W-PF-01/index.js";

// W-PF-01 Proof (public, Adlaw only, one 680 px column). W-BR-01's brand header joins it for the brand tier.
export const Route = createFileRoute("/proof/$runSlug")({
  beforeLoad: ({ params }) => requireRunSlug(params.runSlug),
  loader: ({ context }) => context.runtime.client.ensureQueryData(snapshotQuery(context.runtime.adapter)),
  component: function ProofRoute() {
    const { runSlug } = Route.useParams();
    useDocumentTitle(`Proof ${runSlug}`);
    return (
      <Surface theme="adlaw" className="fsc-surface fsc-surface--proof">
        <Screen runSlug={runSlug} />
      </Surface>
    );
  },
});
