// W-TR-02 Rate card (S1.7, design §6 C2): BR 2026-04's pages as paper on the left, Schedule A printed flat on
// the right, and the hash plate bolted beneath it. "Add a deduction" opens a row whose commit is the bolted
// slab "Add to Schedule A" (MM-4 Bolted): the press goes to the API, and the 409 RATE_CARD_RATIFIED it answers
// is the evidence. Only then does the slab shake (it never travels), the clack play and the refusal plate print
// the hash the 409 carried. Round 5: each column scrolls on its own (nothing ends at the panel's edge); the refusal
// leads its column, the clause that refuses it banded on the board's page; next season's proposal is a secondary
// (unhashed, not in force); and the board's resolution folds away from the title row. Rules before facts (I2): not
// even the treasurer can change the card mid-season.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { Chip, Glyph, Print, Slab, useMotionMode, useT } from "@fairsplit/ui-web";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { PROVENANCE } from "../../chrome/copy.js";
import { Cell, ScreenHead } from "../../chrome/ScreenGrid.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
import { SnapScroll } from "../../chrome/SnapScroll.js";
import { asRateCardRatified, isApiClientError } from "../../data/errors.js";
import { useAdapter, useCommand, useJudgeSession } from "../../data/hooks.js";
import { useAnnounce } from "../../lib/announce.js";
import { seasonLabel } from "../../lib/display.js";
import { focusAndReveal } from "../../lib/focus.js";
import { format } from "../../lib/format.js";
import { useMoment } from "../../lib/moment.js";
import { CLAUDE_MODEL } from "../../lib/provenance.js";
import { isRatified } from "../season/model.js";
import { RATECARD_COPY } from "./copy.js";
import {
  type ClauseRef,
  clauseLines,
  nextSeason,
  type Refusal,
  refusalParts,
  ruleTerms,
  type ScheduleRuleId,
  scheduleRules,
} from "./model.js";
import { HashPlate, ResolutionPages } from "./parts.js";
import { workspaceRateCardId } from "./workspace-card.js";
import "./ratecard.css";

export type RateCardScreenState = "draft" | "ratified" | "proposal" | "refused";

interface Proposal {
  readonly label: string;
  readonly amountText: string;
}

