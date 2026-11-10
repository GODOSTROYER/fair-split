// W-TR-02 Rate card (S1.7, design §6 C2): BR 2026-04's pages as paper on the left, Schedule A printed flat on
// the right, and the hash plate bolted beneath it. "Add a deduction" opens a row whose commit is the bolted
// slab "Add to Schedule A" (MM-4 Bolted): the press goes to the API, and the 409 RATE_CARD_RATIFIED it answers
// is the evidence. Only then does the slab shake (it never travels), the clack play and the refusal plate print
// the hash the 409 carried. Its one live slab drafts a proposal for next season, unhashed and not in force.
// Rules before facts (I2): not even the treasurer can change the card mid-season.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { Chip, Glyph, LegendGlyph, Print, Slab, useMotionMode, useT } from "@fairsplit/ui-web";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { ScreenRoot } from "../../chrome/ScreenRoot.js";
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
  const active = hovered ?? pinned;
  const activeRule = rules.find((r) => r.id === active) ?? null;
  const highlight: ClauseRef[] = activeRule
    ? clauseLines(card.textLayer, activeRule.quote, activeRule.page)
    : [];

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState<string>(RATECARD_COPY.sampleLabel);
  const [amountText, setAmountText] = useState<string>(RATECARD_COPY.sampleAmount);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
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
  const labelId = useId();
  const amountId = useId();
  const season = snapshot.season.label;
  const upcoming = nextSeason(season);
  const ratifiedOn = format.date(card.canonical.ratifiedOn);

  return (
    <ScreenRoot id="W-TR-02" state={state} labelledBy="fsc-rc-title" className="fsc-rc">
      <header className="fsc-rc__head">
        {/* A factual name with the season beside it in grey, as on every screen (round 3: no mark above the
            heading). The stand-in's glyph sits once, under the rules it covers. */}
        <h1 id="fsc-rc-title" className="fs-t-title-1">
          {RATECARD_COPY.title}
          <span className="fsc-rc__context" data-testid="W-TR-02.mark">
            {" "}
            {seasonLabel(snapshot.season.label)}
          </span>
        </h1>
        <p className="fsc-rc__lede">{RATECARD_COPY.lede(card.canonical.resolutionNo, ratifiedOn)}</p>
      </header>

      <div className="fsc-rc__body">
        <ResolutionPages card={card} highlight={highlight} testId="W-TR-02.pages" />

        <div className="fsc-rc__side">
          <section className="fsc-rc__schedule" aria-labelledby="fsc-rc-schedule">
            <header className="fsc-rc__schedule-head">
              <h2 id="fsc-rc-schedule" className="fs-t-title-2">
                {RATECARD_COPY.schedule}
              </h2>
              <p className="fs-t-caption fsc-rc__muted">{RATECARD_COPY.scheduleLede}</p>
            </header>
            <ol className="fsc-rc__rules" data-testid="W-TR-02.rules">
              {rules.map((rule) => (
                <li key={rule.id} className="fsc-rc__rule-item">
                  <button
                    type="button"
                    className="fsc-rc__rule"
                    aria-pressed={pinned === rule.id}
                    data-rule={rule.id}
                    data-active={active === rule.id ? "" : undefined}
                    data-testid={`W-TR-02.rule.${rule.id}`}
                    onMouseEnter={() => setHovered(rule.id)}
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() => setHovered(rule.id)}
                    onBlur={() => setHovered(null)}
                    onClick={() => setPinned((p) => (p === rule.id ? null : rule.id))}
                  >
                    <span className="fsc-rc__rule-id fs-t-id">
                      {rule.ruleId === "CLOSED" ? <Glyph name="bolt" size={14} /> : rule.ruleId}
                    </span>
                    <Print value={rule.text} provenance="claude" state="ink" typeRole="body" />
                  </button>
                </li>
              ))}
            </ol>
            {/* The stand-in's glyph (its words whole as its title and accessible name), and the page a pointed rule
                was quoted from as micro (round 3: no sentence under the rules). */}
            <p className="fs-t-micro fsc-rc__footer" data-testid="W-TR-02.footer">
              <LegendGlyph
                kind="synthetic"
                label={
                  activeRule
                    ? RATECARD_COPY.readFooter(CLAUDE_MODEL, activeRule.page)
                    : RATECARD_COPY.readFooterIdle(CLAUDE_MODEL)
                }
              />
              {activeRule && <span aria-hidden>{RATECARD_COPY.page(activeRule.page)}</span>}
            </p>
          </section>

          {/* Once a deduction is being added, the plate keeps its seal line only: the full hash and the two signatures
              step back so the refusal sits in view (round 3). */}
          <HashPlate
            snapshot={snapshot}
            testId="W-TR-02.bolted"
            compact={adding}
            bright={mode === "reduced" && refusing}
          />

          <section
            className="fsc-rc__add"
            aria-labelledby="fsc-rc-add"
            data-testid="W-TR-02.add"
            data-state={refusal ? "refused" : adding ? "open" : "closed"}
            {...moment.rootProps}
          >
            <h2 id="fsc-rc-add" className="fsc-rc__add-title fs-t-label">
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
                {/* The refusal is its title (round 3); the one-line reason waits behind "Why". */}
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
                <details className="fsc-rc__why" data-testid="W-TR-02.why">
                  <summary className="fs-link fs-t-label">
                    {RATECARD_COPY.why}
                    <Glyph name="ms:expand-more" size={16} className="fsc-rc__why-mark" />
                  </summary>
                  <p className="fsc-rc__refusal-text">
                    {plate.body} <span className="fs-t-caption">{plate.hash}</span>
                  </p>
                </details>
                <div className="fsc-rc__refusal-action">
                  <Slab
                    label={RATECARD_COPY.propose(upcoming)}
                    srLabel={`${RATECARD_COPY.propose(upcoming)}, ${RATECARD_COPY.proposeSr}`}
                    depth="d1"
                    tone="chalk"
                    testId="W-TR-02.propose"
                    unavailableReason={proposal ? RATECARD_COPY.proposed : undefined}
                    onCommit={() => setProposal({ label: label.trim(), amountText: amountText.trim() })}
                  />
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
      </div>
    </ScreenRoot>
  );
}
