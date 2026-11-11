// Proof's hero (S1.8 P1, design §6; UI gate rounds 2 to 5). The console's title row first (round 5): a noun title
// with a grey suffix ("Proof 2026-A"; "Season 2026-A" under the brand's own title), the run's state in one chip on
// the same row, then one id line (the payer, the lot in the mono, and the page's one provenance phrase, its sentence
// its title) and the page's one quiet "Simulated PayPal sandbox" indicator at the row's end. Then the verdict leads,
// beside the 180 px seal grown from the batch hash: the six checks' count as the page's one hero number in FS Sans
// ("0/6", then "6/6"), the explicit result under it ("6 of 6 integrity checks match", seen and heard the same way),
// the sample-keys qualification on the body step right under it (a key glyph, never a check mark), who signed (each
// officer by name and role; round 5: no ids for people, the key waits behind "IDs"), and "Verify in your browser"
// as the one primary. Where every dollar went sits beside it (the money slot, headed by the invoice it adds up to),
// and the six checks run under both, so all six are in view on a laptop's first screen. A check that held is the
// one marker vocabulary's line ✓ and its word in ink (round 5: never a filled disc, never jade, which means money);
// a mismatch is ink too, with its ✕ and the plate it names (red is only PayPal saying no). File names and full ids
// wait behind "IDs". In Data mode the seal reads as its hash (S1.7).

import type { PlateName, ProofBundle } from "@fairsplit/contracts";
import {
  Avatar,
  CheckMark,
  Glyph,
  type GlyphName,
  HonestyTag,
  IdText,
  Numeral,
  Seal,
  Slab,
} from "@fairsplit/ui-web";
import { type CSSProperties, type ReactNode, useEffect, useRef } from "react";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { DataTable, Mirrored } from "../../chrome/DataTable.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import {
  CHECK_SHORT,
  FAILURE_PLACE,
  PAYER,
  PLATE_TITLE,
  PROOF_PROVENANCE,
  railShort,
  t,
  VERIFY_COPY,
  verdictWord,
} from "./copy.js";
import { KeyGlyph } from "./glyphs.js";
import type { Verification, VerifyState } from "./useVerification.js";
import { type CheckState, KEYS_PATH, PLATES } from "./verify.js";

/**
 * The seal's size: LAYOUT.console.seal (180 px, the same as Approve's and the Chair's phone). Proof keeps the number
 * here rather than importing the whole token module into its 110 KB first load (S2.11); proof.css sizes the box
 * with --fs-console-seal, and a test holds the two equal.
 */
export const PROOF_SEAL = 180;

/**
 * How much of a key id shows in view (round 4): 17 characters, the last 6 always, so "fs-ernesto-demo-mj2ng2" reads
 * "fs-ernesto…mj2ng2" on one line and two keys never look alike. The whole id is its title, its accessible name and
 * the IDs disclosure's row.
 */
export const KEY_SHOWN = { max: 17, tail: 6 } as const;

/** Where a key id is the detail (behind "IDs", plate 5's keys) it shows whole: the record mints 22 at most. */
export const KEY_ROOM = 32;

/** The keys document's file name: behind "IDs" its path is cut to it ("…fairsplit-keys.json"), whole as its title. */
const KEYS_FILE = KEYS_PATH.slice(KEYS_PATH.lastIndexOf("/") + 1);

/**
 * An id on Proof, on one line in the id role (round 4: never broken mid-word). One that fits is printed as it is; a
 * longer one is ui-web's IdText, cut in the middle with the whole id as its title and its accessible name.
 */
export function ProofId({
  value,
  max,
  tail,
  className,
}: {
  readonly value: string;
  readonly max: number;
  readonly tail?: number;
  readonly className?: string;
}) {
  if (value.length > max) return <IdText value={value} max={max} tail={tail} className={className} />;
  return <span className={["pf-id", "fs-t-id", className].filter(Boolean).join(" ")}>{value}</span>;
}

/** An officer whose key signed the batch: the role, the key, and the person once the seed names them. */
export interface SignerView {
  /** "Treasurer" or "Chair". */
  readonly role: string;
  readonly keyId: string;
  readonly name?: string;
  readonly initials?: string;
}

