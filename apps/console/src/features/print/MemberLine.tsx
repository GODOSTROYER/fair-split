// W-TR-09's member line (S1.7, design §6 C9), in the stage drawer while `?member=` is set: why this member's
// number is their number (the ReceiptBar), their slips, the line's history, an SMS preview that is never sent,
// and the cash-day actions. Amounts follow S2.2.1's grammar; a peso figure is either "about … (estimate)" for
// PayPal or exact cash at the run's recorded rate.

import type { Lang, SeasonSnapshot, SnapshotMember } from "@fairsplit/contracts";
import { AmountDisplay, Glyph, ReceiptBar, type SegmentId, Slab, StatusChip } from "@fairsplit/ui-web";
import { useState } from "react";
import { AppLink } from "../../chrome/AppLink.js";
import { CommandNotice } from "../../chrome/CommandNotice.js";
import { rowTime } from "../../data/describe.js";
import { useCommand } from "../../data/hooks.js";
import type { RunView } from "../../data/run-view.js";
import { format } from "../../lib/format.js";
import { provenanceFooter } from "../../lib/provenance.js";
import type { SplitRow } from "../split/model.js";
import { LINE } from "../split/shared/copy.js";
import { copyWord, SlipPaper } from "../split/shared/SlipPaper.js";
import {
  cashCentavos,
  gsm7Length,
  isCashLine,
  type LineScreenState,
  lineHistory,
  lineSlips,
  rateDisplay,
  receiptLine,
  smsSegments,
  smsText,
} from "./model.js";

export interface MemberLineProps {
  readonly snapshot: SeasonSnapshot;
  readonly view: RunView;
  readonly member: SnapshotMember;
  readonly row: SplitRow;
  readonly state: LineScreenState;
  readonly live: boolean;
  readonly printHref: string;
}

const LANGS: readonly Lang[] = ["ceb", "fil", "en"];

