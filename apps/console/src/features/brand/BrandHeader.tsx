// W-BR-01's header strip (S1.8 W-PF-02, design B1): who this Proof is for, the invoice's status, the payouts as
// PayPal confirms them ("3 of 8 confirmed", live), and the export. Names and masked receivers show on screen
// under the data-sharing agreement; complete receivers and plot details only in the export (C-23).

import type { InvoiceStatus, ProofBundle, SeasonSnapshot } from "@fairsplit/contracts";
import { Glyph } from "@fairsplit/ui-web";
import { useState } from "react";
import type { PaypalRail } from "../../lib/env.js";
import { invoiceWords, railShort, STATE_COPY } from "../proof/copy.js";
import { isSettled, type ProgressCounts } from "../proof/model.js";
import { downloadText, exportFileName, membersOf, proofCsv, proofJson } from "./exportProof.js";

/** W-BR-01's `data-state` (S1.8): unpaid, progress, mismatch; plus the shell's loading and error. */
export type BrandState = "loading" | "error" | "unpaid" | "progress" | "mismatch";

export const FUNDED: readonly InvoiceStatus[] = ["PAID", "MARKED_AS_PAID"];

export const BRAND_COPY = {
  title: (payer: string) => `Proof for ${payer}`,
  for: (name: string, title: string) => `Shared with ${name}, ${title}, under the data-sharing agreement.`,
  invoice: "Invoice",
  payouts: "Payouts",
  unpaid: "Sent to Lantern Bay. Waiting for payment.",
  unpaidHow:
    "Pay it from the invoice PayPal sent to Lantern Bay's account. The pay run starts once PayPal confirms payment.",
  progress: (confirmed: number, total: number) =>
    `${confirmed} of ${total} confirmed by PayPal, updating as notices arrive.`,
  settled: (p: ProgressCounts, cashPaid: number) =>
    `${p.confirmed} of ${p.total} confirmed by PayPal.${p.returned > 0 ? ` ${STATE_COPY.returned(p.returned, cashPaid)}.` : ""}`,
  notYet: "The payout batch isn't posted yet.",
  export: "Export proof (CSV and JSON with hashes)",
  csv: "Download CSV",
  json: "Download JSON",
  exportNote:
    "Names and masked receivers show here. Complete receivers and plot details are only in the export, built in this browser.",
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
        <h1 className="br-strip__title" id="W-BR-01-title">
          {BRAND_COPY.title(payer?.name ?? "the brand")}
        </h1>
        {payer && <p className="br-strip__for">{BRAND_COPY.for(payer.contactName, payer.contactTitle)}</p>}
      </div>
      <dl className="br-strip__facts">
        <div
          className="br-strip__fact"
          data-testid="W-BR-01.invoice"
          data-state={state === "unpaid" ? "unpaid" : "funded"}
        >
          <dt>{BRAND_COPY.invoice}</dt>
          <dd>
            {invoiceNumber && <span className="fs-t-hash">{invoiceNumber}</span>}{" "}
            <span className="br-strip__status">
              {state === "unpaid" || !invoiceStatus ? BRAND_COPY.unpaid : invoiceWords(invoiceStatus)}
            </span>
            {state === "unpaid" && <span className="br-strip__how">{BRAND_COPY.unpaidHow}</span>}
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
              : isSettled(progress)
                ? BRAND_COPY.settled(progress, returnedCashPaid)
                : BRAND_COPY.progress(progress.confirmed, progress.total)}
            <span className="br-strip__rail">{railShort(rail)}</span>
          </dd>
        </div>
      </dl>
      <div className="br-strip__export" data-testid="W-BR-01.export">
        <p className="br-strip__label">{BRAND_COPY.export}</p>
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
        <p className="br-strip__note">{BRAND_COPY.exportNote}</p>
        <p className="br-strip__saved" role="status" data-testid="W-BR-01.export.saved">
          {saved ?? ""}
        </p>
      </div>
    </header>
  );
}
