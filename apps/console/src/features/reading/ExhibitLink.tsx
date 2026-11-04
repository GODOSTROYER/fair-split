import { webRoutes } from "@fairsplit/contracts";
import { useNavigate } from "@tanstack/react-router";
import { focusAndReveal } from "../../lib/focus.js";

export function ExhibitLink({ season }: { readonly season: string }) {
  const navigate = useNavigate();
  return (
    <a
      className="fs-link fs-t-caption"
      href={`${webRoutes.reading(season)}#fsc-heroes-title`}
      onClick={async (event) => {
        event.preventDefault();
        if (!document.getElementById("fsc-heroes-title")) await navigate({ to: webRoutes.reading(season) });
        const heading = document.getElementById("fsc-heroes-title");
        if (heading) focusAndReveal(heading);
      }}
    >
      Claude's real readings of 10 hero slips, recorded 1 Nov 2026. Open the exhibit
    </a>
  );
}
