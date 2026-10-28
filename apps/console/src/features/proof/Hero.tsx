// Proof's hero (S1.8 P1, design §6): the seal grown from the batch hash and completed by two keys, the stencilled
// lot mark, the sentence that says what Lantern Bay paid, and "Verify in your browser" as a d1 slab with the six
// checks it runs printed beneath it. The hero is the one centred block on Proof (design §2.4). In Data mode the
// seal reads as its hash (S1.7). A check that matches is ink, never jade (jade means money); only a mismatch is
// red, and it names its plate.

import type { PlateName, ProofBundle } from "@fairsplit/contracts";
import { Glyph, type GlyphName, Seal, Slab } from "@fairsplit/ui-web";
import type { CSSProperties } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import {
  around,
  FAILURE_PLACE,
  FOOTER_COPY,
  PLATE_CHECK,
  PLATE_TITLE,
  railName,
  t,
  VERIFY_COPY,
  verdictWord,
} from "./copy.js";
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
}: ProofHeroProps) {
  const Title = level;
  const paid = bundle.invoice.status === "PAID";
  const amount = format.money(bundle.invoice.amountCents);
  // ADR-0002, I8: an invoice marked paid on the simulator says the sandbox was simulated.
  const heroKey = paid
    ? "W-PF-01.heroPaid"
    : rail === "simulator"
      ? "W-PF-01.heroMarked.simulator"
      : "W-PF-01.heroMarked";
  const [before, after] = around(heroKey, "amount", {
    amount,
    season: seasonLabel,
  });
  const keys = sealKeys(bundle);
  return (
    <section className="pf-hero" aria-labelledby="W-PF-01-title" data-testid="W-PF-01.hero">
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
                  value: <span className="fs-t-hash">{format.hashAllGroups(bundle.batch.batchSha256)}</span>,
                },
              },
              { key: "keys", cells: { part: "Keys signed", value: `${keys} of 2` } },
            ]}
          />
        }
      />
      {lotCode && (
        <p className="pf-hero__lot" data-testid="W-PF-01.lot">
          {lotCode}
        </p>
      )}
      <Title id="W-PF-01-title" className="pf-hero__title">
        {before}
        <span className="pf-hero__amount" data-amount-state="landed" data-testid="W-PF-01.invoice-amount">
          {amount}
        </span>
        {after}
      </Title>
      <p className="pf-hero__tagline">{FOOTER_COPY.tagline()}</p>
      <p className="pf-hero__rail" data-testid="W-PF-01.rail" data-rail={rail}>
        <Glyph name="rail" size={16} />
        <span>{railName(rail)}. Synthetic co-op, people and slips.</span>
      </p>
      <VerifyPanel verification={verification} />
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
  }
}

export function VerifyPanel({ verification }: { readonly verification: Verification }) {
  const { state, verify } = verification;
  const done = state.kind === "done" ? state : null;
  const outcome = done?.outcome ?? null;
  const matched = outcome ? PLATES.filter((p) => outcome.checks[p].state !== "differs").length : 0;
  const status = verifyStatus(state);
  return (
    <div className="pf-verify" data-testid="W-PF-01.verdict" data-state={status}>
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
            >
              <span className="pf-checks__no" aria-hidden>
                {index + 1}
              </span>
              <span className="pf-checks__what">{t(PLATE_CHECK[plate])}</span>
              <span className="pf-checks__state">
                {slot.state !== "idle" && (
                  <>
                    {glyph && <Glyph name={glyph} size={16} />}
                    <span>{slotWords(slot.state)}</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <div className="pf-verify__status" role="status" aria-atomic="true">
        {state.kind === "idle" && (
          <p className="pf-verify__line">{state.stale ? VERIFY_COPY.stale : VERIFY_COPY.idle}</p>
        )}
        {state.kind === "checking" && <p className="pf-verify__line">{VERIFY_COPY.checking}</p>}
        {state.kind === "error" && (
          <>
            <p className="pf-verify__line">{VERIFY_COPY.keysFailed}</p>
            <CommandNotice
              error={state.error}
              testId="W-PF-01.verify.error"
              onRetry={verify}
              retryLabel={VERIFY_COPY.again}
            />
          </>
        )}
        {done && outcome && (
          <>
            <p className="pf-verify__verdict">
              <span className="pf-verdict" data-verdict={outcome.verdict} data-testid="W-PF-01.verdict.word">
                <Glyph name={outcome.verdict === "failed" ? "ms:close" : "ms:check"} size={16} />
                {verdictWord(outcome.verdict)}
              </span>
              <span className="pf-verify__line">
                {VERIFY_COPY.matches(matched)} {VERIFY_COPY.checkedAt(format.time(done.at))}
              </span>
            </p>
            {outcome.failure && (
              <p className="pf-verify__failure" data-testid="W-PF-01.verdict.failure">
                <strong>
                  {outcome.failure.where === "chain" || outcome.failure.where === "checkpoint"
                    ? FAILURE_PLACE[outcome.failure.where]
                    : `Plate ${PLATES.indexOf(outcome.failure.where) + 1}, ${t(PLATE_TITLE[outcome.failure.where])}`}
                  :
                </strong>{" "}
                {outcome.failure.reason}
              </p>
            )}
            {!outcome.failure && outcome.sampleKeys.length > 0 && (
              <p className="pf-verify__note" data-testid="W-PF-01.verdict.sample">
                {VERIFY_COPY.sample(outcome.sampleKeys)}
              </p>
            )}
            {outcome.verdict === "partial" && <p className="pf-verify__note">{VERIFY_COPY.partial}</p>}
            <p className="pf-verify__trust" data-testid="W-PF-01.verdict.trust" data-trust={outcome.trust}>
              {outcome.trust === "published" ? VERIFY_COPY.keysPublished : VERIFY_COPY.keysSeed}
            </p>
            {outcome.anchors.invoiceNumber && outcome.anchors.senderBatchId && (
              <p className="pf-verify__anchors" data-testid="W-PF-01.verdict.anchors">
                {VERIFY_COPY.anchorsLead} invoice{" "}
                <span className="fs-t-hash">{outcome.anchors.invoiceNumber}</span>
                {outcome.anchors.invoiceReference && (
                  <>
                    , reference <span className="fs-t-hash">{outcome.anchors.invoiceReference}</span>
                  </>
                )}
                ; payout batch <span className="fs-t-hash">{outcome.anchors.senderBatchId}</span>
                {outcome.anchors.batchNote && <>, note “{outcome.anchors.batchNote}”</>}.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
