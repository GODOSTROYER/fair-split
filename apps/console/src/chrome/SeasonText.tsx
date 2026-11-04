import { Fragment } from "react";

/** Keep a season's hyphenated code on one line without changing its accessible text. */
export function SeasonText({ text, season }: { readonly text: string; readonly season: string }) {
  return text.split(season).map((part, i) => (
    <Fragment key={`${i}-${part}`}>
      {i > 0 && <span className="fsc-nowrap">{season}</span>}
      {part}
    </Fragment>
  ));
}
