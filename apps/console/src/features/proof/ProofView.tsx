import { PAYOUT_REPLAY_NOTE, payoutReplayed, payoutReplaySummary } from "../../data/payout-replay.js";
// The Proof column (S1.8 P1, design §6), shared by W-PF-01 and the brand view W-BR-01: the hero and its Verify,
// the six-plate chain, where the money went, the plot field and the footers. One 680 px reading column on Adlaw;
// every state is drawn: loading (print beds at their final size), error, none, progress, verified and failed.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { useEffect, useMemo, useRef } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { useAnnounce } from "../../lib/announce.js";
import type { PaypalRail } from "../../lib/env.js";
import { Chain } from "./Chain.js";
import { FAILURE_PLACE, FOOTER_COPY, PLATE_TITLE, provenanceWords, railName, STATE_COPY, t } from "./copy.js";
import { Figures } from "./Figures.js";
import { ProofHero } from "./Hero.js";
import { type MemberLabel, shortRuleName } from "./Lines.js";
import { isSettled } from "./model.js";
import { PlotField } from "./PlotField.js";
import type { ProofPage } from "./useProof.js";
import type { Verification } from "./useVerification.js";
import { PLATES } from "./verify.js";

/** W-PF-01's `data-state` (S1.8): none, progress, verified, failed; plus the shell's loading and error. */
export type ProofState = "loading" | "error" | "none" | "progress" | "verified" | "failed";

/**
 * The route's state. "Verified" is earned, never assumed: a person pressed Verify, every check in this browser
 * came back "Matches" against keys that are not samples, and PayPal has finished with the run (S1.8). Until then
 * the page is "progress", including a settled run nobody has checked yet and a check that read "Sample" or
 * checked five plates of six ("partial"). `data-verify` carries the check's own state for both.
 */
export function proofState(
  page: Pick<ProofPage, "phase" | "progress">,
  verification: Verification,
): ProofState {
  if (page.phase !== "ready") return page.phase;
  const v = verification.state;
  if (v.kind === "done" && v.outcome.verdict === "failed") return "failed";
  if (v.kind === "done" && v.outcome.verdict === "verified" && isSettled(page.progress)) return "verified";
  return "progress";
}

/** The browser check's own state, on the page root as `data-verify` (S1.8's states describe the run's record). */
export function verifyAttr(verification: Verification): string {
  const v = verification.state;
  if (v.kind === "done") return v.outcome.verdict;
  if (v.kind === "idle") return v.stale ? "stale" : "idle";
  return v.kind;
}

export interface ProofViewProps {
  readonly page: ProofPage;
  readonly verification: Verification;
  readonly rail: PaypalRail;
  /** The brand's view only: names and masked receivers under the data-sharing agreement (C-23). */
  readonly names?: ReadonlyMap<string, MemberLabel> | null;
  /** h1 on Proof; h2 under the brand view's strip, which carries the page's h1. */
  readonly level?: "h1" | "h2";
}

function slipsOf(snapshot: SeasonSnapshot | undefined) {
  return new Map((snapshot?.slips ?? []).map((s) => [s.serial, s] as const));
}

/**
 * The season as people read it ("2026-A") from the card's code ("2026A"), as the seed labels it: the hero's
 * sentence reads the same before the seed lands and after, so it never re-wraps.
 */
