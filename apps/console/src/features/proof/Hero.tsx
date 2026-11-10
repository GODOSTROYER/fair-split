// Proof's hero (S1.8 P1, design §6; UI gate rounds 2 and 3). A factual header first: the headline on the title
// step (the invoice as one money figure, its context in ink-3) with the lot's id under it in the mono, and the
// page's one quiet "Simulated PayPal sandbox" indicator and the synthetic glyph. Then the verdict leads, beside the
// 180 px seal grown from the batch hash: the six checks' count as the page's one hero number in FS Sans ("0/6",
// then "6/6"), the explicit result under it ("6 of 6 integrity checks match", seen and heard the same way), the
// sample-keys qualification as a neutral key chip (never a check mark), who signed, and "Verify in your browser" as
// the one primary. Where every dollar went sits beside it (the money slot), and the six checks run under both, so
// all six are in view on a laptop's first screen. A check that matches is ink, never jade (jade means money); a
// mismatch is ink too, with its ✕ and the plate it names (red is only PayPal saying no). In Data mode the seal reads
// as its hash (S1.7).

import type { PlateName, ProofBundle } from "@fairsplit/contracts";
import {
  Glyph,
  type GlyphName,
  HONESTY,
  HonestyTag,
  InkStamp,
  LegendGlyph,
  Numeral,
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
import { KeyGlyph } from "./glyphs.js";
import type { Verification, VerifyState } from "./useVerification.js";
import { type CheckState, PLATES } from "./verify.js";

/**
 * The seal's size: LAYOUT.console.seal (180 px, the same as Approve's and the Chair's phone). Proof keeps the number
 * here rather than importing the whole token module into its 110 KB first load (S2.11); proof.css sizes the box
 * with --fs-console-seal, and a test holds the two equal.
 */
export const PROOF_SEAL = 180;

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
      : " in PayPal’s own sandbox, a path not yet tested in this build";
  return (
    <section className="pf-hero" aria-labelledby="W-PF-01-title" data-testid="W-PF-01.hero">
      <header className="pf-head">
        <div className="pf-head__main">
          {/* The headline on the title step: the invoice in its money figures, its context in ink-3. The verdict
              below is the page's one hero number, so the amount is never a second one (round 3). */}
          <Title id="W-PF-01-title" className="pf-hero__title fs-t-title">
            <span
              className="pf-hero__amount fs-t-amount-l"
              data-amount-state="landed"
              data-testid="W-PF-01.invoice-amount"
            >
              {amount}
            </span>{" "}
            <span className="pf-hero__context">
              {PAYER} · <SeasonText text={`Season ${seasonLabel}`} season={seasonLabel} /> ·{" "}
              {paid ? "paid" : "marked paid"}
              {where && <span className="fs-sr">{where}</span>}
            </span>
          </Title>
          {/* The headline's id line, under it (never an eyebrow above it): the lot, in the id role. Its line is held
              from the first frame (proof.css reserves its box): on a slow link the bundle lands before the seed that
              names the lot, and the code fills the line in place, so nothing under it moves. Empty, it says nothing
              to a screen reader. */}
          <p
            className="pf-hero__lot fs-t-id"
            data-testid="W-PF-01.lot"
            title={lotCode ? "Cacao lot" : undefined}
            aria-hidden={lotCode ? undefined : true}
          >
            {lotCode ?? ""}
          </p>
        </div>
        {/* The page's one quiet indicator (Proof has no top bar), and the synthetic glyph: a bare mark whose words
            are its tooltip and its name. The full legend lives in What's real. */}
        <p className="pf-head__tags">
          <span className="pf-head__rail" data-testid="W-PF-01.rail" data-rail={rail}>
            <HonestyTag quiet>{railShort(rail)}</HonestyTag>
          </span>
          <LegendGlyph {...HONESTY.syntheticSample} testId="W-PF-01.synthetic" />
        </p>
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
            visual={<Seal batchSha256={bundle.batch.batchSha256} size={PROOF_SEAL} keys={keys} />}
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
                        <span className="fs-t-id">{format.hashAllGroups(bundle.batch.batchSha256)}</span>
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
  // The explicit result once a check lands ("6 of 6 integrity checks match"); before it, what state the check is in.
  const resultWords =
    state.kind === "done"
      ? VERIFY_COPY.result(matched, PLATES.length)
      : state.kind === "checking"
        ? VERIFY_COPY.count.checking
        : state.kind === "error"
          ? VERIFY_COPY.count.error
          : VERIFY_COPY.count.idle;
  // Signed with sample keys: the qualification sits beside the result as a neutral key chip. When the verdict is
  // "Sample" the chip carries the verdict word itself, so "Sample" is said once.
  const sampleKeys = outcome && !outcome.failure && outcome.sampleKeys.length > 0;
  const wordInChip = Boolean(sampleKeys && outcome?.verdict === "sample");
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
            <div className="pf-verify__count" data-state={status}>
              {/* The page's one hero count, FS Sans tabular figures. The result under it says it in words, so the
                  numeral is hidden from a screen reader. */}
              <Numeral
                value={`${matched}/${PLATES.length}`}
                tone={done ? "ink" : "dim"}
                decorative
                testId="W-PF-01.verdict.count"
              />
              <p className="pf-verify__result fs-t-heading" data-testid="W-PF-01.verdict.result">
                {resultWords}
              </p>
            </div>
            {state.kind === "idle" && (
              <p className="pf-verify__line">{state.stale ? VERIFY_COPY.stale : VERIFY_COPY.idle}</p>
            )}
            {state.kind === "checking" && <p className="pf-verify__line">{VERIFY_COPY.checking}</p>}
            {state.kind === "error" && <p className="pf-verify__line">{VERIFY_COPY.keysFailed}</p>}
            {done && outcome && (
              <>
                <p className="fs-sr">{VERIFY_COPY.checkedAt(format.time(done.at))}</p>
                <div className="pf-verify__verdict">
                  {!wordInChip && (
                    <span
                      className="pf-verdict"
                      data-verdict={outcome.verdict}
                      data-testid="W-PF-01.verdict.word"
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
                  )}
                  {sampleKeys && (
                    <p className="pf-verify__sample" data-testid="W-PF-01.verdict.sample">
                      <span className="pf-keychip" title={VERIFY_COPY.sampleTitle}>
                        <KeyGlyph className="pf-keychip__glyph" />
                        <span className="pf-keychip__words">
                          {wordInChip ? (
                            <span data-verdict="sample" data-testid="W-PF-01.verdict.word">
                              {verdictWord("sample")}
                            </span>
                          ) : (
                            verdictWord("sample")
                          )}
                          <KeepLastWord text={VERIFY_COPY.sampleRest} />
                          <span className="fs-sr">. {VERIFY_COPY.sampleTitle}</span>
                        </span>
                      </span>
                    </p>
                  )}
                </div>
                {failurePlace && outcome.failure && (
                  <p className="pf-verify__failure" data-testid="W-PF-01.verdict.failure">
                    <strong>{failurePlace}:</strong> {outcome.failure.reason}
                  </p>
                )}
                {/* Who signed: the officers' indigo stamps beside the key ids they signed with. */}
                {(signers.length > 0 || sampleKeys) && (
                  <div className="pf-verify__signed">
                    {signers.length > 0 && (
                      <span className="pf-verify__stamps" data-testid="W-PF-01.verdict.stamps">
                        {signers.map((stamp) => (
                          <InkStamp key={stamp.initials} stamp={stamp} />
                        ))}
                      </span>
                    )}
                    {sampleKeys && (
                      <p className="pf-verify__keys fs-t-id" data-testid="W-PF-01.verdict.keys">
                        {VERIFY_COPY.sampleKeys(outcome.sampleKeys)}
                      </p>
                    )}
                  </div>
                )}
                {outcome.verdict === "partial" && <p className="pf-verify__note">{VERIFY_COPY.partial}</p>}
                <p className="pf-verify__meta fs-t-caption">
                  <span>
                    <time className="fs-t-id">{format.time(done.at)}</time>
                    {VERIFY_COPY.atRest}
                  </span>
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
                <summary className="pf-verify__ids-summary fs-t-label">
                  <Glyph name="ms:expand-more" size={16} className="pf-summary__chevron" />
                  {VERIFY_COPY.ids}
                </summary>
                <div className="pf-verify__anchors" data-testid="W-PF-01.verdict.anchors">
                  <p className="pf-verify__anchors-head">
                    <LegendGlyph kind="simulated" label={railShort(rail)} />
                    <span className="fs-t-caption">{VERIFY_COPY.anchorsLead(rail)}</span>
                  </p>
                  <dl className="pf-kv">
                    <div>
                      <dt>Invoice</dt>
                      <dd className="fs-t-id">{outcome.anchors.invoiceNumber}</dd>
                    </div>
                    {outcome.anchors.invoiceReference && (
                      <div>
                        <dt>Reference</dt>
                        <dd className="fs-t-id">{outcome.anchors.invoiceReference}</dd>
                      </div>
                    )}
                    <div>
                      <dt>Payout batch</dt>
                      <dd className="fs-t-id">{outcome.anchors.senderBatchId}</dd>
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

/** Words that may wrap, with the last one kept whole ("PayPal-verified" never breaks at its hyphen). */
function KeepLastWord({ text }: { readonly text: string }) {
  const at = text.lastIndexOf(" ");
  if (at < 0) return <span className="pf-nowrap">{text}</span>;
  return (
    <>
      {text.slice(0, at + 1)}
      <span className="pf-nowrap">{text.slice(at + 1)}</span>
    </>
  );
}
