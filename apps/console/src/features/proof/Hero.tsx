// Proof's hero (S1.8 P1, design §6; UI gate round 2). A factual header first: the stencilled lot mark, then the
// invoice as one money figure with its context in grey and the honesty tags. Then the verdict leads, beside the
// seal grown from the batch hash: the six checks' count as the page's one dot-matrix instrument ("0/6", then
// "6/6"), "Sample keys, never Verified" paired with it, and "Verify in your browser" as the one primary. Where
// every dollar went sits beside it (the money slot), and the six checks run under both, so all six are in view on
// a laptop's first screen. A check that matches is ink, never jade (jade means money); only a mismatch is red, and
// it names its plate. In Data mode the seal reads as its hash (S1.7).

import type { PlateName, ProofBundle } from "@fairsplit/contracts";
import {
  CurrencyFigure,
  Glyph,
  type GlyphName,
  HonestyTag,
  InkStamp,
  Seal,
  Slab,
  type StampView,
} from "@fairsplit/ui-web";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import { SeasonText } from "../../chrome/SeasonText.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import {
  CHECK_SHORT,
  FAILURE_PLACE,
  PAYER,
  PLATE_TITLE,
  railShort,
  t,
  VERIFY_COPY,
  verdictWord,
} from "./copy.js";
import { DotMatrix } from "./DotMatrix.js";
import type { Verification, VerifyState } from "./useVerification.js";
import { type CheckState, PLATES } from "./verify.js";

export interface ProofHeroProps {
  readonly bundle: ProofBundle;
  readonly seasonLabel: string;
  readonly lotCode: string | null;
  readonly rail: PaypalRail;
  readonly verification: Verification;
  /** The page's own heading level: h1 on Proof, h2 under the brand view's strip. */
  readonly level?: "h1" | "h2";
  /** Where every dollar went: the run's live line and the money bar, beside the verdict. */
  readonly money?: ReactNode;
  /** The officers whose keys signed the batch, as indigo stamps beside the verdict (AS, EC). */
  readonly signers?: readonly StampView[];
}

export function sealKeys(bundle: Pick<ProofBundle, "approvals">): 0 | 1 | 2 {
  const n = new Set(bundle.approvals.map((a) => a.role)).size;
  return n >= 2 ? 2 : n === 1 ? 1 : 0;
}

export function ProofHero({
  bundle,
  seasonLabel,
  lotCode,
  rail,
  verification,
  level = "h1",
  money,
  signers = [],
}: ProofHeroProps) {
  const Title = level;
  const paid = bundle.invoice.status === "PAID";
  const amount = format.money(bundle.invoice.amountCents);
  const keys = sealKeys(bundle);
  // ADR-0002, I8: an invoice marked paid on the simulator says the sandbox was simulated. The tag beside the
  // header says it on screen; the heading says it in words to a screen reader.
  const where = paid
    ? ""
    : rail === "simulator"
      ? " in a simulated PayPal sandbox"
      : " in PayPal’s own sandbox";
  return (
    <section className="pf-hero" aria-labelledby="W-PF-01-title" data-testid="W-PF-01.hero">
      <header className="pf-head">
        {/* The lot mark's line is held from the first frame (proof.css reserves its box): on a slow link the
            bundle lands before the seed that names the lot, and the code fills the line in place, so nothing
            under it moves. Empty, it says nothing to a screen reader. */}
        <p className="pf-hero__lot" data-testid="W-PF-01.lot" aria-hidden={lotCode ? undefined : true}>
          {lotCode ?? ""}
        </p>
        <div className="pf-head__row">
          <Title id="W-PF-01-title" className="pf-hero__title">
            <span
              className="pf-hero__amount fs-t-amount-hero"
              data-amount-state="landed"
              data-testid="W-PF-01.invoice-amount"
            >
              <CurrencyFigure display={amount} />
            </span>{" "}
            <span className="pf-hero__context">
              {PAYER} · <SeasonText text={`Season ${seasonLabel}`} season={seasonLabel} /> ·{" "}
              {paid ? "paid" : "marked paid"}
              {where && <span className="fs-sr">{where}</span>}
            </span>
          </Title>
          <p className="pf-head__tags">
            <span className="pf-head__rail" data-testid="W-PF-01.rail" data-rail={rail}>
              <HonestyTag>{railShort(rail)}</HonestyTag>
            </span>
            <HonestyTag>Synthetic sample</HonestyTag>
          </p>
        </div>
      </header>
      <VerifyPanel
        verification={verification}
        rail={rail}
        signers={signers}
        aside={money}
        seal={
          <Mirrored
            testId="W-PF-01.seal"
            className="pf-hero__seal"
            visual={<Seal batchSha256={bundle.batch.batchSha256} size={320} keys={keys} />}
            table={
              <DataTable
                caption="The batch seal, as its hash"
                testId="W-PF-01.seal.table"
                columns={[
                  { key: "part", label: "Part" },
                  { key: "value", label: "Value" },
                ]}
                rows={[
                  {
                    key: "hash",
                    cells: {
                      part: "Batch hash",
                      value: (
                        <span className="fs-t-hash">{format.hashAllGroups(bundle.batch.batchSha256)}</span>
                      ),
                    },
                  },
                  { key: "keys", cells: { part: "Keys signed", value: `${keys} of 2` } },
                ]}
              />
            }
          />
        }
      />
    </section>
  );
}

