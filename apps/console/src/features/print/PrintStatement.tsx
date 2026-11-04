// The 80 mm statement (S1.7 W-TR-09, design §6 C9) for the bodega's thermal printer: a large amount (exact pesos
// for cash, at the run's recorded rate), the seal in black with its hash, the rate card, the slips, and a
// "Nadawat" box for a signature or thumbmark with a witness line. It is paper, so on screen it casts the paper
// shadow on the daylight ground; `@page { size: 80mm auto }` prints it edge to edge.

import type { SeasonSnapshot, SnapshotMember } from "@fairsplit/contracts";
import { translate } from "@fairsplit/i18n";
import { Seal } from "@fairsplit/ui-web";
import { payoutStatus } from "../../data/payout-replay.js";
import type { RunView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { batchHashOf, senderBatchIdFor } from "../approve/model.js";
import type { SplitRow } from "../split/model.js";
import { LINE } from "../split/shared/copy.js";
import { cashCentavos, isCashLine, type LineScreenState, rateDisplay } from "./model.js";

export interface PrintStatementProps {
  readonly snapshot: SeasonSnapshot;
  readonly view: RunView;
  readonly member: SnapshotMember;
  readonly row: SplitRow;
  readonly state: LineScreenState;
}

export function PrintStatement({ snapshot, view, member, row, state }: PrintStatementProps) {
  const fx = snapshot.fx.centavosPerCent;
  const cash = isCashLine(row);
  // The member's paper speaks her words ("Not received through PayPal"), never the console's ("Parked"). A locked
  // PayPal line reads as she would see it, sent and waiting for the simulated PayPal sandbox, labelled as such.
  const payout = payoutStatus({
    state: row.state === "LOCKED" ? "SUBMITTED" : row.state,
    view,
    memberNo: row.memberNo,
    paypal: !cash,
    replayed: row.replayed,
    statusWord: translate("en", `status.${row.state}`),
  });
  const held = state === "held";
  const treasurer = snapshot.officers.find((o) => o.role === "TREASURER")?.shortName ?? "";
  const batch = batchHashOf(view, null) ?? (view.origin === "showcase" ? snapshot.run.batchSha256 : null);
  const keys = view.approvals.treasurer && view.approvals.chair ? 2 : view.approvals.treasurer ? 1 : 0;
  const deductions = row.deductions;
  return (
    <article className="fsr-paper80" aria-labelledby="W-TR-09-print-title" data-testid="W-TR-09.paper">
      <header className="fsr-paper80__head">
        <p className="fsr-paper80__coop">{snapshot.coop.name}</p>
        <p className="fsr-paper80__place">{snapshot.coop.locality}</p>
        <p className="fsr-paper80__mark fs-t-mark">{snapshot.season.label}</p>
        <h1 id="W-TR-09-print-title" className="fsr-paper80__title">
          {LINE.printTitle}
        </h1>
      </header>

      <section className="fsr-paper80__who">
        <p className="fsr-paper80__name">{member.displayName}</p>
        <p className="fsr-paper80__meta">
          {row.memberNo}, {format.kg(row.verifiedG)}
        </p>
      </section>

      <section
        className="fsr-paper80__amount"
        data-amount-state={row.amountState}
        data-testid="W-TR-09.print.amount"
      >
        {held ? (
          <p className="fsr-paper80__held">{LINE.printHeld}</p>
        ) : cash ? (
          <>
            <p className="fsr-paper80__big">{format.money(cashCentavos(row.netCents, fx), "PHP")}</p>
            <p className="fsr-paper80__small">{LINE.cashFrom(format.money(row.netCents), rateDisplay(fx))}</p>
            <p className="fsr-paper80__small">
              {LINE.cashLabel}, {format.date(snapshot.run.cashDay)}
            </p>
          </>
        ) : (
          <>
            <p className="fsr-paper80__big">{format.money(row.netCents)}</p>
            <p className="fsr-paper80__small">{format.pesoEstimate(row.netCents, fx, "en")}</p>
            <p className="fsr-paper80__small">
              {payout.replayed
                ? `${payout.statusWord}. ${payout.detail}`
                : row.state === "PAID"
                  ? LINE.printPaypal
                  : payout.statusWord}
            </p>
          </>
        )}
      </section>

      {!held && (
        <table className="fsr-paper80__receipt">
          <tbody>
            <tr>
              <th scope="row">{LINE.receiptPremium}</th>
              <td>{format.amount(row.premiumCents)}</td>
            </tr>
            <tr>
              <th scope="row">{LINE.receiptBonus}</th>
              <td>{format.amount(row.bonusCents)}</td>
            </tr>
            {deductions.map((d) => (
              <tr key={`${d.ruleId}-${d.category}`}>
                <th scope="row">
                  {d.category === "CBU" ? "CBU" : d.category === "LOAN" ? "Loan" : "Advance"} ({d.ruleId})
                </th>
                <td>{format.amount(-d.amountCents)}</td>
              </tr>
            ))}
            {row.creditsCents > 0 && (
              <tr>
                <th scope="row">{LINE.creditName}</th>
                <td>+{format.amount(row.creditsCents)}</td>
              </tr>
            )}
            <tr className="fsr-paper80__net">
              <th scope="row">{LINE.receiptNet} (US$)</th>
              <td>{format.amount(row.netCents)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <p className="fsr-paper80__small">
        {LINE.printSlips(row.slips.map((s) => s.serial).join(", "), format.kg(row.verifiedG))}
      </p>

      {batch && (
        <figure className="fsr-paper80__seal">
          <Seal batchSha256={batch} size={120} keys={keys} testId="W-TR-09.print.seal" />
          <figcaption>
            <span>{LINE.printSeal}</span>
            <span className="fsr-paper80__hash">{format.hashGroups(batch, 4)}</span>
            <span>{senderBatchIdFor(snapshot, view.runSlug)}</span>
          </figcaption>
        </figure>
      )}
      <p className="fsr-paper80__small">
        {LINE.printRateCard(
          format.hashGroups(snapshot.rateCard.sha256),
          snapshot.rateCard.canonical.resolutionNo,
        )}
      </p>
      <p className="fsr-paper80__small fsr-paper80__qr">{LINE.printQrPending}</p>

      {cash && !held && (
        <section className="fsr-paper80__nadawat" aria-label={LINE.nadawat}>
          <p className="fsr-paper80__nadawat-title">{LINE.nadawat}</p>
          <div className="fsr-paper80__box" aria-hidden />
          <p className="fsr-paper80__small">{LINE.nadawatHow}</p>
          <div className="fsr-paper80__line" aria-hidden />
          <p className="fsr-paper80__small">{LINE.witness}</p>
        </section>
      )}

      <footer className="fsr-paper80__foot">
        <p>{LINE.printQuestions(treasurer)}</p>
        <p>{LINE.printSynthetic}</p>
      </footer>
    </article>
  );
}
