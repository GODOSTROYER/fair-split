import { createFileRoute, notFound } from "@tanstack/react-router";
import { MomentStudyPage } from "../../../prototype/pages/Moments.js";
import { STUDY_MOMENTS, type StudyMomentId } from "../../../prototype/search.js";

export const Route = createFileRoute("/prototype/moments/$moment")({
  beforeLoad: ({ params }) => {
    if (!STUDY_MOMENTS.some((m) => m.id === params.moment)) throw notFound();
  },
  component: function Moment() {
    const { moment } = Route.useParams();
    return <MomentStudyPage id={moment as StudyMomentId} />;
  },
});