/** The verify panel's own state, for tests and CSS: idle, stale, checking, error, matches, sample, partial, mismatch. */
export function verifyStatus(v: VerifyState): string {
  switch (v.kind) {
    case "idle":
      return v.stale ? "stale" : "idle";
    case "checking":
      return "checking";
    case "error":
      return "error";
    case "done":
      return v.outcome.verdict === "failed"
        ? "mismatch"
        : v.outcome.verdict === "replay"
          ? "replay"
          : v.outcome.verdict === "partial"
            ? "partial"
            : v.outcome.verdict === "sample"
              ? "sample"
              : "matches";
  }
}

export type SlotState = "idle" | "checking" | CheckState;

export function slotOf(plate: PlateName, verify: VerifyState): { state: SlotState; reason: string | null } {
  switch (verify.kind) {
    case "checking":
      return { state: "checking", reason: null };
    case "done": {
      const check = verify.outcome.checks[plate];
      return { state: check.state, reason: check.reason };
    }
    default:
      return { state: "idle", reason: null };
  }
}

export const SLOT_GLYPH: Partial<Record<SlotState, GlyphName>> = {
  matches: "ms:check",
  server: "ms:check",
  differs: "ms:close",
  withheld: "ms:lock",
};

export function slotWords(state: SlotState): string {
  const c = VERIFY_COPY.checkState;
  switch (state) {
    case "idle":
      return c.idle;
    case "checking":
      return c.checking();
    case "matches":
      return c.matches();
    case "server":
      return c.server;
    case "withheld":
      return c.withheld;
    case "differs":
      return c.differs;
    case "replay":
      return c.replay;
  }
}

/** A plate's check in the six rows: "Matches", or "Matches (server)" when Fair Split's server ran it (the row's
 * title says why). */
function rowWords(state: SlotState): string {
  return state === "server" ? `${VERIFY_COPY.checkState.matches()} (server)` : slotWords(state);
}

