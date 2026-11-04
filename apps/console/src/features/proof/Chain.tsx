import { payoutReplayed, payoutReplaySummary, payoutStatus } from "../../data/payout-replay.js";
// The chain (S1.8): six plates on one rule, in their real order. Each plate states its fact in a line, carries the
// check "Verify in your browser" runs for it, and expands in place to show its IDs and hashes. Plate 4 holds every
// member's line (and MM-7's trace), plate 6 the payout items as our record of PayPal's notices.

import type {
  PayoutItemStatus,
  PlateName,
  ProofBundle,
  Provenance,
  SnapshotSlip,
} from "@fairsplit/contracts";
import { Chip, type ChipTone, Glyph, type GlyphName, LegendGlyph } from "@fairsplit/ui-web";
import { type CSSProperties, Fragment, type ReactNode, useEffect, useId, useState } from "react";
import { ScrollRegion } from "../../chrome/ScrollRegion.js";
import { SHOWCASE_LABEL } from "../../lib/display.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { signingKeyKind } from "../../lib/keys.js";
import {
  invoiceWords,
  PLATE_CHECK,
  PLATE_TITLE,
  provenanceWords,
  railName,
  railShort,
  STATE_COPY,
  t,
  VERIFY_COPY,
} from "./copy.js";
import { davaoDateTime } from "./davao.js";
import { SLOT_GLYPH, slotOf, slotWords } from "./Hero.js";
import { Lines, type MemberLabel, RailWord } from "./Lines.js";
import {
  isSettled,
  type LedgerFacts,
  type LineStates,
  type ProgressCounts,
  type ProofItemView,
  returnedCashPaid,
} from "./model.js";
import type { VerifyState } from "./useVerification.js";
import { PLATES } from "./verify.js";

export interface ChainProps {
  readonly bundle: ProofBundle;
  readonly replayed?: boolean;
  readonly facts: LedgerFacts;
  readonly items: readonly ProofItemView[];
  readonly lineStates: LineStates;
  readonly progress: ProgressCounts;
  readonly verify: VerifyState;
  readonly rail: PaypalRail;
  readonly provenance: Provenance | null;
  readonly slips: ReadonlyMap<string, SnapshotSlip>;
  readonly ruleNames: ReadonlyMap<string, string>;
  readonly markNames: ReadonlyMap<string, string>;
  /** The brand's view only: names and masked receivers under the data-sharing agreement (C-23). */
  readonly names: ReadonlyMap<string, MemberLabel> | null;
  /** This is the seeded showcase run's Proof, not a judge's own run: its invoice id says so (UI gate round 3). */
  readonly showcase?: boolean;
}

const ITEM_TONE: Readonly<Record<PayoutItemStatus, { tone: ChipTone; glyph: GlyphName }>> = {
  SUBMITTED: { tone: "pencil", glyph: "rail" },
  PENDING: { tone: "pencil", glyph: "rail" },
  ONHOLD: { tone: "canary", glyph: "ms:pause" },
  UNCLAIMED: { tone: "canary", glyph: "ms:pause" },
  RETURNED: { tone: "neutral", glyph: "ms:arrow-back" },
  FAILED: { tone: "red", glyph: "ms:help" },
  BLOCKED: { tone: "red", glyph: "ms:help" },
  SUCCESS: { tone: "jade", glyph: "ms:check" },
  REFUNDED: { tone: "red", glyph: "ms:restart-alt" },
  REVERSED: { tone: "red", glyph: "ms:restart-alt" },
};

function seasonOf(code: string): string {
  return code.replace(/^(\d{4})([A-Z])$/, "$1-$2");
}

function sumCents(xs: readonly number[]): number {
  return xs.reduce((s, x) => s + x, 0);
}

/** Accepted A-L images have real composed bytes; later entries describe manifests only. */
function photoGroups(bundle: ProofBundle) {
  const imaged = new Set(
    bundle.ledger.flatMap((entry) => {
      if (entry.kind !== "rows.accepted") return [];
      const payload = entry.payload as { photoId?: string; documentId?: string };
      return payload.photoId && /^[A-L]$/.test(payload.photoId) && payload.documentId
        ? [payload.documentId]
        : [];
    }),
  );
  return {
    images: bundle.documents.filter((doc) => imaged.has(doc.documentId)),
    manifest: bundle.documents.filter((doc) => !imaged.has(doc.documentId)),
  };
}

/**
 * The slips the chain accepted, with their scope said (UI gate round 3, one truth for counts): this run read the
 * slips on its imaged photos A-L (48), and the season's record holds every slip in its 66 photos (264), the 54
 * earlier manifest-only photos included. Both are counted from the bundle's own ledger.
 */
