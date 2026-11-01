import { payoutReplayed, payoutReplaySummary } from "../../data/payout-replay.js";
// The chain (S1.8): six plates on one rule, in their real order. Each plate states its fact in a line, carries the
// check "Verify in your browser" runs for it, and expands in place to show its IDs and hashes. Plate 4 holds every
// member's line (and MM-7's trace), plate 6 the payout items as our record of PayPal's notices.

import {
  PAYOUT_ITEM_STATUS_LABELS,
  type PayoutItemStatus,
  type PlateName,
  type ProofBundle,
  type Provenance,
  pickLabel,
  type SnapshotSlip,
} from "@fairsplit/contracts";
import { Chip, type ChipTone, Glyph, type GlyphName } from "@fairsplit/ui-web";
import { type CSSProperties, type ReactNode, useEffect, useId, useState } from "react";
import { ScrollRegion } from "../../chrome/ScrollRegion.js";
import type { PaypalRail } from "../../lib/env.js";
import { format } from "../../lib/format.js";
import { signingKeyKind } from "../../lib/keys.js";
import {
  invoiceWords,
  PLATE_CHECK,
  PLATE_TITLE,
  provenanceWords,
  railName,
  STATE_COPY,
  t,
  VERIFY_COPY,
} from "./copy.js";
import { davaoDateTime } from "./davao.js";
import { SLOT_GLYPH, slotOf, slotWords } from "./Hero.js";
import { Lines, type MemberLabel } from "./Lines.js";
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

/** One sentence per plate, every figure computed from the bundle. */
export function plateFact(
  plate: PlateName,
  p: Pick<ChainProps, "bundle" | "facts" | "progress" | "items" | "lineStates" | "replayed">,
): string {
  const { bundle, facts, progress } = p;
  switch (plate) {
    case "paid":
      return `${bundle.invoice.invoiceNumber}, ${invoiceWords(bundle.invoice.status).toLowerCase()}, ${format.money(bundle.invoice.amountCents)}`;
    case "ratified":
      return `Card ${format.hashGroups(bundle.rateCard.sha256)}, ratified ${format.date(bundle.rateCard.ratifiedAt)}, first slip ${format.date(bundle.firstSlipDate)}`;
    case "read":
      return `${facts.slipsAccepted} slips: ${photoGroups(bundle).images.length} photos composed in code from Codex-made hero flats and code-drawn slips, plus ${photoGroups(bundle).manifest.length} earlier photo-manifest entries (not imaged)`;
    case "computed":
      return `${bundle.lines.length} line hashes, ${format.money(sumCents(bundle.lines.map((l) => l.netCents)))} net`;
    case "twoKeys":
      return `${bundle.approvals.map((a) => a.keyId).join(" and ")}, batch ${format.hashGroups(bundle.batch.batchSha256)}`;
    case "payoutItems": {
      if (p.replayed || payoutReplayed(undefined, null, bundle))
        return payoutReplaySummary(progress.confirmed, progress.total);
      if (!isSettled(progress)) return STATE_COPY.progress(progress.confirmed, progress.total);
      const parts = [STATE_COPY.settled(progress.confirmed, progress.total).replace(/\.$/, "")];
      if (progress.returned > 0)
        parts.push(STATE_COPY.returned(progress.returned, returnedCashPaid(p.items, p.lineStates)));
      if (progress.failed > 0) parts.push(`${progress.failed} not completed by PayPal`);
      if (progress.reversed > 0) parts.push(`${progress.reversed} reversed`);
      return `${parts.join(", ")}.`;
    }
  }
}

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
                  <span className="pf-plate__title">{t(PLATE_TITLE[plate])}</span>
                  <span className="pf-plate__fact" data-testid={`W-PF-01.plate.${plate}.fact`}>
                    {plateFact(plate, props)}
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
              ["Slips", String(facts.slipsAccepted)],
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
                "Photo hashes: composed in code from Codex-made hero flats and code-drawn slips",
                "W-PF-01.photo-hashes",
              ],
              ["manifest", "Earlier photo-manifest hashes (not imaged)", "W-PF-01.manifest-hashes"],
            ] as const
          ).map(([kind, label, testId]) => (
            <div key={kind}>
              <p className="pf-plate__lead">{label} (SHA-256, first eight characters)</p>
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
            replayed={p.replayed || payoutReplayed(undefined, null, bundle)}
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

function Items({
  bundle,
  items,
  names,
  rail,
  replayed = payoutReplayed(undefined, null, bundle),
}: ChainProps) {
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
            ? "These statuses are our record of the simulated sandbox's signed item notices."
            : "These statuses are our record of PayPal's signed item notices on the configured rail (not simulated). No nightly reconciliation is served in this build."}
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
              const tone = ITEM_TONE[item.status];
              const label = item.memberNo ? names?.get(item.memberNo) : undefined;
              return (
                <tr
                  key={item.senderItemId}
                  data-state={item.status}
                  data-testid={`W-PF-01.item.${item.senderItemId}`}
                >
                  <th scope="row" className="fs-t-hash">
                    {item.senderItemId}
                  </th>
                  {names && <td>{label?.name ?? ""}</td>}
                  {names && <td className="pf-table__receiver">{label?.receiverMasked ?? ""}</td>}
                  <td data-numeric="">
                    <span
                      className="fs-t-figure"
                      data-amount-state={item.status === "SUCCESS" ? "landed" : "hollow"}
                    >
                      {format.money(item.amountCents)}
                    </span>
                  </td>
                  <td>
                    <Chip tone={tone.tone} glyph={tone.glyph}>
                      {replayed
                        ? "Replayed (labelled)"
                        : pickLabel(PAYOUT_ITEM_STATUS_LABELS[item.status], "en")}
                    </Chip>
                  </td>
                  <td className="fs-t-hash">{item.payoutItemId ?? "Not yet"}</td>
                  <td className="fs-t-hash">{replayed ? "Replayed, simulated" : noticeOf(item)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollRegion>
    </>
  );
}
