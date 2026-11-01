// W-TR-05 Split review (S1.7, design §6 C5): every member's line in one grid, on the engine computation the
// run's decisions match. The bench above it holds the mass-balance dial, the pool (the screen's money, in pencil
// until the keys turn, with the engine's provenance and the balance check beneath it), the open decisions and the
// filters. The lines a person must still decide are pinned above the rest; the pinned totals sit on the ribbon,
// so the grid fills the screen and nothing else scrolls. `?hold=` opens W-TR-06 beside it and `?member=` opens
// W-TR-09; the route renders those, this screen marks their row.

import { webRoutes } from "@fairsplit/contracts";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useMemo, useRef, useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PrintBed } from "../../chrome/PrintBed.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { payoutReplayed } from "../../data/payout-replay.js";
import type { GridContext } from "../../features/split/cells.js";
import {
  basisEventId,
  decisionRows,
  engineOutput,
  filterCounts,
  filterRows,
  hasLines,
  massBalanceView,
  nextOpenCard,
  openCounts,
  type SplitFilter,
  type SplitRow,
  splitBasis,
  splitRows,
  splitTotals,
} from "../../features/split/model.js";
import { SplitGrid } from "../../features/split/SplitGrid.js";
import { type NextDecision, SplitHeader } from "../../features/split/SplitHeader.js";
import { en, SPLIT } from "../../features/split/shared/copy.js";
import { stampFor } from "../../features/split/shared/people.js";
import { useLiveEvents, useRunData } from "../../features/split/shared/run-data.js";
import { waveDelays } from "../../features/split/wave.js";
import { format } from "../../lib/format.js";
import { provenanceFooter } from "../../lib/provenance.js";
import type { ScreenState } from "../../lib/screens.js";
import type { SplitScreenProps } from "../contract.js";
import "../../features/split/shared/runs.css";
import "../../features/split/split.css";

const BASIS_NOTE = {
  read: "after reading, before slip 0462 is entered",
  byHand: "after slip 0462 by hand",
  resolved: "with every decision so far",
} as const;