export function slipScope(bundle: Pick<ProofBundle, "ledger">): {
  readonly run: number;
  readonly season: number;
} {
  let run = 0;
  let season = 0;
  for (const entry of bundle.ledger) {
    if (entry.kind !== "rows.accepted") continue;
    const payload = entry.payload as { photoId?: string | null; serials?: readonly string[] };
    const n = payload.serials?.length ?? 0;
    season += n;
    if (payload.photoId && /^[A-L]$/.test(payload.photoId)) run += n;
  }
  return { run, season };
}

/** One piece of a plate's fact line: words, an id (the id role's code-like figures) or money (the money role). */
export interface FactPart {
  readonly text: string;
  readonly role?: "id" | "money";
  /** Words before or after the piece, in the line's own face ("card", "net"). */
  readonly before?: string;
  readonly after?: string;
}

type FactProps = Pick<ChainProps, "bundle" | "facts" | "progress" | "items" | "lineStates" | "replayed"> & {
  readonly showcase?: boolean;
};

/** A plate's fact as pieces, so ids and money each keep their numeral role on screen. */
export function plateParts(plate: PlateName, p: FactProps): readonly FactPart[] {
  const { bundle, progress } = p;
  switch (plate) {
    case "paid": {
      const words = invoiceWords(bundle.invoice.status);
      return [
        { text: bundle.invoice.invoiceNumber, role: "id" },
        ...(p.showcase ? [{ text: SHOWCASE_LABEL }] : []),
        { text: `${words.charAt(0).toLowerCase()}${words.slice(1)}` },
        { text: format.money(bundle.invoice.amountCents), role: "money" },
      ];
    }
    case "ratified":
      return [
        { text: format.hashGroups(bundle.rateCard.sha256), role: "id", before: "card " },
        { text: `ratified ${format.date(bundle.rateCard.ratifiedAt)}` },
        { text: `first slip ${format.date(bundle.firstSlipDate)}` },
      ];
    case "read": {
      const slips = slipScope(bundle);
      // A record with no imaged photos has no "this run" to say: the season's count stands alone.
      return slips.run > 0
        ? [{ text: `${slips.run} this run` }, { text: `${slips.season} season` }]
        : [{ text: `${slips.season} slips` }];
    }
    case "computed":
      return [
        { text: `${bundle.lines.length} line hashes` },
        { text: format.money(sumCents(bundle.lines.map((l) => l.netCents))), role: "money", after: " net" },
      ];
    case "twoKeys":
      return [
        ...bundle.approvals.map((a): FactPart => ({ text: a.keyId, role: "id" })),
        { text: format.hashGroups(bundle.batch.batchSha256), role: "id", before: "batch " },
      ];
    case "payoutItems": {
      if (p.replayed || payoutReplayed(undefined, bundle))
        return [{ text: payoutReplaySummary(progress.confirmed, progress.total) }];
      if (!isSettled(progress)) return [{ text: STATE_COPY.progress(progress.confirmed, progress.total) }];
      const parts: FactPart[] = [{ text: STATE_COPY.settled(progress.confirmed, progress.total) }];
      if (progress.returned > 0)
        parts.push({ text: STATE_COPY.returned(progress.returned, returnedCashPaid(p.items, p.lineStates)) });
      if (progress.failed > 0) parts.push({ text: `${progress.failed} not completed by PayPal` });
      if (progress.reversed > 0) parts.push({ text: `${progress.reversed} reversed` });
      return parts;
    }
  }
}

/** One line of data per plate, joined by " · ", every figure computed from the bundle. */
export function plateFact(plate: PlateName, p: FactProps): string {
  return plateParts(plate, p)
    .map((part) => `${part.before ?? ""}${part.text}${part.after ?? ""}`)
    .join(" · ");
}

function FactLine({ parts }: { readonly parts: readonly FactPart[] }) {
  return (
    <>
      {parts.map((part, i) => (
        <Fragment key={`${i}-${part.text}`}>
          {i > 0 && " · "}
          {part.before}
          {part.role === "id" ? (
            <span className="fs-t-hash">{part.text}</span>
          ) : part.role === "money" ? (
            <span className="pf-fact__money">{part.text}</span>
          ) : (
            part.text
          )}
          {part.after}
        </Fragment>
      ))}
    </>
  );
}

/** The plates whose fact is PayPal's (plate 1's status already names the simulated sandbox in words): each carries
 * the simulated legend glyph beside its title, its words as tooltip and name. */