export function MemberLine({ snapshot, view, member, row, state, live, printHref }: MemberLineProps) {
  const [active, setActive] = useState<SegmentId | undefined>(undefined);
  const [lang, setLang] = useState<Lang>(member.lang);
  const pairing = useCommand("createPairing");
  const fx = snapshot.fx.centavosPerCent;
  const cash = isCashLine(row);
  const amount = { display: format.money(row.netCents), spoken: format.amountSpoken(row.netCents, "en") };
  const estimate = cash ? undefined : format.pesoEstimate(row.netCents, fx, "en");
  const exactCash = cash ? format.money(cashCentavos(row.netCents, fx), "PHP") : null;
  const slips = lineSlips(snapshot, row);
  const history = lineHistory(snapshot, view, row.memberNo);
  const sms = smsText(snapshot, member, row, state, lang);
  const septets = gsm7Length(sms);
  const cashDay = format.dateShort(snapshot.run.cashDay);
  const beforeCashDay = Date.now() < Date.parse(`${snapshot.run.cashDay}T00:00:00+08:00`);
  const highlightSlips = active === "kg-rate" || active === "premium" || active === "bonus";

  return (
    <div className="fsr-line" data-testid="W-TR-09.line">
      <header className="fsr-line__head">
        <div className="fsr-line__who">
          <h2 id="W-TR-09-title" className="fs-t-title-2">
            {member.displayName}
          </h2>
          <p className="fs-t-caption fsr-muted">
            {member.consoleName !== member.displayName ? `${member.consoleName}, ` : ""}
            {row.memberNo}, {LINE.langName[member.lang]}
          </p>
        </div>
        <StatusChip
          state={state === "cash-due" ? "OFF_RAIL_DUE" : row.state}
          surface="console"
          testId="W-TR-09.status"
        />
      </header>

      <div className="fsr-line__amount" data-amount-state={row.amountState} data-testid="W-TR-09.amount">
        <AmountDisplay
          amount={amount}
          typeRole="amount-l"
          pencil={row.amountState === "pencil"}
          hollow={row.amountState === "hollow"}
          {...(estimate ? { estimate } : {})}
        />
        {exactCash && (
          <p className="fsr-line__cash" data-testid="W-TR-09.cash">
            <span className="fs-t-figure">{exactCash}</span>{" "}
            <span className="fs-t-caption fsr-muted">
              {LINE.cashFrom(amount.display, rateDisplay(fx))}. {LINE.cashDay(cashDay)}
            </span>
          </p>
        )}
        <p className="fs-t-caption fsr-muted">
          {provenanceFooter({ kind: "engine", rateCardSha256: snapshot.rateCard.sha256 })}
        </p>
      </div>

      <section className="fsr-line__section" aria-labelledby="W-TR-09-receipt">
        <h3 id="W-TR-09-receipt" className="fs-t-label">
          {LINE.receipt}
        </h3>
        <ReceiptBar
          line={receiptLine(snapshot, row)}
          onSegment={(id) => setActive((was) => (was === id ? undefined : id))}
          {...(active ? { active } : {})}
          testId="W-TR-09.receipt"
        />
      </section>

      <section
        className="fsr-line__section"
        aria-labelledby="W-TR-09-slips"
        data-lit={highlightSlips ? "" : undefined}
      >
        <h3 id="W-TR-09-slips" className="fs-t-label">
          {LINE.slips} <span className="fsr-muted fs-t-caption">{format.kg(row.verifiedG)}</span>
        </h3>
        <ul className="fsr-line__slips" data-testid="W-TR-09.slips">
          {slips.map((s) => (
            <li
              key={`${s.serial}-${s.photoId}`}
              className="fsr-line__slip"
              data-archived={s.archived ? "" : undefined}
            >
              {s.archived ? (
                <span
                  className="fsr-archived"
                  role="img"
                  aria-label={`${LINE.archived} ${s.photoId}, slip ${s.serial}`}
                >
                  <span className="fs-t-label">{s.serial}</span>
                  <span className="fs-t-caption">{LINE.archived}</span>
                </span>
              ) : (
                <SlipPaper
                  slip={s.slip}
                  width={112}
                  alt={`Slip ${s.serial}, ${copyWord(s.slip.copy)}, photo ${s.photoId}`}
                />
              )}
              <span className="fs-t-caption fsr-line__slip-caption">
                {LINE.slipCaption(s.serial, s.photoId, s.kg)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="fsr-line__section" aria-labelledby="W-TR-09-history">
        <h3 id="W-TR-09-history" className="fs-t-label">
          {LINE.history}
        </h3>
        {history.length === 0 ? (
          <p className="fs-t-caption fsr-muted">{LINE.historyEmpty}</p>
        ) : (
          <ol className="fsr-line__history" data-testid="W-TR-09.history">
            {history.map((h) => (
              <li key={h.id}>
                <span className="fsr-line__h-words fs-t-body">{h.words}</span>
                {h.detail && <span className="fsr-line__h-detail fs-t-caption fsr-muted">{h.detail}</span>}
                <time className="fsr-line__h-time fs-t-caption fsr-muted" dateTime={h.at ?? undefined}>
                  {rowTime(h.at)}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="fsr-line__section fsr-sms" aria-labelledby="W-TR-09-sms" data-testid="W-TR-09.sms">
        <div className="fsr-sms__head">
          <h3 id="W-TR-09-sms" className="fs-t-label">
            {LINE.smsTitle} <span className="fsr-sms__chip fs-t-caption">{LINE.smsPreview}</span>
          </h3>
          <fieldset className="fsr-sms__langs">
            <legend className="fs-sr">{LINE.langLabel}</legend>
            {LANGS.map((l) => (
              <button
                key={l}
                type="button"
                className="fsr-chip fs-t-label"
                aria-pressed={lang === l}
                onClick={() => setLang(l)}
                data-testid={`W-TR-09.sms.${l}`}
              >
                {LINE.langName[l]}
              </button>
            ))}
          </fieldset>
        </div>
        <p className="fsr-sms__text" lang={lang} data-testid="W-TR-09.sms.text">
          {sms}
        </p>
        <p className="fs-t-caption fsr-muted" data-testid="W-TR-09.sms.count">
          {septets === null ? LINE.smsUnicode : LINE.smsCount(septets, smsSegments(septets))}
          {lang !== "en" && <span className="fsr-sms__review"> {LINE.machineTranslated}</span>}
        </p>
      </section>

      <footer className="fsr-line__actions">
        <div className="fsr-line__pair">
          <Slab
            label={LINE.pair}
            srLabel={LINE.srPair(member.displayName)}
            depth="d1"
            tone="chalk"
            glyph="ms:fingerprint"
            testId="W-TR-09.pair"
            {...(!live ? { unavailableReason: LINE.pairOffline } : {})}
            onCommit={() =>
              pairing.mutate({
                // fs-api names a member's persona by their member number (resolvePersona).
                body: { persona: row.memberNo, role: "member", memberNo: row.memberNo },
              })
            }
          />
          {pairing.data && (
            <p className="fsr-line__code" data-testid="W-TR-09.pair.code">
              <span className="fs-t-caption fsr-muted">{LINE.pairCode}</span>
              <span className="fs-t-amount-l">{`${pairing.data.code6.slice(0, 3)} ${pairing.data.code6.slice(3)}`}</span>
              <span className="fs-t-caption fsr-muted">
                {LINE.pairHow} {LINE.pairExpires(format.time(pairing.data.expiresAt).slice(0, 5))}
              </span>
            </p>
          )}
          {pairing.error && <CommandNotice error={pairing.error} testId="W-TR-09.pair.error" />}
        </div>
        <AppLink
          href={printHref}
          className="fs-flat"
          target="_blank"
          rel="noopener"
          data-testid="W-TR-09.print"
        >
          <Glyph name="ms:print" size={18} />
          {LINE.print}
        </AppLink>
        {cash && state === "cash-due" && (
          <div className="fsr-line__received">
            <Slab
              label={LINE.markReceived}
              srLabel={LINE.srMarkReceived(member.displayName, exactCash ?? amount.display)}
              depth="d2"
              tone="chalk"
              glyph="thumbmark"
              testId="W-TR-09.markReceived"
              unavailableReason={beforeCashDay ? LINE.markReceivedBefore(cashDay) : LINE.markReceivedNotWired}
              onCommit={() => undefined}
            />
            <p className="fs-t-caption fsr-muted">{LINE.photograph}</p>
          </div>
        )}
      </footer>
    </div>
  );
}
