// W-BR-01's header strip (S1.8 W-PF-02, design B1): who this Proof is for, the invoice's status, the payouts as
// PayPal confirms them ("3 of 8 confirmed", live), and the export. Names and masked receivers show on screen
// under the data-sharing agreement; complete receivers and plot details only in the export (C-23).
// Round 5: the strip's title is the console's title row, a noun with a grey suffix ("Proof for Lantern Bay
// Chocolate Co."), and the Proof column under it heads itself "Season 2026-A", so "Proof" is said once. The payouts
// fact says its counts in view and the rail in words for a screen reader (the page's quiet indicator says it on
// screen).

import type { InvoiceStatus, ProofBundle, SeasonSnapshot } from "@fairsplit/contracts";
import { Glyph, HonestyTag, StateDot } from "@fairsplit/ui-web";
import { type ReactNode, useState } from "react";
import { payoutReplaySummary } from "../../data/payout-replay.js";
import { SHOWCASE_LABEL } from "../../lib/display.js";
import type { PaypalRail } from "../../lib/env.js";
import { invoiceWords, railShort, STATE_COPY } from "../proof/copy.js";
import { isSettled, type ProgressCounts } from "../proof/model.js";
import { downloadText, exportFileName, membersOf, proofCsv, proofJson } from "./exportProof.js";

/** W-BR-01's `data-state` (S1.8): unpaid, progress, mismatch; plus the shell's loading and error. */
export type BrandState = "loading" | "error" | "unpaid" | "progress" | "mismatch";

export const FUNDED: readonly InvoiceStatus[] = ["PAID", "MARKED_AS_PAID"];

/** The rail after "confirmed" (inv.i8): heard by a screen reader on the fact itself; the page's indicator shows it. */
function byRail(rail: PaypalRail): string {
  return rail === "simulator" ? " by the simulated PayPal sandbox" : " on PayPal's sandbox (not simulated)";
}

/** "7 of 8 confirmed" in view, the rail in words for a screen reader, then what follows (" · updating"). */
function Confirmed({
  confirmed,
  total,
  rail,
  rest,
}: {
  readonly confirmed: number;
  readonly total: number;
  readonly rail: PaypalRail;
  readonly rest: string;
}): ReactNode {
  // One span, so the fact's flex row never puts its gap around the hidden words.
  return (
    <span>
      {`${confirmed} of ${total} confirmed`}
      <span className="fs-sr">{byRail(rail)}</span>
      {rest}
    </span>
  );
}

export const BRAND_COPY = {
  title: "Proof",
  /** The title's grey suffix: who the Proof is for. */
  titleFor: (payer: string) => `for ${payer}`,
  for: (name: string, title: string) => `Shared with ${name} · ${title}`,
  /** Why names show here, as the line's title and to a screen reader (C-23). */
  agreement: "Shared under the data-sharing agreement",
  invoice: "Invoice",
  payouts: "Payouts",
  unpaid: "Sent to Lantern Bay. Waiting for payment.",
  progress: (confirmed: number, total: number, rail: PaypalRail) => (
    <Confirmed confirmed={confirmed} total={total} rail={rail} rest=" · updating" />
  ),
  settled: (p: ProgressCounts, cashPaid: number, rail: PaypalRail) => (
    <Confirmed
      confirmed={p.confirmed}
      total={p.total}
      rail={rail}
      rest={p.returned > 0 ? ` · ${STATE_COPY.returned(p.returned, cashPaid)}` : ""}
    />
  ),
  notYet: "The payout batch isn't posted yet.",
  export: "Export",
  /** The two downloads name their formats, so the label says only what both carry (round 4: copy only shortens). */
  exportWhat: "with hashes",
  csv: "Download CSV",
  json: "Download JSON",
  exportNote: "Full receivers and plots: in the export only, built in this browser",
  exported: (name: string) => `Saved ${name}.`,
  noDownload: "This browser can't save files from here. Use the JSON link of the public Proof instead.",
  withheld: "Proof withheld: the record doesn't match its signatures. Exports wait until it does.",
  refused: "This brand link isn't valid any more. Ask the co-op's treasurer for a new one.",
  refusedHint: "The public Proof, with member IDs only, stays open to anyone.",
  failed: "The brand view didn't load.",
  openPublic: "Open the public Proof",
} as const;

export interface BrandHeaderProps {
  readonly state: BrandState;
  readonly snapshot: SeasonSnapshot | undefined;
  readonly bundle: ProofBundle | null;
  /** The invoice status the console knows (the run's own, before a Proof exists). */
  readonly invoiceStatus: InvoiceStatus | null;
  readonly invoiceNumber: string | null;
  readonly progress: ProgressCounts;
  /** Of the items PayPal returned, how many lines the clerk attested as paid in cash (the rest are due). */
  readonly returnedCashPaid: number;
  readonly posted: boolean;
  readonly rail: PaypalRail;
  readonly provenance: string | null;
  readonly payoutReplayed?: boolean;
  /** The seeded showcase run's Proof, not a judge's own: its invoice id is labelled as the showcase's. */
  readonly showcase?: boolean;
}