const PAYPAL_PLATES: ReadonlySet<PlateName> = new Set(["payoutItems"]);

export function Chain(props: ChainProps) {
  const [open, setOpen] = useState<ReadonlySet<PlateName>>(new Set());
  const baseId = useId();
  const failed = props.verify.kind === "done" ? props.verify.outcome.failure?.where : undefined;

  // A mismatch opens the plate it names, so the reason is in view.
  useEffect(() => {
    if (failed && failed !== "chain" && failed !== "checkpoint") {
      setOpen((prev) => (prev.has(failed) ? prev : new Set([...prev, failed])));
    }
  }, [failed]);

  const toggle = (plate: PlateName) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(plate)) next.delete(plate);
      else next.add(plate);
      return next;
    });

  const settled = isSettled(props.progress);
  return (
    <section className="pf-chain" aria-labelledby={`${baseId}-chain`} data-testid="W-PF-01.chain">
      <h2 id={`${baseId}-chain`} className="pf-section__title">
        {t("W-PF-01.chain")}
      </h2>
      <ol className="pf-chain__list">
        {PLATES.map((plate, index) => {
          const slot = slotOf(plate, props.verify);
          const isOpen = open.has(plate);
          const bodyId = `${baseId}-${plate}`;
          const waiting = plate === "payoutItems" && !settled;
          const glyph = SLOT_GLYPH[slot.state];
          return (
            <li
              key={plate}
              className="pf-plate"
              data-plate={plate}
              data-state={slot.state}
              data-waiting={waiting ? "" : undefined}
              data-open={isOpen ? "" : undefined}
              data-testid={`W-PF-01.plate.${plate}`}
              style={{ "--pf-i": index } as CSSProperties}
            >
              <span className="pf-plate__node" aria-hidden>
                {index + 1}
              </span>
              <h3 className="pf-plate__head">
                <button
                  type="button"
                  className="pf-plate__toggle"
                  aria-expanded={isOpen}
                  aria-controls={bodyId}
                  onClick={() => toggle(plate)}
                  data-testid={`W-PF-01.plate.${plate}.toggle`}
                >
                  <span className="pf-plate__title">
                    {t(PLATE_TITLE[plate])}
                    {PAYPAL_PLATES.has(plate) && (
                      <LegendGlyph
                        kind="simulated"
                        label={railShort(props.rail)}
                        testId={`W-PF-01.plate.${plate}.rail`}
                      />
                    )}
                  </span>
                  <span className="pf-plate__fact" data-testid={`W-PF-01.plate.${plate}.fact`}>
                    <FactLine parts={plateParts(plate, props)} />
                  </span>
                  <Glyph
                    name={isOpen ? "ms:expand-less" : "ms:expand-more"}
                    size={20}
                    className="pf-plate__chevron"
                  />
                </button>
              </h3>
              <p className="pf-plate__check" data-state={slot.state} data-testid={`W-PF-01.check.${plate}`}>
                {glyph && <Glyph name={glyph} size={16} />}
                <span>{slot.state === "replay" && slot.reason ? slot.reason : slotWords(slot.state)}</span>
              </p>
              <div className="pf-plate__body" id={bodyId} hidden={!isOpen}>
                {isOpen && (
                  <>
                    <p className="pf-plate__what">
                      <Glyph name="seal" size={16} />
                      <span>{t(PLATE_CHECK[plate])}.</span>
                    </p>
                    {(slot.state === "differs" || slot.state === "replay") && slot.reason && (
                      <p className="pf-plate__reason" data-testid={`W-PF-01.plate.${plate}.reason`}>
                        {slot.reason}
                      </p>
                    )}
                    {slot.state === "server" && <p className="pf-plate__note">{VERIFY_COPY.serverNote}</p>}
                    {slot.state === "withheld" && (
                      <p className="pf-plate__note">{VERIFY_COPY.withheldNote}</p>
                    )}
                    <PlateBody plate={plate} {...props} />
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Facts({ rows }: { readonly rows: readonly (readonly [string, ReactNode] | null)[] }) {
  return (
    <dl className="pf-facts">
      {rows
        .filter((r): r is readonly [string, ReactNode] => r !== null)
        .map(([label, value]) => (
          <div key={label} className="pf-facts__row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

function Hash({ hex, all = true }: { readonly hex: string; readonly all?: boolean }) {
  return (
    <span className="fs-t-hash pf-hash">{all ? format.hashAllGroups(hex) : format.hashGroups(hex)}</span>
  );
}

function Figure({ cents, state = "ink" }: { readonly cents: number; readonly state?: string }) {
  return (
    <span className="fs-t-figure" data-amount-state={state}>
      {format.money(cents)}
    </span>
  );
}

/** A key's kind in words: the registry's, else its ID's shape (C-13); a sample by either reads as a sample. */
function keyKindWords(kind: string, keyId: string): string {
  const byShape = signingKeyKind(keyId);
  if (kind === "seeded" || byShape === "seeded") return "Sample key (seeded)";
  if (kind === "web_demo" || byShape === "web_demo") return "Demo key, made in a judge's browser";
  return (kind || byShape) === "web" ? "Browser key" : "Device key";
}

function PlateBody({ plate, ...p }: ChainProps & { readonly plate: PlateName }) {
  const { bundle, facts } = p;
  switch (plate) {
    case "paid":
      return (
        <Facts
          rows={[
            [
              "Invoice",
              <span key="n" className="fs-t-hash">
                {bundle.invoice.invoiceNumber}
              </span>,
            ],
            ["Status", invoiceWords(bundle.invoice.status)],
            ["Amount", <Figure key="a" cents={bundle.invoice.amountCents} state="landed" />],
            ["Due", <Figure key="d" cents={bundle.invoice.dueCents} state="landed" />],
            [
              "Reference",
              <span key="r" className="fs-t-hash">
                {bundle.invoice.reference}
              </span>,
            ],
            facts.fundedAt ? ["Funded", davaoDateTime(facts.fundedAt)] : null,
            ["Rail", railName(p.rail)],
            p.provenance ? ["This record", provenanceWords(p.provenance)] : null,
          ]}
        />
      );
    case "ratified":
      return (
        <Facts
          rows={[
            ["Card hash", <Hash key="h" hex={bundle.rateCard.sha256} />],
            ["Resolution", bundle.rateCard.canonical.resolutionNo],
            ["Season", seasonOf(bundle.rateCard.canonical.season)],
            ["Ratified", format.date(bundle.rateCard.ratifiedAt)],
            ["First slip", format.date(bundle.firstSlipDate)],
            [
              "Co-sign above",
              `${format.money(bundle.rateCard.canonical.rules.cosign.batchOverCents)} a batch, ${format.money(bundle.rateCard.canonical.rules.cosign.lineOverCents)} a line`,
            ],
          ]}
        />
      );
    case "read":
      return (
        <>
          <Facts
            rows={[
              ["Slips", plateFact("read", p)],
              [
                "In the chain",
                `${facts.photosAccepted} image or manifest hashes accepted before the lines were computed`,
              ],
            ]}
          />
          {(
            [
              [
                "images",
                `${photoGroups(bundle).images.length} photos composed in code from AI-generated, synthetic hero flats and code-drawn slips`,
                "W-PF-01.photo-hashes",
              ],
              [
                "manifest",
                `${photoGroups(bundle).manifest.length} earlier photo-manifest entries (not imaged)`,
                "W-PF-01.manifest-hashes",
              ],
            ] as const
          ).map(([kind, label, testId]) => (
            <div key={kind}>
              <p className="pf-plate__lead">
                {label} <span className="fs-t-hash">· SHA-256, first 8</span>
              </p>
              <ol className="pf-hashes" data-testid={testId}>
                {photoGroups(bundle)[kind].map((d) => (
                  <li key={d.documentId} className="fs-t-hash">
                    {format.hashGroups(d.sha256)}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </>
      );
    case "computed": {
      const premium = sumCents(bundle.lines.map((l) => l.premiumCents));
      const bonus = sumCents(bundle.lines.map((l) => l.bonusCents));
      const deductions = sumCents(bundle.lines.map((l) => l.deductionsCents));
      const credits = sumCents(bundle.lines.map((l) => l.creditsCents));
      const net = sumCents(bundle.lines.map((l) => l.netCents));
      return (
        <>
          <p className="pf-conservation" data-testid="W-PF-01.conservation">
            Premium <Figure cents={premium} /> plus bonus <Figure cents={bonus} /> is{" "}
            <Figure cents={premium + bonus} />. Less <Figure cents={deductions} /> in ruled deductions, plus{" "}
            <Figure cents={credits} /> in credits, is <Figure cents={net} /> net.
            {facts.computed?.balanced ? " The engine recorded it balanced." : ""}
          </p>
          <Facts
            rows={[
              facts.computed
                ? ["Lines root", <Hash key="root" hex={facts.computed.linesRootSha256} />]
                : null,
              ["Premium pool", <Figure key="pp" cents={bundle.pools.premiumPoolCents} />],
              ["Bonus pool", <Figure key="bp" cents={bundle.pools.bonusPoolCents} />],
            ]}
          />
          <Lines
            bundle={bundle}
            items={p.items}
            lineStates={p.lineStates}
            slips={p.slips}
            ruleNames={p.ruleNames}
            markNames={p.markNames}
            card={bundle.rateCard.canonical.resolutionNo}
            names={p.names}
          />
        </>
      );
    }
    case "twoKeys":
      return (
        <>
          <Facts rows={[["Batch hash", <Hash key="b" hex={bundle.batch.batchSha256} />]]} />
          <ul className="pf-keys" data-testid="W-PF-01.keys">
            {bundle.approvals.map((a) => {
              const reg = facts.keys.find((k) => k.keyId === a.keyId);
              return (
                <li key={a.keyId} className="pf-keys__key">
                  <span className="pf-keys__role">{a.role === "treasurer" ? "Treasurer" : "Chair"}</span>
                  <span className="fs-t-hash">{a.keyId}</span>
                  <span className="pf-keys__kind">{keyKindWords(reg?.kind ?? "", a.keyId)}</span>
                  <span className="pf-keys__meta">
                    Signs as {a.payload.approverId}
                    {reg ? `, registered in the chain at entry ${reg.seq}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      );
    case "payoutItems":
      return <Items {...p} />;
  }
}

const NOTICE_WORDS: Readonly<Record<Exclude<ProofItemView["source"], "bundle">, string>> = {
  webhook: "Item notice, this run",
  status_check: "Status check",
  post_response: "PayPal's answer to the batch",
  cancel: "Our cancel",
  seed: "Seeded",
};

/** The notice an item's status rests on: PayPal's event ID in the record, or how a live run learned it. */
export function noticeOf(item: ProofItemView): string {
  if (item.source === "bundle") return item.eventId ?? "None yet";
  return NOTICE_WORDS[item.source];
}

function Items({ bundle, items, names, rail, replayed = payoutReplayed(undefined, bundle) }: ChainProps) {
  return (
    <>
      <Facts
        rows={[
          [
            "Batch",
            <span key="b" className="fs-t-hash">
              {bundle.batch.senderBatchId}
            </span>,
          ],
          ["Note", bundle.batch.note],
          ["Rail", railName(rail)],
        ]}
      />
      <p className="pf-plate__note">
        {replayed
          ? "These statuses are a labelled replay of an earlier simulated PayPal sandbox run, including a seed snapshot. No simulator confirmation is claimed for this run."
          : rail === "simulator"
            ? "Our record of the simulated sandbox's signed item notices."
            : "Our record of PayPal's signed item notices on the configured rail (not simulated). No nightly reconciliation in this build."}
      </p>
      <ScrollRegion className="pf-table-wrap" label="Payout items, amount and status">
        <table className="pf-table" data-testid="W-PF-01.items">
          <caption className="fs-sr">Payout items: amount, status and PayPal's IDs</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              {names && <th scope="col">Name</th>}
              {names && <th scope="col">Receiver</th>}
              <th scope="col" data-numeric="">
                Amount
              </th>
              <th scope="col">Status</th>
              <th scope="col">PayPal item</th>
              <th scope="col">Notice</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const presentation = payoutStatus({
                itemStatus: item.status,
                bundle,
                memberNo: item.memberNo,
                senderItemId: item.senderItemId,
                provenance: item.provenance,
              });
              const tone = ITEM_TONE[item.status];
              const label = item.memberNo ? names?.get(item.memberNo) : undefined;
              return (
                <tr
                  key={item.senderItemId}
                  data-state={presentation.replayed ? "replay" : item.status}
                  data-testid={`W-PF-01.item.${item.senderItemId}`}
                >
                  <th scope="row" className="fs-t-hash">
                    {item.senderItemId}
                  </th>
                  {names && <td>{label?.name ?? ""}</td>}
                  {names && <td className="pf-table__receiver">{label?.receiverMasked ?? ""}</td>}
                  <td data-numeric="">
                    <span className="fs-t-figure" data-amount-state={presentation.amountState}>
                      {format.money(item.amountCents)}
                    </span>
                  </td>
                  <td>
                    <Chip tone={presentation.tone} glyph={presentation.replayed ? "rail" : tone.glyph}>
                      <RailWord presentation={presentation} />
                    </Chip>
                  </td>
                  <td className="fs-t-hash">{item.payoutItemId ?? "Not yet"}</td>
                  <td className="fs-t-hash">
                    {presentation.replayed ? "Replayed, simulated" : noticeOf(item)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