export interface ProofHeroProps {
  readonly bundle: ProofBundle;
  readonly seasonLabel: string;
  readonly lotCode: string | null;
  readonly rail: PaypalRail;
  readonly verification: Verification;
  /** The page's own heading level: h1 on Proof, h2 under the brand view's strip. */
  readonly level?: "h1" | "h2";
  /**
   * The title's noun (round 5): "Proof" on its own page; "Season" under the brand view's strip, whose own title
   * already says "Proof for ...", so the page never reads "Proof" twice.
   */
  readonly noun?: string;
  /** The run's state, one chip on the title's row ("PayPal complete · cash due"). */
  readonly status?: ReactNode;
  /** Where every dollar went: the run's live line and the money bar, beside the verdict. */
  readonly money?: ReactNode;
  /** The officers whose keys signed the batch, each by name and role (treasurer, then Chair). */
  readonly signers?: readonly SignerView[];
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
  noun = "Proof",
  status,
  money,
  signers = [],
}: ProofHeroProps) {
  const Title = level;
  const paid = bundle.invoice.status === "PAID";
  const amount = format.money(bundle.invoice.amountCents);
  const keys = sealKeys(bundle);
  // ADR-0002, I8: an invoice marked paid on the simulator says the sandbox was simulated. The indicator at the
  // row's end says it on screen; the heading says it in words to a screen reader.
  const where = paid
    ? ""
    : rail === "simulator"
      ? " in a simulated PayPal sandbox"
      : " in PayPal’s own sandbox, a path not yet tested in this build";
  return (
    <section className="pf-hero" aria-labelledby="W-PF-01-title" data-testid="W-PF-01.hero">
      {/* The console's title row (round 5, grid.css): the noun and its grey season, the state's chip, the id line,
          and the quiet indicator at the end. What the invoice was, and that it was marked paid in a simulated
          sandbox, the heading says in words to a screen reader; on screen the money card carries the amount. */}
      <header className="fsc-screen__head pf-head">
        <Title id="W-PF-01-title" className="fsc-screen__title fs-t-title">
          {noun} <span className="fsc-screen__suffix fsc-nowrap">{seasonLabel}</span>
          <span className="fs-sr">{` · ${PAYER}’s ${amount} invoice, ${paid ? "paid" : "marked paid"}${where}`}</span>
        </Title>
        {status && (
          <div className="fsc-screen__status" data-testid="W-PF-01.status">
            {status}
          </div>
        )}
        {/* One id line: the payer, the lot in the id role, the page's one provenance phrase (round 5: provenance
            once; no legend glyph anywhere else). The lot's box is held from the first frame (proof.css): on a slow
            link the bundle lands before the seed that names it, and the code fills in place. Empty, it says nothing
            to a screen reader. */}
        <p className="fsc-screen__meta pf-head__meta">
          <span className="pf-head__payer fs-t-caption">{PAYER}</span>
          {lotCode && (
            <span className="fsc-screen__sep" aria-hidden>
              {" · "}
            </span>
          )}
          <span
            className="pf-hero__lot fs-t-id"
            data-testid="W-PF-01.lot"
            title={lotCode ? "Cacao lot" : undefined}
            aria-hidden={lotCode ? undefined : true}
          >
            {lotCode ?? ""}
          </span>
          <span className="fsc-screen__sep" aria-hidden>
            {" · "}
          </span>
          <span
            className="fsc-screen__provenance fs-t-caption"
            title={PROOF_PROVENANCE.title}
            data-testid="W-PF-01.synthetic"
          >
            {PROOF_PROVENANCE.text}
            <span className="fs-sr">{`. ${PROOF_PROVENANCE.title}`}</span>
          </span>
        </p>
        {/* The page's one quiet indicator (Proof has no top bar), at the row's end. */}
        <p className="fsc-screen__actions pf-head__tags">
          <span className="pf-head__rail" data-testid="W-PF-01.rail" data-rail={rail}>
            <HonestyTag quiet>{railShort(rail)}</HonestyTag>
          </span>
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

/** The line glyph beside a check that did not hold; a check that held is CheckMark's ✓ (CheckWords). */
export const SLOT_GLYPH: Partial<Record<SlotState, GlyphName>> = {
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

/**
 * A check's state in the one marker vocabulary (round 5): a check that held is ui-web's CheckMark, the 16 px line ✓
 * and its word in ink, never a filled disc; a mismatch keeps its line ✕, a withheld plate its lock, and the rest
 * their words alone. The six rows and the chain's plates draw it the same way.
 */
export function CheckWords({ state, words }: { readonly state: SlotState; readonly words: ReactNode }) {
  if (state === "matches" || state === "server") return <CheckMark>{words}</CheckMark>;
  const glyph = SLOT_GLYPH[state];
  return (
    <>
      {glyph && <Glyph name={glyph} size={16} />}
      <span>{words}</span>
    </>
  );
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
  /** The officers whose keys signed, one row each under the sample-keys line. */
  readonly signers?: readonly SignerView[];
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
                      {/* A verdict that held is the line ✓ and its word (round 5); the rest keep their own glyph. */}
                      {outcome.verdict === "verified" ? (
                        <CheckMark>{verdictWord(outcome.verdict)}</CheckMark>
                      ) : (
                        <>
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
                        </>
                      )}
                    </span>
                  )}
                  {sampleKeys && (
                    <p
                      className="pf-sample"
                      data-testid="W-PF-01.verdict.sample"
                      title={VERIFY_COPY.sampleTitle}
                    >
                      <KeyGlyph className="pf-sample__glyph" />
                      <span className="pf-sample__words">
                        {wordInChip ? (
                          <span
                            className="pf-sample__word"
                            data-verdict="sample"
                            data-testid="W-PF-01.verdict.word"
                          >
                            {verdictWord("sample")}
                          </span>
                        ) : (
                          <span className="pf-sample__word">{verdictWord("sample")}</span>
                        )}
                        <KeepLastWord text={VERIFY_COPY.sampleRest} />
                        <span className="fs-sr">. {VERIFY_COPY.sampleTitle}</span>
                      </span>
                    </p>
                  )}
                </div>
                {failurePlace && outcome.failure && (
                  <p className="pf-verify__failure" data-testid="W-PF-01.verdict.failure">
                    <strong>{failurePlace}:</strong> {outcome.failure.reason}
                  </p>
                )}
                {outcome.verdict === "partial" && <p className="pf-verify__note">{VERIFY_COPY.partial}</p>}
                <p className="pf-verify__meta fs-t-caption">
                  <time className="fs-t-id">{format.time(done.at)}</time>
                  {VERIFY_COPY.atRest}
                </p>
              </>
            )}
          </div>
          {/* Who signed: each officer by name and role, readable without zooming (round 5: no ids for people; the
              key they signed with is the row's title, and whole behind "IDs" and in plate 5). The record says who
              signed before any check (so the card keeps its shape when the verdict lands); the check row "2
              signatures on the batch hash" says whether the signatures hold. */}
          {signers.length > 0 && (
            <ul className="pf-signers" aria-label={VERIFY_COPY.signedBy} data-testid="W-PF-01.verdict.stamps">
              {signers.map((signer) => (
                <li
                  key={signer.keyId}
                  className="pf-signer"
                  data-testid="W-PF-01.verdict.signer"
                  title={VERIFY_COPY.keyTitle(signer.keyId)}
                >
                  {signer.initials ? (
                    <Avatar initials={signer.initials} className="pf-signer__avatar" />
                  ) : (
                    <span className="pf-signer__avatar" aria-hidden />
                  )}
                  <span className="pf-signer__who">
                    {signer.name && <span className="pf-signer__name">{signer.name}</span>}
                    {signer.name && " · "}
                    {signer.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
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
            {/* The ids in full, the keys a check pinned and where they came from: for a technical reader, behind
                one disclosure, so no file name or long id sits in view (round 4). */}
            {outcome && (
              <details className="pf-verify__ids">
                <summary className="pf-verify__ids-summary fs-t-label">
                  <Glyph name="ms:expand-more" size={16} className="pf-summary__chevron" />
                  {VERIFY_COPY.ids}
                </summary>
                <div className="pf-verify__anchors" data-testid="W-PF-01.verdict.anchors">
                  {/* PayPal's ids, said simulated in words to a screen reader (round 5: no inline legend glyph; the
                      page's indicator says it on screen). */}
                  {outcome.anchors.invoiceNumber && outcome.anchors.senderBatchId && (
                    <p className="pf-verify__anchors-head fs-t-caption">
                      <span className="fs-sr">{`${railShort(rail)}: `}</span>
                      {VERIFY_COPY.anchorsLead(rail)}
                    </p>
                  )}
                  <dl className="pf-kv">
                    {outcome.anchors.invoiceNumber && (
                      <div>
                        <dt>Invoice</dt>
                        <dd className="fs-t-id">{outcome.anchors.invoiceNumber}</dd>
                      </div>
                    )}
                    {outcome.anchors.invoiceReference && (
                      <div>
                        <dt>Reference</dt>
                        <dd className="fs-t-id">{outcome.anchors.invoiceReference}</dd>
                      </div>
                    )}
                    {outcome.anchors.senderBatchId && (
                      <div>
                        <dt>Payout batch</dt>
                        <dd className="fs-t-id">{outcome.anchors.senderBatchId}</dd>
                      </div>
                    )}
                    {outcome.anchors.batchNote && (
                      <div>
                        <dt>Note</dt>
                        <dd>{outcome.anchors.batchNote}</dd>
                      </div>
                    )}
                    {sampleKeys ? (
                      <div>
                        <dt>{VERIFY_COPY.sampleKeysRow}</dt>
                        <dd className="pf-kv__ids" data-testid="W-PF-01.verdict.keys">
                          {outcome.sampleKeys.map((key) => (
                            <ProofId key={key} value={key} max={KEY_ROOM} />
                          ))}
                        </dd>
                      </div>
                    ) : (
                      signers.length > 0 && (
                        <div>
                          <dt>{VERIFY_COPY.signingKeysRow}</dt>
                          <dd className="pf-kv__ids">
                            {signers.map((signer) => (
                              <ProofId key={signer.keyId} value={signer.keyId} max={KEY_ROOM} />
                            ))}
                          </dd>
                        </div>
                      )
                    )}
                    <div>
                      <dt>{VERIFY_COPY.keysRow}</dt>
                      <dd
                        className="pf-verify__trust"
                        data-testid="W-PF-01.verdict.trust"
                        data-trust={outcome.trust}
                        title={
                          outcome.trust === "published"
                            ? VERIFY_COPY.keysPublishedTitle
                            : VERIFY_COPY.keysSeedTitle
                        }
                      >
                        {outcome.trust === "published" ? (
                          <IdText value={KEYS_PATH} max={KEYS_FILE.length + 2} tail={KEYS_FILE.length} />
                        ) : (
                          VERIFY_COPY.keysSeed
                        )}
                      </dd>
                    </div>
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
                {slot.state !== "idle" && <CheckWords state={slot.state} words={rowWords(slot.state)} />}
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
