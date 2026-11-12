// W-TR-05 Split review (S1.7, design §6 C5): every member's line in one grid, on the engine computation the
// run's decisions match. The title row says the review's state in one chip and the run once (round 5). The bench
// under it holds the shrink dial, the pool (the screen's money, in pencil until the keys turn) and the next
// decision; the filters run beneath it. The lines a person must still decide are pinned above the rest and the
// totals beneath, and the lines between rest on whole rows (round 5: nothing half-hidden under the total). `?hold=`
// opens W-TR-06 beside it and `?member=` opens W-TR-09; the route renders those, this screen marks their row.

import { webRoutes } from "@fairsplit/contracts";
import { Chip, Glyph } from "@fairsplit/ui-web";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PROVENANCE } from "../../chrome/copy.js";
import { RunRouteGate } from "../../chrome/Fallbacks.js";
import { cashStillDue } from "../../chrome/next-step.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenHead } from "../../chrome/ScreenGrid.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { payoutReplayed } from "../../data/payout-replay.js";
import { type ScheduleRuleId, shortRules } from "../../features/ratecard/model.js";
import { type GridContext, statusLabel } from "../../features/split/cells.js";
import {
  basisEventId,
  decisionRows,
  engineOutput,
  filterCounts,
  filterRows,
  hasLines,
  massBalanceView,
  openCounts,
  type SplitFilter,
  type SplitRow,
  splitBasis,
  splitRows,
  splitTotals,
} from "../../features/split/model.js";
import { SplitGrid } from "../../features/split/SplitGrid.js";
import { Reconcile, SplitHeader } from "../../features/split/SplitHeader.js";
import { SPLIT } from "../../features/split/shared/copy.js";
import { stampFor } from "../../features/split/shared/people.js";
import { useLiveEvents, useRunData } from "../../features/split/shared/run-data.js";
import { waveDelays } from "../../features/split/wave.js";
import { runLabel, seasonLabel } from "../../lib/display.js";
import { format } from "../../lib/format.js";
import type { ScreenState } from "../../lib/screens.js";
import type { SplitScreenProps } from "../contract.js";
import "../../features/split/shared/runs.css";
import "../../features/split/split.css";

/** States after which the grid's statuses come from the simulated PayPal sandbox (the batch has posted). */
const POSTED = ["APPROVED", "POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED", "CLOSED"];