export function BrandHeader({
  state,
  snapshot,
  bundle,
  invoiceStatus,
  invoiceNumber,
  progress,
  returnedCashPaid,
  posted,
  rail,
  provenance,
  payoutReplayed = false,
  showcase = false,
}: BrandHeaderProps) {
  const [saved, setSaved] = useState<string | null>(null);
  const payer = snapshot?.payer;
  const save = (ext: "csv" | "json") => {
    if (!bundle) return;
    const members = membersOf(snapshot);
    const name = exportFileName(bundle.runSlug, ext);
    // Both files carry the rail every PayPal value ran on, and the bundle's provenance (I8).
    const meta = { rail: rail === "sandbox" ? ("sandbox" as const) : ("simulated" as const), provenance };
    const ok =
      ext === "csv"
        ? downloadText(name, proofCsv(bundle, members, meta), "text/csv;charset=utf-8")
        : downloadText(
            name,
            proofJson(bundle, members, { generatedAt: new Date().toISOString(), ...meta }),
            "application/json",
          );
    setSaved(ok ? BRAND_COPY.exported(name) : BRAND_COPY.noDownload);
  };
  const withheld = state === "mismatch";
  return (
    <header className="br-strip" data-testid="W-BR-01.header" data-state={state}>
      <div className="br-strip__who">
        {/* The console's title row (round 5): a noun and its grey suffix, one heading. */}
        <h1 className="fsc-screen__title br-strip__title fs-t-title" id="W-BR-01-title">
          {BRAND_COPY.title}{" "}
          <span className="fsc-screen__suffix">{BRAND_COPY.titleFor(payer?.name ?? "the brand")}</span>
        </h1>
        {payer && (
          <p className="br-strip__for fs-t-caption" title={BRAND_COPY.agreement}>
            {BRAND_COPY.for(payer.contactName, payer.contactTitle)}
            <span className="fs-sr">{`. ${BRAND_COPY.agreement}`}</span>
          </p>
        )}
      </div>
      <dl className="br-strip__facts">
        <div
          className="br-strip__fact"
          data-testid="W-BR-01.invoice"
          data-state={state === "unpaid" ? "unpaid" : "funded"}
        >
          <dt>{BRAND_COPY.invoice}</dt>
          <dd>
            {invoiceNumber && <span className="fs-t-id">{invoiceNumber}</span>}
            {invoiceNumber && showcase && (
              <span className="br-strip__showcase fs-t-caption" data-testid="W-BR-01.invoice.showcase">
                {SHOWCASE_LABEL}
              </span>
            )}{" "}
            <span className="br-strip__status">
              {/* Waiting for the brand's payment: the person reading must act, so the amber dot (never a fill). */}
              {state === "unpaid" && <StateDot kind="held" />}
              {state === "unpaid" || !invoiceStatus ? BRAND_COPY.unpaid : invoiceWords(invoiceStatus)}
            </span>
            {/* Before payment no Proof column sits under the strip, so its quiet indicator is the page's one. */}
            {state === "unpaid" && <HonestyTag quiet>{railShort(rail)}</HonestyTag>}
          </dd>
        </div>
        <div
          className="br-strip__fact"
          data-testid="W-BR-01.payouts"
          data-settled={isSettled(progress) ? "" : undefined}
        >
          <dt>{BRAND_COPY.payouts}</dt>
          <dd>
            {!posted || progress.total === 0
              ? BRAND_COPY.notYet
              : payoutReplayed
                ? payoutReplaySummary(progress.confirmed, progress.total)
                : isSettled(progress)
                  ? BRAND_COPY.settled(progress, returnedCashPaid, rail)
                  : BRAND_COPY.progress(progress.confirmed, progress.total, rail)}
          </dd>
        </div>
      </dl>
      <div className="br-strip__export" data-testid="W-BR-01.export">
        <p className="br-strip__label">
          {BRAND_COPY.export} <span className="br-strip__what fs-t-caption">{BRAND_COPY.exportWhat}</span>
        </p>
        {withheld ? (
          <p className="br-strip__withheld" data-testid="W-BR-01.export.withheld">
            <Glyph name="ms:lock" size={16} />
            {BRAND_COPY.withheld}
          </p>
        ) : (
          <div className="br-strip__buttons">
            <button
              type="button"
              className="fs-flat"
              disabled={!bundle || !posted}
              onClick={() => save("csv")}
              data-testid="W-BR-01.export.csv"
            >
              <Glyph name="logbook" size={18} />
              {BRAND_COPY.csv}
            </button>
            <button
              type="button"
              className="fs-flat"
              disabled={!bundle || !posted}
              onClick={() => save("json")}
              data-testid="W-BR-01.export.json"
            >
              <Glyph name="seal" size={18} />
              {BRAND_COPY.json}
            </button>
          </div>
        )}
        <p className="br-strip__note fs-t-caption">{BRAND_COPY.exportNote}</p>
        <p className="br-strip__saved" role="status" data-testid="W-BR-01.export.saved">
          {saved ?? ""}
        </p>
      </div>
    </header>
  );
}
