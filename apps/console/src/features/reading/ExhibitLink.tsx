import { webRoutes } from "@fairsplit/contracts";
import { useNavigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { focusInto } from "../../lib/focus.js";

const EXHIBIT_TITLE = "fsc-heroes-title";

/** The exhibit's heading, looked up when asked: the reading room may draw it a commit after the route changed. */
const exhibitTitle = () => document.getElementById(EXHIBIT_TITLE);

/** The link's whole name; a shorter face (the first view's) keeps it as the accessible name. */
const EXHIBIT_NAME = "Claude's readings of 10 slips, recorded 1 Nov 2026. Open the exhibit";

export function ExhibitLink({
  season,
  children,
}: {
  readonly season: string;
  /** A shorter visible face, a prefix of the whole name (WCAG 2.5.3). */
  readonly children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <a
      className={children ? "fs-link fs-t-caption" : "fs-link fs-t-label fsc-read__exhibit"}
      href={`${webRoutes.reading(season)}#${EXHIBIT_TITLE}`}
      aria-label={children ? EXHIBIT_NAME : undefined}
      title="Recorded 1 Nov 2026. Open the exhibit"
      onClick={async (event) => {
        event.preventDefault();
        if (!exhibitTitle()) await navigate({ to: webRoutes.reading(season) });
        focusInto(exhibitTitle, exhibitTitle);
      }}
    >
      {children ?? (
        <>
          Claude's readings of 10 slips
          <span className="fs-sr">, recorded 1 Nov 2026. Open the exhibit</span>
        </>
      )}
    </a>
  );
}