export function RateCard({ snapshot }: { readonly snapshot: SeasonSnapshot }) {
  const t = useT();
  const mode = useMotionMode();
  const announce = useAnnounce();
  const session = useJudgeSession();
  const adapter = useAdapter();
  const card = snapshot.rateCard;
  const ratified = isRatified(snapshot);
  const printed = useMemo(() => {
    const terms = ruleTerms(card);
    return {
      R0: t("W-TR-02.R0"),
      R1: t("W-TR-02.R1", terms.R1),
      R2: t("W-TR-02.R2", terms.R2),
      R3: t("W-TR-02.R3", terms.R3),
      R4: t("W-TR-02.R4", terms.R4),
    };
  }, [t, card]);
  const rules = useMemo(() => scheduleRules(card, printed), [card, printed]);
  const [hovered, setHovered] = useState<ScheduleRuleId | null>(null);
  const [pinned, setPinned] = useState<ScheduleRuleId | null>(null);
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState<string>(RATECARD_COPY.sampleLabel);
  const [amountText, setAmountText] = useState<string>(RATECARD_COPY.sampleAmount);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // The board document folds away from the title row (round 5); it starts open.
  const [docOpen, setDocOpen] = useState(true);
  // Once refused, the clause that refuses ("No other deductions") holds the band on the board's page until another
  // rule is opened (round 5: the refusal's governing clause in view beside it); before that, pointing at a rule bands
  // its clause.
  const active = pinned ?? (refusal ? "closed" : hovered);
  const activeRule = rules.find((r) => r.id === active) ?? null;
  const highlight: ClauseRef[] = activeRule
    ? clauseLines(card.textLayer, activeRule.quote, activeRule.page)
    : [];
  const pages = useRef<HTMLDivElement>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [startError, setStartError] = useState<unknown>(null);
  const attempts = useRef(0);
  const moment = useMoment("MM-4");
  const add = useCommand("addDeduction", {
    onError: (error) => {
      const refused = asRateCardRatified(error);
      if (!refused) return;
      attempts.current += 1;
      setRefusal({ hash: refused.hash, rateCard: refused.rateCard, ratifiedOn: refused.ratifiedOn });
      // The 409 is the evidence: the bolt refuses because the server did.
      const evidence =
        isApiClientError(error) && error.requestId ? error.requestId : `409-${attempts.current}`;
      moment.play("refuse", { eventId: `${evidence}:${attempts.current}`, kind: "http" });
    },
  });
  const otherError = add.error && !asRateCardRatified(add.error) ? add.error : startError;

  const state: RateCardScreenState = !ratified
    ? "draft"
    : proposal
      ? "proposal"
      : refusal
        ? "refused"
        : "ratified";

  const submitRef = useRef<() => void>(() => undefined);
  submitRef.current = () => {
    if (add.isPending || session.status === "starting") return;
    setStartError(null);
    const body = {
      label: label.trim() || RATECARD_COPY.sampleLabel,
      amountText: amountText.trim() || RATECARD_COPY.sampleAmount,
    };
    // The first press anywhere on the stage starts the judge's session (S3.9); the API answers inside it, on
    // the session workspace's own card (its clone mints a new ID).
    void session
      .start()
      .then(() => workspaceRateCardId(adapter, snapshot.season.label, card.id))
      .then((id) => add.mutate({ params: { id }, body }))
      .catch((error: unknown) => setStartError(error));
  };

  // The bolted face is a still frame of the Slab primitive: it never travels and never commits, so the clicks a
  // pointer, Enter, Space or a screen reader make are taken here, and its refusal follows the 409 (MM-4).
  const bolted = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = bolted.current;
    if (!el) return;
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".fs-slab__face")) return;
      submitRef.current();
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [adding]);

  const refusing = moment.phase === "refuse" || moment.phase === "plate";
  const plateShown =
    refusal !== null && (moment.phase === "plate" || moment.phase === "done" || !moment.playing);
  const plate = refusal ? refusalParts(card, refusal) : null;
  const refusalHeading = useRef<HTMLHeadingElement>(null);
  const announcedRefusal = useRef<Refusal | null>(null);
  useEffect(() => {
    if (!plateShown || !refusalHeading.current || announcedRefusal.current === refusal) return;
    announcedRefusal.current = refusal;
    focusAndReveal(refusalHeading.current);
    refusalHeading.current
      .closest(".fsc-rc__refusal")
      ?.scrollIntoView({ block: "nearest", behavior: mode === "reduced" ? "instant" : "smooth" });
    announce(refusalHeading.current.textContent ?? "");
  }, [plateShown, refusal, announce, mode]);
  // Round 7: once the refusal is printed, the paper turns to the page that refuses it (the clause banded, whole, the
  // page from its top edge), with the card's seal under it; opening another rule shows every page again. So no page
  // starts half-hidden, no line ghosts under the top fade and the cited clause is never cut at the panel's foot.
  const citedOnly = plateShown && pinned === null && highlight.length > 0;
  const citedPages = citedOnly ? new Set(highlight.map((h) => h.page)) : null;
  useEffect(() => {
    if (!citedOnly) return;
    const scroller = pages.current?.querySelector<HTMLElement>(".fsc-snap__scroller");
    if (scroller) scroller.scrollTop = 0;
  }, [citedOnly]);
  // A pinned rule, or the refusal, brings its banded clause into view in the pages' own scroll.
  const banded = pinned ?? (refusal ? "closed" : null);
  useEffect(() => {
    if (!banded || !docOpen) return;
    const band = pages.current?.querySelector<HTMLElement>("[data-band]");
    if (!band) return;
    // Round 6: only as far as it must. A clause already in view (or within the foot's 32 px fade of it) leaves the
    // pages where they are, page 1 from its top, so no heading rests half under the panel's edge.
    const scroller = band.closest<HTMLElement>(".fsc-snap__scroller");
    if (scroller) {
      const box = scroller.getBoundingClientRect();
      const at = band.getBoundingClientRect();
      if (at.top >= box.top && at.bottom <= box.bottom + 32) return;
    }
    band.scrollIntoView({ block: "nearest", behavior: mode === "reduced" ? "instant" : "smooth" });
  }, [banded, docOpen, mode]);

  const labelId = useId();
  const amountId = useId();
  const clauseId = useId();
  const docId = useId();
  const season = snapshot.season.label;
  const upcoming = nextSeason(season);
  const ratifiedOn = format.date(card.canonical.ratifiedOn);
  const refused = state === "refused" || state === "proposal";

  return (
    <ScreenRoot
      id="W-TR-02"
      state={state}
      labelledBy="fsc-rc-title"
      className={docOpen ? "fsc-rc" : "fsc-rc fsc-rc--doc-closed"}
      grid
    >
      {/* The title row (round 5): the noun with the season in grey, the card's state in one chip, and one id line (the
          resolution, then the screen's one provenance phrase); the board document folds from its end. */}
      <ScreenHead
        title={RATECARD_COPY.title}
        suffix={<span data-testid="W-TR-02.mark">{seasonLabel(snapshot.season.label)}</span>}
        titleId="fsc-rc-title"
        status={
          ratified ? (
            <Chip tone="neutral" glyph="ms:lock" testId="W-TR-02.state">
              {RATECARD_COPY.ratifiedOn(format.dateShort(card.canonical.ratifiedOn))}
            </Chip>
          ) : undefined
        }
        meta={card.canonical.resolutionNo}
        provenance={PROVENANCE.seededSlips}
        actions={
          <button
            type="button"
            className="fs-flat fsc-rc__doc-toggle"
            aria-expanded={docOpen}
            aria-controls={docOpen ? docId : undefined}
            onClick={() => setDocOpen((open) => !open)}
            data-testid="W-TR-02.docToggle"
          >
            <Glyph name={docOpen ? "ms:expand-less" : "ms:expand-more"} size={18} />
            <span className="fs-t-label">{docOpen ? RATECARD_COPY.hideDoc : RATECARD_COPY.showDoc}</span>
          </button>
        }
        testId="W-TR-02.head"
      />

      {/* The board's resolution as paper, scrolling on its own (round 5): its foot fades while more lies below and
          keeps 32 px of room under the last page, so no page ends at the panel's edge. */}
      {docOpen && (
        <Cell span={6} spanMd={6} stretch className="fsc-rc__paper">
          <div id={docId} className="fsc-rc__doc" ref={pages}>
            <SnapScroll
              label={RATECARD_COPY.docLabel(card.canonical.resolutionNo)}
              className="fsc-rc__scroll"
            >
              <ResolutionPages
                card={card}
                highlight={highlight}
                testId="W-TR-02.pages"
                {...(citedPages ? { only: citedPages } : {})}
              />
              {/* The card's seal stands under the page that refuses (round 7): the document and what bolts it. */}
              {citedOnly && (
                <div className="fsc-rc__sealed">
                  {/* Round 8: the seal line only; the page above it already carries the two signatures. */}
                  <HashPlate snapshot={snapshot} testId="W-TR-02.bolted" compact />
                </div>
              )}
            </SnapScroll>
          </div>
        </Cell>
      )}

      {/* Folded, the schedule takes the row in two columns: the rules and the seal, then adding and its refusal. */}
      <Cell span={docOpen ? 6 : 12} spanMd={docOpen ? 6 : 12} stretch className="fsc-rc__side">
        <SnapScroll label={RATECARD_COPY.sideLabel} className="fsc-rc__scroll">
          <div className="fsc-rc__side-body" data-refused={refused ? "" : undefined}>
            <section className="fsc-rc__schedule" aria-labelledby="fsc-rc-schedule">
              <header className="fsc-rc__schedule-head">
                <h2 id="fsc-rc-schedule" className="fs-t-heading">
                  {RATECARD_COPY.schedule}
                </h2>
                {/* Round 8: refused, the column explains once (the refusal and the clause it cites); the hint waits. */}
                {!refused && <p className="fs-t-caption fsc-rc__muted">{RATECARD_COPY.scheduleLede}</p>}
              </header>
              {/* Each rule is its id and four words or fewer (round 4); its whole clause opens under it, and its
                words on the scanned page take the reading band while it is open or pointed at. */}
              <ol className="fsc-rc__rules" data-testid="W-TR-02.rules">
                {rules.map((rule) => (
                  <li
                    key={rule.id}
                    className="fsc-rc__rule-item"
                    data-open={pinned === rule.id ? "" : undefined}
                  >
                    <button
                      type="button"
                      className="fsc-rc__rule"
                      aria-expanded={pinned === rule.id}
                      aria-controls={`${clauseId}-${rule.id}`}
                      data-rule={rule.id}
                      data-active={active === rule.id ? "" : undefined}
                      data-testid={`W-TR-02.rule.${rule.id}`}
                      onMouseEnter={() => setHovered(rule.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(rule.id)}
                      onBlur={() => setHovered(null)}
                      onClick={() => setPinned((p) => (p === rule.id ? null : rule.id))}
                    >
                      {/* Round 7: no rule ids on screen (R0–R6 are the document's own, on its page): each row is its
                          words; the closing clause wears the bolt. The id stays in the row's title. */}
                      <span
                        className="fsc-rc__rule-short fs-t-body"
                        title={rule.ruleId === "CLOSED" ? undefined : rule.ruleId}
                      >
                        {rule.ruleId === "CLOSED" && <Glyph name="bolt" size={14} />}
                        {rule.short}
                      </span>
                      <Glyph name="ms:expand-more" size={16} className="fsc-rc__rule-mark" />
                    </button>
                    <div
                      id={`${clauseId}-${rule.id}`}
                      className="fsc-rc__clause"
                      hidden={pinned !== rule.id}
                      data-testid={`W-TR-02.clause.${rule.id}`}
                    >
                      <Print value={rule.text} provenance="claude" state="ink" typeRole="body" />
                    </div>
                  </li>
                ))}
              </ol>
              {/* The page a pointed rule was quoted from, as micro (round 5: no glyph; the stand-in is said once, in the
                id line, and here in words for assistive technology). */}
              <p
                className="fs-t-micro fsc-rc__footer"
                data-testid="W-TR-02.footer"
                title={
                  activeRule
                    ? RATECARD_COPY.readFooter(CLAUDE_MODEL, activeRule.page)
                    : RATECARD_COPY.readFooterIdle(CLAUDE_MODEL)
                }
              >
                <span className="fs-sr">
                  {activeRule
                    ? RATECARD_COPY.readFooter(CLAUDE_MODEL, activeRule.page)
                    : RATECARD_COPY.readFooterIdle(CLAUDE_MODEL)}
                </span>
                {activeRule && <span aria-hidden>{RATECARD_COPY.page(activeRule.page)}</span>}
              </p>
            </section>

            {/* Once a deduction is being added, the plate keeps its seal line only: the full hash and the two signatures
              step back so the refusal sits in view (round 3). */}
            {!(citedOnly && docOpen) && (
              <HashPlate
                snapshot={snapshot}
                testId="W-TR-02.bolted"
                compact={adding}
                bright={mode === "reduced" && refusing}
              />
            )}

            <section
              className="fsc-rc__add"
              aria-labelledby="fsc-rc-add"
              data-testid="W-TR-02.add"
              data-state={refusal ? "refused" : adding ? "open" : "closed"}
              data-plate={plateShown && plate ? "" : undefined}
              {...moment.rootProps}
            >
              {/* Said once (round 4): while closed, the button says it and the heading names the section for screen
              readers only; once refused, the refusal leads the section and the heading steps back for screen
              readers (round 5). */}
              <h2 id="fsc-rc-add" className={adding && !refusal ? "fsc-rc__add-title fs-t-label" : "fs-sr"}>
                {RATECARD_COPY.addTitle}
              </h2>
              {!adding ? (
                <button
                  type="button"
                  className="fs-flat"
                  onClick={() => setAdding(true)}
                  data-testid="W-TR-02.addOpen"
                >
                  {RATECARD_COPY.addOpen}
                </button>
              ) : (
                <div className="fsc-rc__row" data-testid="W-TR-02.addRow">
                  <div className="fsc-rc__fields">
                    <label className="fsc-rc__field" htmlFor={labelId}>
                      <span className="fs-t-caption">{RATECARD_COPY.labelField}</span>
                      <input
                        id={labelId}
                        className="fsc-input"
                        value={label}
                        onChange={(e) => setLabel(e.target.value)}
                        data-testid="W-TR-02.addLabel"
                        autoComplete="off"
                      />
                    </label>
                    <label className="fsc-rc__field fsc-rc__field--amount" htmlFor={amountId}>
                      <span className="fs-t-caption">{RATECARD_COPY.amountField}</span>
                      <input
                        id={amountId}
                        className="fsc-input fsc-input--figure"
                        value={amountText}
                        onChange={(e) => setAmountText(e.target.value)}
                        data-testid="W-TR-02.addAmount"
                        autoComplete="off"
                      />
                    </label>
                  </div>
                  <div className="fsc-rc__bolted-slab" ref={bolted}>
                    <Slab
                      label={RATECARD_COPY.addCommit}
                      srLabel={RATECARD_COPY.addCommitSr(card.canonical.resolutionNo, ratifiedOn)}
                      depth="d2"
                      tone="chalk"
                      bolted
                      glyph="bolt"
                      testId="W-TR-02.addCommit"
                      frame={{ state: refusing ? "refusing" : "bolted" }}
                      onCommit={() => undefined}
                    />
                    <p className="fs-t-caption fsc-rc__muted">
                      {RATECARD_COPY.locked(card.canonical.resolutionNo)}
                    </p>
                  </div>
                </div>
              )}
              <CommandNotice error={otherError} testId="W-TR-02.error" />
              {plateShown && plate && (
                <section
                  className="fsc-rc__refusal"
                  aria-labelledby="fsc-rc-refusal-title"
                  data-testid="W-TR-02.refusal"
                >
                  <span className="fsc-rc__refusal-bolt fsc-rc__refusal-bolt--l" aria-hidden />
                  <span className="fsc-rc__refusal-bolt fsc-rc__refusal-bolt--r" aria-hidden />
                  {/* The refusal is its title (round 3) and leads the column (round 5), the clause that refuses it banded
                  on the board's page beside it; the one-line reason waits behind "Why". */}
                  <h2
                    id="fsc-rc-refusal-title"
                    ref={refusalHeading}
                    tabIndex={-1}
                    className="fsc-rc__refusal-word fs-t-title-2"
                    data-reveal={mode === "reduced" ? "fade" : "wipe"}
                  >
                    <Glyph name="ms:lock" size={18} />
                    {plate.title}
                  </h2>
                  {/* Round 8: the attempt is the refusal's own second line ("Iba pa (Other) · ₱150 · Not added"), in ink,
                      never struck through: one block says what was refused; the clause banded on the page says why. */}
                  <p className="fsc-rc__refused-row" data-testid="W-TR-02.refusedRow">
                    <Glyph name="ms:close" size={16} />
                    <span className="fsc-rc__refused-what fs-t-body">{`${label.trim()} · ${amountText.trim()}`}</span>
                    <span className="fs-t-caption fsc-rc__refused-why">
                      {RATECARD_COPY.notAdded(card.canonical.resolutionNo)}
                    </span>
                  </p>
                  <details className="fsc-rc__why" data-testid="W-TR-02.why">
                    <summary className="fs-link fs-t-label">
                      {RATECARD_COPY.why}
                      <Glyph name="ms:expand-more" size={16} className="fsc-rc__why-mark" />
                    </summary>
                    <p className="fsc-rc__refusal-text">
                      {plate.body} <span className="fs-t-caption">{plate.hash}</span>
                    </p>
                  </details>
                  {/* Next season's proposal is secondary (round 5): the refusal is the screen's state, not a new task. */}
                  <div
                    className="fsc-rc__refusal-action"
                    data-testid="W-TR-02.propose"
                    data-state={proposal ? "unavailable" : "rest"}
                  >
                    <button
                      type="button"
                      className="fs-flat"
                      aria-disabled={proposal ? true : undefined}
                      aria-label={`${RATECARD_COPY.propose(upcoming)}, ${proposal ? RATECARD_COPY.proposed : RATECARD_COPY.proposeSr}`}
                      title={proposal ? RATECARD_COPY.proposed : undefined}
                      onClick={() => {
                        if (!proposal) setProposal({ label: label.trim(), amountText: amountText.trim() });
                      }}
                      data-testid="W-TR-02.propose.face"
                    >
                      {RATECARD_COPY.propose(upcoming)}
                    </button>
                  </div>
                </section>
              )}
            </section>

            {proposal && (
              <section
                className="fsc-rc__proposal"
                aria-labelledby="fsc-rc-proposal"
                data-testid="W-TR-02.proposal"
              >
                <header className="fsc-rc__proposal-head">
                  <h2 id="fsc-rc-proposal" className="fs-t-title-2">
                    {RATECARD_COPY.proposalTitle(upcoming)}
                  </h2>
                  <Chip tone="neutral" glyph="ms:schedule" testId="W-TR-02.notInForce">
                    {RATECARD_COPY.notInForce}
                  </Chip>
                </header>
                <p className="fsc-rc__proposal-line">
                  <span>{proposal.label || RATECARD_COPY.sampleLabel}</span>
                  <span className="fs-t-figure">{proposal.amountText || RATECARD_COPY.sampleAmount}</span>
                </p>
                <p className="fs-t-caption fsc-rc__muted">{RATECARD_COPY.proposalNote(upcoming)}</p>
              </section>
            )}
          </div>
        </SnapScroll>
      </Cell>
    </ScreenRoot>
  );
}