export function seasonLabelOf(code: string): string {
  return /^\d{4}[A-Z]$/.test(code) ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

function marksOf(snapshot: SeasonSnapshot | undefined) {
  const marks = new Map<string, string>();
  for (const slip of snapshot?.slips ?? []) for (const m of slip.marks) marks.set(m.markId, m.text);
  return marks;
}

export function ProofView({ page, verification, rail, names = null, level = "h1" }: ProofViewProps) {
  const replayed = page.provenance === "replay" || payoutReplayed(page.runView, null, page.bundle);
  const Heading = level;
  const announce = useAnnounce();
  const { bundle, facts, figures, snapshot } = page;
  const slips = useMemo(() => slipsOf(snapshot), [snapshot]);
  const markNames = useMemo(() => marksOf(snapshot), [snapshot]);
  const ruleNames = useMemo(() => {
    const out = new Map<string, string>();
    for (const term of bundle?.rateCard.canonical.terms ?? []) {
      if (term.kind === "DEDUCTION" && !out.has(term.ruleId)) out.set(term.ruleId, shortRuleName(term.label));
    }
    return out;
  }, [bundle]);

  // Progress is heard as one polite summary per event, throttled by the announcer ("3 of 8 confirmed").
  const lastAnnounced = useRef<string | null>(page.progressEvent);
  useEffect(() => {
    const id = page.progressEvent;
    if (!id || id === lastAnnounced.current || page.progress.total === 0) return;
    lastAnnounced.current = id;
    announce(
      replayed
        ? payoutReplaySummary(page.progress.confirmed, page.progress.total)
        : STATE_COPY.liveSettled(page.progress, rail),
    );
  }, [page.progressEvent, page.progress, announce, rail, replayed]);

  if (page.phase === "loading") return <ProofLoading />;
  if (page.phase === "error") {
    return (
      <div className="pf-state" data-testid="W-PF-01.error">
        <Heading className="pf-state__title">{STATE_COPY.loadFailed}</Heading>
        <CommandNotice error={page.error} testId="W-PF-01.error.notice" onRetry={page.retry} />
      </div>
    );
  }
  if (page.phase === "none" || !bundle || !facts || !figures) {
    const showcase = snapshot && snapshot.run.runSlug !== page.runSlug ? snapshot.run.runSlug : null;
    return (
      <div className="pf-state" data-testid="W-PF-01.none">
        <Glyph name="seal" size={40} />
        <Heading className="pf-state__title">
          {page.notPosted ? STATE_COPY.notPosted : STATE_COPY.none}
        </Heading>
        <p className="pf-state__lede">{STATE_COPY.noneHint}</p>
        {showcase && (
          <AppLink href={`/proof/${showcase}`} className="fs-flat" data-testid="W-PF-01.none.showcase">
            <Glyph name="seal" size={18} />
            {STATE_COPY.showcase}
          </AppLink>
        )}
      </div>
    );
  }

  const state = proofState(page, verification);
  const failure = verification.state.kind === "done" ? verification.state.outcome.failure : null;
  const settled = isSettled(page.progress);
  return (
    <>
      {failure && (
        <div className="pf-withheld" role="alert" data-testid="W-PF-01.withheld">
          <Glyph name="ms:close" size={20} />
          <div>
            <p className="pf-withheld__title">{STATE_COPY.withheldTitle}</p>
            <p className="pf-withheld__where">
              {failure.where === "chain" || failure.where === "checkpoint"
                ? FAILURE_PLACE[failure.where]
                : `Plate ${PLATES.indexOf(failure.where) + 1}, ${t(PLATE_TITLE[failure.where])}`}
              : {failure.reason}
            </p>
          </div>
        </div>
      )}
      <ProofHero
        bundle={bundle}
        seasonLabel={snapshot?.season.label ?? seasonLabelOf(bundle.rateCard.canonical.season)}
        lotCode={snapshot?.lot.lotCode ?? null}
        rail={rail}
        verification={verification}
        level={level}
        status={
          <p
            className="pf-progress"
            data-state={settled ? "settled" : "progress"}
            data-testid="W-PF-01.progress"
          >
            <Glyph name={settled ? "seal-fill" : "rail"} size={16} />
            <span>
              {replayed
                ? payoutReplaySummary(page.progress.confirmed, page.progress.total)
                : settled
                  ? STATE_COPY.liveSettled(page.progress, rail)
                  : STATE_COPY.liveProgress(page.progress, rail)}
            </span>
            <span className="pf-progress__source">
              {page.live ? STATE_COPY.sourceSession : STATE_COPY.sourcePublic}
            </span>
          </p>
        }
      />
      <Chain
        bundle={bundle}
        facts={facts}
        items={page.items}
        lineStates={page.lineStates}
        progress={page.progress}
        verify={verification.state}
        rail={rail}
        provenance={replayed ? "replay" : page.provenance}
        replayed={replayed}
        slips={slips}
        ruleNames={ruleNames}
        markNames={markNames}
        names={names}
      />
      {state === "failed" ? (
        <section className="pf-figures" data-testid="W-PF-01.figures.withheld">
          <h2 className="pf-section__title">Where the money went</h2>
          <p className="pf-figures__withheld">{STATE_COPY.withheldFigures}</p>
        </section>
      ) : (
        <Figures
          bundle={bundle}
          figures={figures}
          items={page.items}
          lineStates={page.lineStates}
          replayed={replayed}
          rail={rail}
          progressEvent={page.progressEvent}
          fees={page.fees}
        />
      )}
      <PlotField bundle={bundle} />
      <ProofFooter
        rail={rail}
        provenance={replayed ? PAYOUT_REPLAY_NOTE : page.provenance ? provenanceWords(page.provenance) : null}
      />
    </>
  );
}

function ProofLoading() {
  return (
    <div className="pf-loading" data-testid="W-PF-01.loading" aria-busy="true">
      <span className="fs-sr">Loading the Proof.</span>
      <div className="pf-loading__hero">
        <PrintBed shape="seal" width={320} height={320} />
        <PrintBed shape="line" width="60%" height={40} />
        <PrintBed shape="line" width="90%" height={68} />
        <PrintBed shape="slab" width={232} height={48} />
      </div>
      <div className="pf-loading__plates">
        <PrintBed shape="plate" count={6} height={72} labels={PLATES.map((p) => t(PLATE_TITLE[p]))} />
      </div>
    </div>
  );
}

function ProofFooter({
  rail,
  provenance,
}: {
  readonly rail: PaypalRail;
  readonly provenance: string | null;
}) {
  return (
    <footer className="pf-footer" data-testid="W-PF-01.footer">
      <p>{FOOTER_COPY.privacy}</p>
      <p>{FOOTER_COPY.recon()}</p>
      <p>{FOOTER_COPY.merchant}</p>
      <p>
        {railName(rail)}.{provenance ? ` This record: ${provenance}.` : ""}
      </p>
      <p className="pf-footer__last">{FOOTER_COPY.sandbox(rail)}</p>
    </footer>
  );
}
