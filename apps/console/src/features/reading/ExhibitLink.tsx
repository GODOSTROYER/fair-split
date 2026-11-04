import { webRoutes } from "@fairsplit/contracts";
import { useNavigate } from "@tanstack/react-router";
import { focusInto } from "../../lib/focus.js";

const EXHIBIT_TITLE = "fsc-heroes-title";

/** The exhibit's heading, looked up when asked: the reading room may draw it a commit after the route changed. */
const exhibitTitle = () => document.getElementById(EXHIBIT_TITLE);

export function ExhibitLink({ season }: { readonly season: string }) {
  const navigate = useNavigate();
  return (
    <a
      className="fs-link fs-t-caption"
      href={`${webRoutes.reading(season)}#${EXHIBIT_TITLE}`}
      onClick={async (event) => {
        event.preventDefault();
        if (!exhibitTitle()) await navigate({ to: webRoutes.reading(season) });
        focusInto(exhibitTitle, exhibitTitle);
      }}
    >
      Claude's real readings of 10 hero slips, recorded 1 Nov 2026. Open the exhibit
    </a>
  );
}