export function VerifyPanel({
  verification,
  rail = "simulator",
  signers = [],
  seal,
  aside,
}: {
  readonly verification: Verification;
  readonly rail?: PaypalRail;
  /** The officers whose keys signed, drawn as stamps beside the Sample badge. */
  readonly signers?: readonly StampView[];
  /** The batch seal, drawn beside the count. */
  readonly seal?: ReactNode;
  /** The card beside the verdict (where every dollar went). */
  readonly aside?: ReactNode;
}) {
  const { state, verify } = verification;
  const done = state.kind === "done" ? state : null;
  const outcome = done?.outcome ?? null;
  const matched = outcome
    ? PLATES.filter((p) => ["matches", "server"].includes(outcome.checks[p].state)).length
    : 0;
  const status = verifyStatus(state);
  // Once the verdict lands it is brought into view, so "Sample" and why never sit off screen beside six
  // "Matches" on a short window (I8).
  const verdictRef = useRef<HTMLDivElement>(null);
  const landedAt = done?.at ?? null;
  useEffect(() => {
    if (!landedAt) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    verdictRef.current?.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
  }, [landedAt]);
  const countWords =
    state.kind === "done"
      ? VERIFY_COPY.count.done
      : state.kind === "checking"
        ? VERIFY_COPY.count.checking
        : state.kind === "error"
          ? VERIFY_COPY.count.error
          : VERIFY_COPY.count.idle;
  const failurePlace = outcome?.failure
    ? outcome.failure.where === "chain" || outcome.failure.where === "checkpoint"
      ? FAILURE_PLACE[outcome.failure.where]
      : `Plate ${PLATES.indexOf(outcome.failure.where) + 1}, ${t(PLATE_TITLE[outcome.failure.where])}`
    : null;
  return (
    <div className="pf-verify" data-testid="W-PF-01.verdict" data-state={status}>
      <div className="pf-verify__card">
        {seal}
        <div className="pf-verify__body">
          <div className="pf-verify__status" role="status" aria-atomic="true" ref={verdictRef}>
            <p className="pf-verify__count" data-state={status}>
              <DotMatrix value={`${matched}/${PLATES.length}`} tone={done ? "ink" : "dim"} />
              <span className="pf-verify__countword" aria-hidden>
                {countWords}
              </span>
            </p>
            {state.kind === "idle" && (
              <p className="pf-verify__line">{state.stale ? VERIFY_COPY.stale : VERIFY_COPY.idle}</p>
            )}
            {state.kind === "checking" && <p className="pf-verify__line">{VERIFY_COPY.checking}</p>}
            {state.kind === "error" && <p className="pf-verify__line">{VERIFY_COPY.keysFailed}</p>}
            {done && outcome && (
              <>
                <p className="fs-sr">
                  {VERIFY_COPY.matches(matched)} {VERIFY_COPY.checkedAt(format.time(done.at))}
                </p>
                <div className="pf-verify__verdict">
                  <span
                    className="pf-verdict"
                    data-verdict={outcome.verdict}
                    data-testid="W-PF-01.verdict.word"
                    title={outcome.verdict === "sample" ? VERIFY_COPY.sampleTitle : undefined}
                  >
                    <Glyph
                      name={
                        outcome.verdict === "failed"
                          ? "ms:close"
                          : outcome.verdict === "replay"
                            ? "rail"
                            : "ms:check"
                      }
                      size={16}
                    />
                    {verdictWord(outcome.verdict)}
                  </span>
                  {!outcome.failure && outcome.sampleKeys.length > 0 && signers.length > 0 && (
                    <span className="pf-verify__stamps" data-testid="W-PF-01.verdict.stamps">
                      {signers.map((stamp) => (
                        <InkStamp key={stamp.initials} stamp={stamp} />
                      ))}
                    </span>
                  )}
                </div>
                {failurePlace && outcome.failure && (
                  <p className="pf-verify__failure" data-testid="W-PF-01.verdict.failure">
                    <strong>{failurePlace}:</strong> {outcome.failure.reason}
                  </p>
                )}
                {!outcome.failure && outcome.sampleKeys.length > 0 && (
                  <p className="pf-verify__sample" data-testid="W-PF-01.verdict.sample">
                    <span>{VERIFY_COPY.sample}</span>
                    <span className="pf-verify__keys fs-t-micro">
                      {VERIFY_COPY.sampleKeys(outcome.sampleKeys)}
                    </span>
                  </p>
                )}
                {outcome.verdict === "partial" && <p className="pf-verify__note">{VERIFY_COPY.partial}</p>}
                <p className="pf-verify__meta fs-t-micro">
                  <span>{VERIFY_COPY.at(format.time(done.at))}</span>
                  <span aria-hidden> · </span>
                  <span
                    className="pf-verify__trust"
                    data-testid="W-PF-01.verdict.trust"
                    data-trust={outcome.trust}
                    title={
                      outcome.trust === "published"
                        ? VERIFY_COPY.keysPublishedTitle
                        : VERIFY_COPY.keysSeedTitle
                    }
                  >
                    {outcome.trust === "published" ? VERIFY_COPY.keysPublished : VERIFY_COPY.keysSeed}
                  </span>
                </p>
              </>
            )}
          </div>
          <div className="pf-verify__act">
            <Slab
              label={state.kind === "done" || state.kind === "error" ? VERIFY_COPY.again : VERIFY_COPY.slab()}
              srLabel={VERIFY_COPY.srLabel}
              depth="d1"
              tone="chalk"
              glyph="seal"
              testId="W-PF-01.verify"
              onCommit={() => {
                if (state.kind !== "checking") verify();
              }}
            />
            {outcome?.anchors.invoiceNumber && outcome.anchors.senderBatchId && (
              <details className="pf-verify__ids">
                <summary className="fs-t-label">{VERIFY_COPY.ids}</summary>
                <div className="pf-verify__anchors" data-testid="W-PF-01.verdict.anchors">
                  <p className="pf-verify__anchors-head">
                    <HonestyTag>{railShort(rail)}</HonestyTag>
                    <span className="fs-t-micro">{VERIFY_COPY.anchorsLead(rail)}</span>
                  </p>
                  <dl className="pf-kv">
                    <div>
                      <dt>Invoice</dt>
                      <dd className="fs-t-hash">{outcome.anchors.invoiceNumber}</dd>
                    </div>
                    {outcome.anchors.invoiceReference && (
                      <div>
                        <dt>Reference</dt>
                        <dd className="fs-t-hash">{outcome.anchors.invoiceReference}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Payout batch</dt>
                      <dd className="fs-t-hash">{outcome.anchors.senderBatchId}</dd>
                    </div>
                    {outcome.anchors.batchNote && (
                      <div>
                        <dt>Note</dt>
                        <dd>{outcome.anchors.batchNote}</dd>
                      </div>
                    )}
                  </dl>
                </div>
              </details>
            )}
          </div>
          {state.kind === "error" && (
            <CommandNotice
              error={state.error}
              testId="W-PF-01.verify.error"
              onRetry={verify}
              retryLabel={VERIFY_COPY.again}
            />
          )}
        </div>
      </div>
      {aside}
      <ol className="pf-checks" aria-label="What Verify recomputes" data-testid="W-PF-01.checks">
        {PLATES.map((plate, index) => {
          const slot = slotOf(plate, state);
          const glyph = SLOT_GLYPH[slot.state];
          return (
            <li
              key={plate}
              className="pf-checks__row"
              data-plate={plate}
              data-state={slot.state}
              data-testid={`W-PF-01.checks.${plate}`}
              style={{ "--pf-i": index } as CSSProperties}
              title={slot.state === "server" ? VERIFY_COPY.serverNote : undefined}
            >
              <span className="pf-checks__no" aria-hidden>
                {index + 1}
              </span>
              <span className="pf-checks__what">{CHECK_SHORT[plate]}</span>
              <span className="pf-checks__state">
                {slot.state !== "idle" && (
                  <>
                    {glyph && <Glyph name={glyph} size={16} />}
                    <span>{rowWords(slot.state)}</span>
                  </>
                )}
              </span>
              {slot.state === "replay" && slot.reason && (
                <span className="pf-checks__note pf-verify__note">{slot.reason}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