export function Screen({ runSlug, hold, member, receiptRef }: SplitScreenProps) {
  const router = useRouter();
  const data = useRunData(runSlug);
  const live = useLiveEvents(data.live ? runSlug : null);
  const [filter, setFilter] = useState<SplitFilter>("all");
  const [allColumns, setAllColumns] = useState(false);
  const { snapshot, view } = data;
  const replayed = payoutReplayed(view);

  // A line that did not change keeps its object, so the grid redraws only the lines an event moved.
  const previous = useRef(new Map<string, { readonly key: string; readonly row: SplitRow }>());
  const rows = useMemo(() => {
    const next = snapshot && view ? splitRows(snapshot, view) : [];
    const kept = new Map<string, { readonly key: string; readonly row: SplitRow }>();
    const out = next.map((row) => {
      const key = JSON.stringify(row);
      const prior = previous.current.get(row.memberNo);
      const stable = prior && prior.key === key ? prior.row : row;
      kept.set(row.memberNo, { key, row: stable });
      return stable;
    });
    previous.current = kept;
    return out;
  }, [snapshot, view, replayed]);
  // Every line: the open decisions pinned on top, the rest beneath. A filter shows its lines in member order.
  const decisions = useMemo(() => (filter === "all" ? decisionRows(rows) : []), [rows, filter]);
  const shown = useMemo(() => {
    const pinned = new Set(decisions.map((r) => r.memberNo));
    return filterRows(rows, filter).filter((r) => !pinned.has(r.memberNo));
  }, [rows, filter, decisions]);
  const totals = useMemo(
    () => (snapshot && view ? splitTotals(snapshot, view, rows) : null),
    [snapshot, view, rows],
  );
  // The wave runs down the lines as they stand on screen: the pinned decisions first, then the rest.
  const waves = useMemo(
    () =>
      snapshot && view ? waveDelays(snapshot, view, [...decisions, ...shown]) : new Map<string, number>(),
    [snapshot, view, decisions, shown],
  );

  // Each slip copy by serial and copy, so the slips cell crops the real sheet.
  const sheets = useMemo(
    () => new Map((snapshot?.slips ?? []).map((s) => [`${s.serial}|${s.copy}`, s] as const)),
    [snapshot],
  );
  const context = useMemo<GridContext | null>(() => {
    if (!snapshot) return null;
    const limit = snapshot.rateCard.canonical.rules.tolerances.kgPerTreeMaxG;
    // A deduction chip reads "CBU −1.37" (round 5): its rule's id and words are its title, from the card's own terms.
    const rules = shortRules(snapshot.rateCard);
    return {
      ruleText: (ruleId: string) => rules[ruleId as ScheduleRuleId],
      isLive: live.isLive,
      waveDelay: (memberNo) => waves.get(memberNo) ?? 0,
      stamp: (by, at) => stampFor(snapshot, by, at),
      yieldLimit: format.kgNumber(limit, 1),
      premiumRate: snapshot.figures.display.premiumRate ?? "",
      slip: (serial, copy) => sheets.get(`${serial}|${copy}`),
    };
  }, [snapshot, live, waves, sheets]);

  const openRow = useCallback(
    (row: SplitRow) => {
      if (!snapshot) return;
      const target = row.openHold;
      if (target?.kind === "LOW_CONFIDENCE") {
        const serial =
          row.confidence.kind === "you" && row.confidence.serial
            ? row.confidence.serial
            : (snapshot.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.serials[0] ?? null);
        if (serial) {
          router.history.push(webRoutes.byHand(snapshot.season.label, serial));
          return;
        }
      }
      router.history.push(
        target ? webRoutes.holdDrawer(runSlug, target.label) : webRoutes.memberLine(runSlug, row.memberNo),
      );
    },
    [router, runSlug, snapshot],
  );

  const openMember = useMemo(() => {
    if (member) return member;
    if (!hold || !view) return null;
    const found = Object.values(view.holds).find((h) => h.label === hold || h.holdId === hold);
    return found?.memberNo ?? null;
  }, [hold, member, view]);

  if (data.access === "missing") return <RunRouteGate data={data} />;

  let state: ScreenState<"W-TR-05">;
  if (data.error && !view) state = "error";
  else if (data.loading || !snapshot || !view) state = "loading";
  else if (view.state === "DENIED") state = "declined";
  else if (!hasLines(view)) state = "empty";
  else state = "ready";

  const season = snapshot ? seasonLabel(snapshot.season.label) : null;
  const posted = view ? POSTED.includes(view.state) : false;
  // The grid holds simulated PayPal statuses (posted, or any line already with the rail): the id line's one phrase
  // says so (round 5: provenance once, no glyph), and the rows' words carry it for screen readers.
  const simulated = posted || rows.some((r) => statusLabel(r) !== null);
  const lined = Boolean(snapshot && view && hasLines(view));
  const open = view ? openCounts(view) : { holds: 0, byHand: 0 };
  const cashDue = view && snapshot ? cashStillDue(view, snapshot.figures.cashMembers) : false;
  // The title row (round 5): a noun with the season in grey, the review's state in one chip on the same row, then
  // one id line: the run id (the one run id everywhere) and the screen's one provenance phrase. The lines, the
  // engine and the rate card's hash are the run id's title.
  const title = (
    <ScreenHead
      title={SPLIT.title}
      suffix={season}
      titleId="W-TR-05-title"
      status={
        lined && view ? (
          <SplitState
            open={open}
            decided={decidedWords(view.state, replayed, cashDue)}
            cashDue={cashDue && !replayed}
          />
        ) : undefined
      }
      meta={
        lined && snapshot && view ? (
          <span
            data-testid="W-TR-05.provenance"
            title={`${SPLIT.provenanceTitle(rows.length, SPLIT.basis[splitBasis(view)])} · ${SPLIT.rateCardWord} ${format.hashGroups(snapshot.rateCard.sha256)}`}
          >
            {runLabel(runSlug).run}
          </span>
        ) : (
          runLabel(runSlug).run
        )
      }
      provenance={lined ? (simulated ? PROVENANCE.simulatedPaypal : PROVENANCE.seededSlips) : undefined}
      testId="W-TR-05.head"
    />
  );

  if (state === "loading" || state === "error") {
    return (
      <ScreenRoot id="W-TR-05" state={state} className="fsr-screen fsr-split" labelledBy="W-TR-05-title" grid>
        {title}
        {state === "error" ? (
          <CommandNotice error={data.error} testId="W-TR-05.error" onRetry={data.retry} />
        ) : (
          <div className="fsr-split__beds" aria-hidden data-testid="W-TR-05.loading">
            <div className="fsr-split__beds-bench">
              <PrintBed shape="seal" width={168} height={132} />
              <PrintBed shape="block" width={220} height={96} />
              <PrintBed shape="block" height={96} />
            </div>
            <PrintBed shape="row" count={12} />
          </div>
        )}
        <p className="fs-sr" role="status">
          {SPLIT.loading}
        </p>
      </ScreenRoot>
    );
  }

  if (!snapshot || !view || !totals || !context) return null;

  if (state === "empty") {
    return (
      <ScreenRoot id="W-TR-05" state="empty" className="fsr-screen fsr-split" labelledBy="W-TR-05-title" grid>
        {title}
        <div className="fsr-empty" data-testid="W-TR-05.empty">
          <span className="fsr-empty__beds" aria-hidden>
            <PrintBed shape="row" count={4} />
          </span>
          <p className="fs-t-title-2">{SPLIT.empty}</p>
          <AppLink href={webRoutes.reading(snapshot.season.label)} className="fs-link fs-t-label">
            {SPLIT.emptyLink}
          </AppLink>
        </div>
      </ScreenRoot>
    );
  }

  const basis = splitBasis(view);
  const dial = massBalanceView(snapshot, view);
  // The reading before the last decision moved it: slip 0457 counted twice, once the by-hand slip is in.
  const was =
    basis === "resolved" ? format.percentBp(engineOutput(snapshot, "byHand").massBalance.shrinkBp) : null;

  return (
    <ScreenRoot id="W-TR-05" state={state} className="fsr-screen fsr-split" labelledBy="W-TR-05-title" grid>
      {title}
      {state === "declined" && (
        <p className="fsr-banner" data-tone="red" role="status" data-testid="W-TR-05.declined">
          {SPLIT.declined}
        </p>
      )}
      {/* Round 8: a decided hold's receipt prints here (W-TR-06 portals into it); empty, it takes no room. */}
      <div ref={receiptRef} className="fsr-split__receipt" data-testid="W-TR-05.receipt" />
      <SplitHeader
        dial={dial}
        swing={live.isLive(basisEventId(view, basis))}
        was={was}
        counts={filterCounts(rows)}
        filter={filter}
        onFilter={setFilter}
        railsPlanned={!posted}
        reconcile={
          <Reconcile
            totals={totals}
            poolState={rows.some((r) => r.partsState === "ink") ? "ink" : "pencil"}
            check={
              <p
                className="fsr-split__totals fs-t-label"
                data-testid="W-TR-05.totals"
                data-balanced={totals.balanced ? "" : undefined}
                title={SPLIT.balancedTitle(format.amount(totals.grossCents))}
              >
                <Glyph name={totals.balanced ? "ms:check" : "ms:help"} size={14} />
                {totals.balanced ? SPLIT.balanced : SPLIT.unbalanced}
              </p>
            }
          />
        }
        columns={
          <button
            type="button"
            className="fsr-columns fs-flat"
            aria-pressed={allColumns}
            aria-label={allColumns ? SPLIT.fewerColumns : SPLIT.allColumns}
            title={allColumns ? SPLIT.fewerColumns : SPLIT.allColumns}
            onClick={() => setAllColumns((v) => !v)}
            data-testid="W-TR-05.allColumns"
          >
            <Glyph name={allColumns ? "ms:expand-less" : "ms:expand-more"} size={18} />
            <span className="fs-t-label" aria-hidden>
              {SPLIT.columns}
            </span>
          </button>
        }
      />
      <SplitGrid
        rows={shown}
        pinned={decisions}
        totals={totals}
        context={context}
        openMember={openMember}
        onOpen={openRow}
        showAll={allColumns}
      />
    </ScreenRoot>
  );
}