export function Screen({ runSlug, hold, member }: SplitScreenProps) {
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
    const next = snapshot && view ? splitRows(snapshot, view, replayed) : [];
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
    return {
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

  let state: ScreenState<"W-TR-05">;
  if (data.error && !view) state = "error";
  else if (data.loading || !snapshot || !view) state = "loading";
  else if (view.state === "DENIED") state = "declined";
  else if (!hasLines(view)) state = "empty";
  else state = "ready";

  const title = (
    <header className="fsr-screen__head">
      <h1 id="W-TR-05-title" className="fs-t-title-1">
        {en("W-TR-05.title")}
      </h1>
      <p className="fsr-screen__slug fs-t-hash">{runSlug}</p>
    </header>
  );

  if (state === "loading" || state === "error") {
    return (
      <ScreenRoot id="W-TR-05" state={state} className="fsr-screen fsr-split" labelledBy="W-TR-05-title">
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
      <ScreenRoot id="W-TR-05" state="empty" className="fsr-screen fsr-split" labelledBy="W-TR-05-title">
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
  const output = engineOutput(snapshot, basis);
  const dial = massBalanceView(snapshot, view);
  const open = openCounts(view);
  const card = nextOpenCard(view);
  const byHandOpen = Object.values(view.holds).find((h) => h.kind === "LOW_CONFIDENCE" && h.state === "OPEN");
  const byHandSerial = snapshot.holds.find((h) => h.kind === "LOW_CONFIDENCE")?.serials[0] ?? null;
  let next: NextDecision | null = null;
  if (byHandOpen && byHandSerial) {
    next = {
      kind: "by-hand",
      href: webRoutes.byHand(snapshot.season.label, byHandSerial),
      words: SPLIT.byHandNext(byHandSerial),
    };
  } else if (card) {
    const seeded = snapshot.holds.find((h) => h.key === card.key);
    const name = rows.find((r) => r.memberNo === card.memberNo)?.name ?? "";
    next = {
      kind: "hold",
      href: webRoutes.holdDrawer(runSlug, card.label),
      words: SPLIT.nextHold(
        card.label,
        seeded ? holdHeadline(card.kind, seeded.serials[0] ?? "", name) : name,
      ),
    };
  } else if (
    open.holds === 0 &&
    open.byHand === 0 &&
    !["APPROVED", "POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED", "CLOSED"].includes(
      view.state,
    )
  ) {
    next = { kind: "approve", href: webRoutes.approve(runSlug), words: SPLIT.approveLink };
  }

  return (
    <ScreenRoot id="W-TR-05" state={state} className="fsr-screen fsr-split" labelledBy="W-TR-05-title">
      {title}
      {state === "declined" && (
        <p className="fsr-banner" data-tone="red" role="status" data-testid="W-TR-05.declined">
          {SPLIT.declined}
        </p>
      )}
      <SplitHeader
        dial={dial}
        swing={live.isLive(basisEventId(view, basis))}
        pools={{
          premiumCents: output.conservation.premiumPoolCents,
          bonusCents: output.conservation.bonusPoolCents,
          poolCents: output.conservation.poolCents,
          amountState: rows.some((r) => r.partsState === "ink") ? "ink" : "pencil",
        }}
        open={open}
        next={next}
        counts={filterCounts(rows)}
        filter={filter}
        onFilter={setFilter}
        decidedWords={decidedWords(view.state, replayed)}
        proof={
          <div className="fsr-split__foot">
            <p className="fsr-split__totals fs-t-caption" data-testid="W-TR-05.totals">
              <span className="fsr-split__check" data-balanced={totals.balanced ? "" : undefined}>
                {totals.balanced ? SPLIT.balanced : SPLIT.unbalanced}
              </span>{" "}
              {en("W-TR-05.totals", { gross: format.amount(totals.grossCents) })}
            </p>
            <p className="fsr-split__provenance fs-t-caption" data-testid="W-TR-05.provenance">
              {provenanceFooter({ kind: "engine", rateCardSha256: snapshot.rateCard.sha256 })},{" "}
              {BASIS_NOTE[basis]}.
              {view.origin === "showcase" ? ` ${provenanceFooter({ kind: "seeded" })}.` : ""}
            </p>
          </div>
        }
        columns={
          <button
            type="button"
            className="fsr-chip fsr-chip--columns fs-t-label"
            aria-pressed={allColumns}
            onClick={() => setAllColumns((v) => !v)}
            data-testid="W-TR-05.allColumns"
          >
            {allColumns ? SPLIT.fewerColumns : SPLIT.allColumns}
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

/** What the bench says once every hold is decided, by how far the run has gone since. */
export function decidedWords(state: string, replayed = false): string {
  if (
    replayed &&
    ["APPROVED", "POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED", "CLOSED"].includes(state)
  )
    return "Every hold is decided and both keys signed. Payout statuses are replayed (labelled) from an earlier simulated PayPal sandbox run.";
  if (state === "SETTLED" || state === "CLOSED") return SPLIT.decidedSettled;
  if (state === "TREASURER_APPROVED" || state === "AWAITING_BOARD") return SPLIT.decidedKey1;
  if (["APPROVED", "POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP"].includes(state))
    return SPLIT.decidedApproved;
  return SPLIT.allDecided;
}

function holdHeadline(kind: string, serial: string, name: string): string {
  switch (kind) {
    case "DUPLICATE_SLIP":
      return en("W-TR-06.H1.title", { slip: serial });
    case "IMPLAUSIBLE_YIELD":
      return en("W-TR-06.H2.title", { name });
    case "NO_RULE":
      return en("W-TR-06.H3.title", { slip: serial });
    default:
      return name;
  }
}
