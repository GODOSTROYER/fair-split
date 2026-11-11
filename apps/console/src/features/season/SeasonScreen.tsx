// W-TR-01 Season (S1.7, design §6 C1): the season mark, the run strip from ratified to paid, the
// invoice Claude drafted and code checked beside the pool it funds, the desk of photos to read and the eval
// waffle. MM-S plays here when the invoice reads back as paid; the next human step is one linked sentence.
// Everything is the stage's run: the first view before the first press, then the judge's session. UI gate round 4:
// on the one twelve-column grid, top-aligned; Paid never lights while cash is due at the bodega.

import { webRoutes } from "@fairsplit/contracts";
import { Glyph, HONESTY, LegendGlyph, useT } from "@fairsplit/ui-web";
import { useMemo } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { usePaypalRail, useStageRun } from "../../data/hooks.js";
import { payoutReplayed } from "../../data/payout-replay.js";
import { slipCounts } from "../../lib/display.js";
import { env } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { useNextStep } from "../../stage/context.js";
import { photoIsRead, replayPhotos } from "../reading/model.js";
import { FIRST_VIEW_COPY, SEASON_COPY, SEASON_STATE_COPY } from "./copy.js";
import { FundingBlock, useFundingMoment } from "./funding.js";
import { gateBeds, SeasonGate } from "./gate.js";
import { nextSentence, type SeasonScreenState, seasonState, stripStages } from "./model.js";
import { useOnline } from "./online.js";
import { ContactSheet, EvalWaffle, RunStrip, SeasonMark } from "./parts.js";

export function SeasonScreen({ seasonCode }: { readonly seasonCode: string }) {
  return (
    <SeasonGate id="W-TR-01" seasonCode={seasonCode} beds={gateBeds.season}>
      {() => <Season />}
    </SeasonGate>
  );
}

function stateSentence(
  state: SeasonScreenState,
  status: string | null,
  autoCancelOn: string,
  lastAt: string | null,
): string {
  switch (state) {
    case "unratified":
      return SEASON_STATE_COPY.unratified;
    case "drafted":
      return SEASON_STATE_COPY.drafted;
    case "draft-refused":
      return SEASON_STATE_COPY["draft-refused"];
    case "waiting":
      return SEASON_STATE_COPY.waiting;
    case "unverified":
      return SEASON_STATE_COPY.unverified;
    case "auto-cancelled":
      return SEASON_STATE_COPY.autoCancelled(format.date(autoCancelOn));
    case "offline":
      return SEASON_STATE_COPY.offline(lastAt ? format.time(lastAt) : null);
    case "funded":
      return status === "PAID" ? SEASON_STATE_COPY.fundedPaid : SEASON_STATE_COPY.fundedMarked;
  }
}

function Season() {
  const t = useT();
  const { runSlug, view, inSession, snapshot } = useStageRun();
  const rail = usePaypalRail() ?? env.paypalRail;
  const online = useOnline();
  const moment = useFundingMoment(inSession ? runSlug : null, view);
  const next = useNextStep();
  const readPhotos = useMemo(() => {
    const out = new Set<string>();
    if (!snapshot) return out;
    for (const photo of replayPhotos(snapshot))
      if (photoIsRead({ view, snapshot, photo })) out.add(photo.photoId);
    return out;
  }, [snapshot, view]);
  if (!snapshot) return null;
  const state: SeasonScreenState = seasonState({ view, snapshot, online });
  const sentence = stateSentence(
    state,
    view?.invoice.status ?? null,
    snapshot.run.invoice.autoCancelOn,
    view?.lastEventAt ?? null,
  );
  const season = snapshot.season.label;
  const photos = replayPhotos(snapshot);
  return (
    <ScreenRoot id="W-TR-01" state={state} labelledBy="fsc-season-title" className="fsc-season" grid>
      <header className="fsc-season__head">
        <div className="fsc-season__titles">
          <h1 id="fsc-season-title" className="fsc-season__title">
            <span className="fs-sr">Season </span>
            <SeasonMark snapshot={snapshot} testId="W-TR-01.mark" size="hero" lot coop={false} />
          </h1>
          <p className="fsc-season__coop fs-t-title-2">{t("W-TR-01.coop")}</p>
          {/* The lot's facts as data (round 4), its code already beside the season. */}
          <p className="fsc-season__lede fs-t-caption">
            {SEASON_COPY.lotFacts(
              format.kg(snapshot.lot.shippedG, 0),
              snapshot.lot.buyer,
              snapshot.lot.sacks,
            )}
          </p>
        </div>
        {next && next.actor !== "done" && (
          <p className="fsc-season__next" data-testid="W-TR-01.next" data-actor={next.actor}>
            <span className="fsc-season__next-word fs-t-caption">{SEASON_COPY.next}</span>
            <AppLink href={next.to} className="fsc-season__next-link fs-t-label">
              <span className="fsc-season__next-mark" aria-hidden />
              {nextSentence(next.text)}
            </AppLink>
          </p>
        )}
      </header>

      <div className="fsc-season__run">
        <RunStrip
          stages={stripStages(view, snapshot)}
          ratifiedOn={snapshot.rateCard.canonical.ratifiedOn}
          replayed={payoutReplayed(view)}
          testId="W-TR-01.strip"
        />

        <p
          className="fsc-season__state fs-t-label"
          role="status"
          data-state={state}
          data-testid="W-TR-01.state"
        >
          <Glyph
            name={state === "funded" ? "ms:check" : state === "offline" ? "ms:wifi-off" : "hanging-scale"}
            size={16}
          />
          <span>{sentence}</span>
        </p>
      </div>

      <FundingBlock
        snapshot={snapshot}
        view={view}
        moment={moment}
        rail={rail}
        layout="row"
        screen="W-TR-01"
      />

      <div className="fsc-season__lower">
        <section className="fsc-season__desk" aria-labelledby="fsc-season-photos">
          {/* The desk's head as on the first view (round 4): "Slips", the counts with their scope, the synthetic
              mark (its words are its tooltip and name). */}
          <header className="fsc-season__desk-head">
            <h2 id="fsc-season-photos" className="fsc-section-title fs-t-label">
              {FIRST_VIEW_COPY.desk}
            </h2>
            <span className="fs-t-caption fsc-season__muted">
              {FIRST_VIEW_COPY.slipsMicro(photos.length, slipCounts(snapshot).text)}
            </span>
            <LegendGlyph {...HONESTY.syntheticSample} />
          </header>
          <ContactSheet
            snapshot={snapshot}
            photos={photos}
            readPhotos={readPhotos}
            hrefFor={(photo) => webRoutes.reading(season, photo)}
            testId="W-TR-01.photos"
            columns={6}
          />
        </section>
        <EvalWaffle cases={null} testId="W-TR-01.eval" />
      </div>
    </ScreenRoot>
  );
}