/**
 * What the bench says once every hold is decided, by how far the run has gone since. A settled run with cash still
 * due never reads "settled" (round 3): PayPal's part is complete, the cash is not handed over.
 */
export function decidedWords(state: string, replayed = false, cashDue = false): string {
  if (replayed && POSTED.includes(state)) return SPLIT.decidedReplayed;
  if (state === "SETTLED" || state === "CLOSED") return cashDue ? SPLIT.decidedCashDue : SPLIT.decidedSettled;
  if (state === "TREASURER_APPROVED" || state === "AWAITING_BOARD") return SPLIT.decidedKey1;
  if (["APPROVED", "POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP"].includes(state))
    return SPLIT.decidedApproved;
  return SPLIT.allDecided;
}

/**
 * The review's state as the title row's one chip (round 5): the open decisions in amber while a person must still
 * decide, then how far the run has gone, short ("PayPal complete · cash due" in hatch, never "settled" while cash
 * is due). Its full words are `decidedWords`.
 */
function SplitState({
  open,
  decided,
  cashDue,
}: {
  readonly open: { readonly holds: number; readonly byHand: number };
  readonly decided: string;
  readonly cashDue: boolean;
}) {
  if (open.holds + open.byHand > 0) {
    return (
      <Chip tone="canary" glyph="hanging-scale" testId="W-TR-05.summary">
        {SPLIT.summary(open.holds, open.byHand)}
      </Chip>
    );
  }
  const words = decided === SPLIT.allDecided ? decided : decided.replace(`${SPLIT.allDecided} · `, "");
  return (
    <Chip tone={cashDue ? "hatch" : "neutral"} glyph={cashDue ? "cash" : "ms:check"} testId="W-TR-05.summary">
      {words}
    </Chip>
  );
}
