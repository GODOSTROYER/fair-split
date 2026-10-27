import { createFileRoute, notFound } from "@tanstack/react-router";
import { CompositionPage } from "../../../prototype/pages/Compositions.js";
import { COMPOSITIONS, type CompositionId } from "../../../prototype/search.js";

export const Route = createFileRoute("/prototype/compositions/$composition")({
  beforeLoad: ({ params }) => {
    if (!COMPOSITIONS.some((c) => c.id === params.composition)) throw notFound();
  },
  component: function Composition() {
    const { composition } = Route.useParams();
    return <CompositionPage id={composition as CompositionId} />;
  },
});
