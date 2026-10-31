// G1 static screens, at true scale, on the register's figures (register §12): W-JG-01, W-TR-05 with the H1
// drawer, W-TR-07 ready and with key 1 signed, M-MB-01 sent and paid in phone frames, and W-PF-01.

import {
  AmountDisplay,
  Glyph,
  HoldCard,
  InkStamp,
  MassBalanceDial,
  MomentRoot,
  PhoneFrame,
  Print,
  RailBar,
  Seal,
  Slab,
} from "@fairsplit/ui-web";
import { useEffect, useRef } from "react";
import { focusAndReveal } from "../../lib/focus.js";
import { ConsoleFrame, InvoicePlate, KeySlot, RateCardPlate, RunStrip } from "../console.js";
import { approveConfirm, en, feeFigures, holdH1, RC_SHORT, splitRows, TwinEvidence } from "../content.js";
import {
  BATCH_SHA256,
  HOLDS,
  INVOICE,
  PEOPLE,
  RATE_CARD_SHA256,
  SEASON,
  SENDER_BATCH_ID,
  STAGE_LOG,
  TOTALS,
} from "../fixture.js";
import { hashPrefix, money, percent, plain, usd } from "../format.js";
import { useProtoSearch } from "../Shell.js";
import type { CompositionId } from "../search.js";
import { PhotoTile, photoSerials } from "../slips.js";
import { MemberStatement } from "../statement.js";
import "../compositions.css";

export function CompositionPage({ id }: { readonly id: CompositionId }) {
  return (
    <div className="comp" data-testid={`W-DP-01.composition.${id}`}>
      {id === "judge-stage" && <JudgeStage />}
      {id === "split-review" && <SplitReview />}
      {id === "approve-ready" && <Approve stage="ready" />}
      {id === "approve-key-1" && <Approve stage="key1" />}
      {id === "statement" && <Statements />}
      {id === "proof" && <Proof />}
    </div>
  );
}

// ------------------------------------------------------------------------------------------- W-JG-01

function JudgeStage() {
  const search = useProtoSearch();
  const lang = search.lang ?? "ceb";
  const slab = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // The next step's slab is pre-focused (S1 §1.5).
    const face = slab.current?.querySelector<HTMLButtonElement>(".fs-slab__face");
    if (face) focusAndReveal(face);
  }, []);
  return (
    <div className="stage" data-testid="W-JG-01" data-state="ready">
      <header className="stage-bar">
        <p className="stage-bar__notice fs-t-caption">
          {en("W-JG-01.notice.simulator", { date: SEASON.replayDate })}
        </p>
        <div className="stage-bar__links">
          <button type="button" className="fs-link fs-t-label">
            {en("W-JG-01.whatsReal")}
          </button>
          <button type="button" className="fs-link fs-t-label">
            {en("W-JG-01.soundOff")}
          </button>
          <button type="button" className="fs-link fs-t-label">
            {en("W-JG-01.reset")}
          </button>
          <span className="fs-chip" data-tone="neutral">
            <Glyph name="seal" size={16} />
            <span className="fs-t-label">{en("W-JG-01.proofChip", { confirmed: 0, total: 8 })}</span>
          </span>
        </div>
      </header>
      <div className="stage-body">
        <ConsoleFrame
          active="season"
          next={en("W-JG-01.pill.markPaid")}
          state={en("run.INVOICED")}
          testId="W-TR-01"
          screenState="waiting"
        >
          <div className="season">
            <header className="season__head">
              <div className="season__titles">
                <p className="season__mark">{SEASON.code}</p>
                <p className="fs-t-label season__coop">{en("W-TR-01.coop")}</p>
                <h1 className="fs-t-title-1">{en("W-JG-01.ready", { season: SEASON.code })}</h1>
              </div>
              <div className="season__action" ref={slab}>
                <Slab
                  label={en("W-JG-01.markPaid")}
                  srLabel={`${en("W-JG-01.markPaid")}, ${usd(INVOICE.totalCents)}`}
                  depth="d2"
                  tone="chalk"
                  testId="W-JG-01.markPaid"
                  onCommit={() => undefined}
                />
              </div>
            </header>
            <RunStrip lit={1} />
            <div className="season__grid">
              <section className="season__photos" aria-label={en("W-JG-01.photos", { count: 12 })}>
                <div className="contact">
                  {SEASON.photos.map((p) => {
                    const { serials, copies } = photoSerials(p);
                    return <PhotoTile key={p} photo={p} serials={serials} copies={copies} width={104} />;
                  })}
                </div>
                <p className="fs-t-caption season__muted">
                  {en("W-JG-01.photos", { count: 12 })}. {en("paper.synthetic")}.
                </p>
              </section>
              <div className="season__plates">
                <RateCardPlate />
                <InvoicePlate />
              </div>
            </div>
          </div>
        </ConsoleFrame>
        <aside className="stage-dock" aria-label="Phone frames">
          <fieldset className="stage-dock__tabs proto-group" aria-label="Frame">
            {(["member", "chair", "clerk"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                className="stage-dock__tab fs-t-label"
                aria-pressed={tab === "member"}
              >
                {en(`W-JG-01.tab.${tab}`)}
              </button>
            ))}
          </fieldset>
          <PhoneFrame
            label="Member frame: Nang Celing, M-014"
            caption={en("W-JG-01.frameCaption")}
            width={390}
            height={760}
            testId="W-JG-01.frame.member"
          >
            <MemberStatement lang={lang} state="checking" motion={search.motion ?? "system"} />
          </PhoneFrame>
        </aside>
      </div>
      <section className="stage-ribbon" aria-label={en("W-JG-01.ribbon")}>
        {STAGE_LOG.map((row) => (
          <p key={row.words} className="stage-ribbon__row" data-lane={row.lane}>
            <span className="stage-ribbon__lane fs-t-caption">{en(`W-JG-01.lane.${row.lane}`)}</span>
            <span className="fs-t-label">{row.words}</span>
            <span className="fs-t-caption stage-ribbon__detail">{row.detail}</span>
          </p>
        ))}
      </section>
    </div>
  );
}

// ------------------------------------------------------------------------------------ W-TR-05 + 06

function SplitReview() {
  const rows = splitRows("h1-open");
  const noop = () => undefined;
  const drawer = (
    <>
      <div className="drawer-scrim" aria-hidden />
      <aside className="drawer" aria-label="Hold H1" data-testid="W-TR-06" data-state="open">
        <header className="drawer__head">
          <span className="fs-t-caption drawer__muted">{en("W-TR-06.position", { index: 1, total: 3 })}</span>
          <button type="button" className="fs-flat" data-testid="W-TR-06.close">
            <Glyph name="ms:close" size={18} />
            {en("W-TR-06.close")}
          </button>
        </header>
        <MomentRoot id="MM-3" phase="ready">
          <HoldCard
            hold={holdH1("open")}
            gate="BLOCKS_APPROVAL"
            evidence={<TwinEvidence />}
            actions={[
              {
                kind: "slab",
                label: en("W-TR-06.H1.action"),
                srLabel: `${en("W-TR-06.H1.action")}, returns ${usd(TOTALS.duplicateMovedCents)} to 63 members, changes a line`,
                onCommit: noop,
                testId: "W-TR-06.countOnce",
              },
              {
                kind: "flat",
                label: en("W-TR-06.H1.flat"),
                note: en("W-TR-06.H1.flatNote"),
                onSelect: noop,
                testId: "W-TR-06.twoDeliveries",
              },
            ]}
            testId="W-TR-06.H1"
          />
        </MomentRoot>
      </aside>
    </>
  );
  return (
    <ConsoleFrame
      active="split"
      next={en("W-JG-01.pill.holds", { count: 3 })}
      state={en("run.IN_REVIEW")}
      testId="W-TR-05"
      screenState="ready"
      overlay={drawer}
    >
      <div className="split">
        <header className="split__head">
          <MassBalanceDial
            value={TOTALS.shrinkWithDuplicateBp / 100}
            display={percent(TOTALS.shrinkWithDuplicateBp)}
            limitDisplay={en("W-TR-05.dialLimit", { limit: "2.0%" })}
            label={en("W-TR-05.dial")}
            size={128}
            testId="W-TR-05.dial"
          />
          <dl className="split__pools">
            <div>
              <dt className="fs-t-caption">
                {en("W-TR-01.pool.premium")} <Glyph name="ms:lock" size={12} />
              </dt>
              <dd className="fs-t-figure">{usd(INVOICE.premiumCents)}</dd>
            </div>
            <div>
              <dt className="fs-t-caption">{en("W-TR-01.pool.bonus")}</dt>
              <dd className="fs-t-figure">{usd(INVOICE.bonusCents)}</dd>
            </div>
            <div>
              <dt className="fs-t-caption">{en("W-TR-05.pool")}</dt>
              <dd className="fs-t-figure">{usd(TOTALS.grossCents)}</dd>
            </div>
          </dl>
          <div className="split__summary">
            <p className="fs-t-title-2">{en("W-TR-05.summary", { holds: 3, byHand: 1 })}</p>
            <fieldset className="split__chips proto-group" aria-label="Filter lines">
              {(
                [
                  ["all", 64],
                  ["held", 3],
                  ["byHand", 1],
                  ["paypal", 8],
                  ["cash", 56],
                ] as const
              ).map(([key, count], i) => (
                <button key={key} type="button" className="split__chip fs-t-label" aria-pressed={i === 0}>
                  {en(`W-TR-05.filter.${key}`, { count })}
                </button>
              ))}
            </fieldset>
          </div>
        </header>
        <div className="grid-wrap">
          <table className="grid" data-testid="W-TR-05.grid">
            <thead>
              <tr>
                <th scope="col">{en("W-TR-05.col.member")}</th>
                <th scope="col" className="num">
                  {en("W-TR-05.col.kg")}
                </th>
                <th scope="col">{en("W-TR-05.col.confidence")}</th>
                <th scope="col" className="num">
                  {en("W-TR-05.col.premium")}
                </th>
                <th scope="col" className="num">
                  {en("W-TR-05.col.bonus")}
                </th>
                <th scope="col">{en("W-TR-05.col.kaltas")}</th>
                <th scope="col" className="num">
                  {en("W-TR-05.col.credit")}
                </th>
                <th scope="col" className="num">
                  {en("W-TR-05.col.net")}
                </th>
                <th scope="col">{en("W-TR-05.col.rail")}</th>
                <th scope="col">{en("W-TR-05.col.status")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.no} data-status={r.status} aria-selected={r.hold === "H1" ? true : undefined}>
                  <th scope="row">
                    <span className="grid__member">
                      <span className="fs-t-label">{r.name}</span>
                      <span className="fs-t-caption grid__muted">
                        {r.no} {r.lang}
                      </span>
                    </span>
                  </th>
                  <td className="num">
                    <span className="fs-t-figure">{r.kg}</span>
                    {r.kgPerTree && (
                      <span
                        className="grid__tree fs-t-caption"
                        title="Kilos per registered tree; the limit is 1.6"
                      >
                        {en("W-TR-05.perTree", { kg: r.kgPerTree })}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.status === "by-hand" ? (
                      <span className="grid__byhand">
                        <InkStamp stamp={{ initials: "AS", name: PEOPLE.treasurer.name, at: "10:22" }} />
                        <span className="fs-t-caption">{HOLDS.byHand.logbook}</span>
                      </span>
                    ) : (
                      <span className="grid__conf fs-t-caption">0.97</span>
                    )}
                  </td>
                  <td className="num pencil">{r.premium}</td>
                  <td className="num pencil">{r.bonus}</td>
                  <td>
                    <span className="grid__kaltas">
                      {r.kaltas.map((k) => (
                        <span key={k.name} className="fs-rule-chip fs-t-figure">
                          {k.name} {k.amount} <span className="fs-rule-chip__id">{k.rule}</span>
                        </span>
                      ))}
                    </span>
                  </td>
                  <td className="num pencil">{r.credit}</td>
                  <td className="num pencil grid__net">{r.net}</td>
                  <td>
                    {r.rail === "paypal" ? (
                      <span className="fs-t-label">PayPal</span>
                    ) : (
                      <span className="grid__cash fs-t-label">
                        <span>{en("cash.word")}</span>
                      </span>
                    )}
                  </td>
                  <td>
                    {r.status === "held" ? (
                      <span className="grid__status" data-tone="canary">
                        <Glyph name="hanging-scale" size={16} />
                        <span className="fs-t-label">{en("console.status.HELD")}</span>
                      </span>
                    ) : r.status === "reserved" ? (
                      <span className="grid__status" data-tone="canary">
                        <Glyph name="logbook" size={16} />
                        <span className="fs-t-caption">{en("console.reserved")}</span>
                      </span>
                    ) : (
                      <span className="grid__status">
                        <Glyph name="ms:check" size={16} />
                        <span className="fs-t-label">{en("console.status.READY")}</span>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              <tr className="grid__more">
                <td colSpan={10} className="fs-t-caption">
                  {en("W-TR-05.background", { count: 55 })}
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={10} className="fs-t-caption">
                  <Glyph name="ms:check" size={14} />{" "}
                  {en("W-TR-05.totals", { gross: plain(TOTALS.grossCents) })}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </ConsoleFrame>
  );
}

// -------------------------------------------------------------------------------------------- W-TR-07

function Approve({ stage }: { readonly stage: "ready" | "key1" }) {
  const key1 = stage === "key1";
  const amount = money(TOTALS.paypalCents);
  return (
    <ConsoleFrame
      active="approve"
      next={key1 ? en("W-JG-01.pill.cosign") : en("W-JG-01.pill.approve", { count: 8 })}
      state={key1 ? en("run.AWAITING_BOARD") : en("run.IN_REVIEW")}
      testId="W-TR-07"
      screenState={stage}
    >
      <MomentRoot id="MM-5" phase={key1 ? "waiting-2" : "ready"} className="approve">
        <Seal batchSha256={BATCH_SHA256} size={200} keys={key1 ? 1 : 0} testId="W-TR-07.seal" />
        <p className="approve__hash fs-t-hash">
          {SENDER_BATCH_ID} <span className="approve__muted">batch {hashPrefix(BATCH_SHA256)}</span>
        </p>
        <AmountDisplay amount={amount} pencil testId="W-TR-07.amount" className="approve__amount" />
        <RailBar
          paypalShare={TOTALS.paypalCents / TOTALS.netCents}
          paypalText={en("W-TR-07.payouts", { count: 8 })}
          cashText={en("W-TR-07.cash", { count: 56, amount: usd(TOTALS.cashCents), date: SEASON.cashDay })}
          cashWord={en("cash.word")}
          testId="W-TR-07.rail"
        />
        <p className="approve__fees fs-t-caption">
          {en("W-TR-07.fees", feeFigures())}{" "}
          <span className="approve__muted">{en("W-TR-07.feesLabel")}.</span>
        </p>
        <Print
          value={en("W-TR-07.safe", {
            holds: 3,
            byHand: 1,
            shrink: percent(TOTALS.shrinkBp),
            limit: "2.0%",
            explained: 64,
            lines: 64,
            date: SEASON.ratified,
          })}
          provenance="engine"
          state="pencil"
          typeRole="body"
          footer={`Computed by engine v1, rate card ${RC_SHORT}`}
          className="approve__safe"
        />
        <div className="approve__slab">
          <Slab
            label={en("W-TR-07.approve", { count: 8 })}
            srLabel={`${en("W-TR-07.approve", { count: 8 })}, ${amount.spoken}, moves money`}
            depth="d3"
            tone="jade"
            hold={1600}
            size="l"
            width={560}
            testId="W-TR-07.approve"
            onCommit={() => undefined}
            frame={key1 ? { state: "committed", travel: 8, fill: 1 } : undefined}
            hint={!key1}
            confirm={approveConfirm()}
          />
        </div>
        <div className="approve__keys">
          <KeySlot
            name={en("W-TR-07.key.treasurer")}
            status={
              key1
                ? `${en("W-TR-07.key.signed", { time: "10:31" })}. ${en("W-TR-07.key.demo")}`
                : en("W-TR-07.key.demo")
            }
            signed={key1}
            stamp="AS"
          />
          <KeySlot
            name={en("W-TR-07.key.chair")}
            why={en("W-TR-07.key.chairWhy", { threshold: "US$300" })}
            status={key1 ? en("W-TR-07.waiting") : en("W-TR-07.key.waiting")}
            signed={false}
          />
        </div>
        {key1 && (
          <p className="approve__presence fs-t-label" data-testid="W-TR-07.presence">
            <Glyph name="ms:visibility" size={18} />
            {en("W-TR-07.presence", { hold: 2 })}
          </p>
        )}
        <aside className="approve__qr" aria-label={en("W-TR-07.qrAlt")}>
          <span className="approve__qr-code" aria-hidden>
            <Glyph name="ms:qr-code-2" size={72} />
          </span>
          <span className="approve__qr-text">
            <span className="fs-t-label">{en("W-TR-07.qr")}</span>
            <span className="fs-t-caption approve__muted">
              Placeholder: the single-use pairing QR arrives with WS-API’s pairing route.
            </span>
          </span>
        </aside>
      </MomentRoot>
    </ConsoleFrame>
  );
}

// -------------------------------------------------------------------------------------------- M-MB-01

function Statements() {
  const search = useProtoSearch();
  const lang = search.lang ?? "ceb";
  const motion = search.motion ?? "system";
  return (
    <div className="statements">
      <figure className="statements__frame">
        <PhoneFrame
          label="Member frame: sent"
          caption="Sent: the amount stays hollow until PayPal confirms the item."
          testId="M-MB-01.frame.sent"
        >
          <MemberStatement lang={lang} state="sent" motion={motion} testId="M-MB-01" />
        </PhoneFrame>
      </figure>
      <figure className="statements__frame">
        <PhoneFrame
          label="Member frame: paid"
          caption="Paid: PayPal’s SUCCEEDED event pressed the capsule flush and flooded it jade."
          testId="M-MB-01.frame.paid"
        >
          <MemberStatement lang={lang} state="paid" motion={motion} testId="M-MB-01.paid" />
        </PhoneFrame>
      </figure>
    </div>
  );
}

// -------------------------------------------------------------------------------------------- W-PF-01

const CHAIN = [
  {
    title: "W-PF-01.plate.invoice",
    detail: `${SEASON.invoiceNumber}, MARKED_AS_PAID (simulated sandbox), reference rc:${RATE_CARD_SHA256.slice(0, 16)}`,
    check: "W-PF-01.check.reference",
  },
  {
    title: "W-PF-01.plate.rateCard",
    detail: `sha256 ${hashPrefix(RATE_CARD_SHA256, 4)}, ratified ${SEASON.ratifiedLong}, first slip 2 Apr`,
    check: "W-PF-01.check.card",
  },
  {
    title: "W-PF-01.plate.slips",
    detail: "264 slips in 66 photos, with photo hashes",
    check: "W-PF-01.check.photos",
  },
  {
    title: "W-PF-01.plate.lines",
    detail: `64 line hashes; gross ${usd(TOTALS.grossCents)} = the pool`,
    check: "W-PF-01.check.lines",
  },
  {
    title: "W-PF-01.plate.keys",
    detail: `${PEOPLE.treasurer.keyId}, ${PEOPLE.chair.keyId}, batch ${hashPrefix(BATCH_SHA256, 4)}`,
    check: "W-PF-01.check.signatures",
  },
  {
    title: "W-PF-01.plate.items",
    detail: `sender_item_id r${SEASON.runSeq}-M-014 and 7 more, with webhook event IDs`,
    check: "W-PF-01.check.items",
  },
] as const;

function Proof() {
  const share = TOTALS.finalPaypalCents / TOTALS.netCents;
  return (
    <div className="proof" data-theme="adlaw" data-testid="W-PF-01" data-state="verified">
      <header className="proof__bar">
        <p className="proof__lockup">
          Fair Split<span>: co-op payroll</span>
        </p>
        <p className="fs-t-caption proof__muted">{en("W-PF-01.tagline")}</p>
      </header>
      <main className="proof__col">
        <section className="proof__hero">
          <h1 className="proof__headline">
            {en("W-PF-01.heroMarked.simulator", { amount: usd(INVOICE.totalCents), season: SEASON.code })}
          </h1>
          <Seal batchSha256={BATCH_SHA256} size={320} keys={2} testId="W-PF-01.seal" />
          <p className="proof__mark">{SEASON.lot}</p>
          <Slab
            label={en("W-PF-01.verify")}
            srLabel={en("W-PF-01.verify")}
            depth="d1"
            tone="chalk"
            testId="W-PF-01.verify"
            onCommit={() => undefined}
          />
        </section>

        <section className="proof__chain" aria-labelledby="proof-chain">
          <h2 id="proof-chain" className="fs-t-title-2">
            {en("W-PF-01.chain")}
          </h2>
          <ol className="chain">
            {CHAIN.map((plate, i) => (
              <li key={plate.title} className="chain__plate" data-state="matches">
                <span className="chain__step fs-t-figure" aria-hidden>
                  {i + 1}
                </span>
                <div className="chain__body">
                  <p className="fs-t-label">{en(plate.title)}</p>
                  <p className="fs-t-caption proof__muted">{plate.detail}</p>
                  <p className="chain__check fs-t-caption">
                    <Glyph name="ms:check" size={16} />
                    <span>{en(plate.check)}</span>
                    <strong>{en("W-PF-01.matches")}</strong>
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section className="proof__metrics" aria-label="What the run did">
          <dl className="metrics">
            <div className="metrics__row">
              <dt>{en("W-PF-01.metric.explained")}</dt>
              <dd className="fs-t-figure">{en("W-PF-01.metric.explainedValue", { count: 64, total: 64 })}</dd>
            </div>
            <div className="metrics__row">
              <dt>{en("W-PF-01.metric.premium")}</dt>
              <dd className="fs-t-figure">{en("W-PF-01.metric.premiumValue")}</dd>
            </div>
            <div className="metrics__row metrics__row--bar">
              <dt>{en("W-PF-01.metric.paypal")}</dt>
              <dd className="fs-t-figure">
                {en("W-PF-01.metric.paypalValue", {
                  count: 7,
                  total: 64,
                  share: `${(share * 100).toFixed(1)}%`,
                })}
              </dd>
              <dd className="metrics__bar" aria-hidden>
                <span className="metrics__paypal" style={{ width: `${(share * 100).toFixed(2)}%` }} />
                <span className="metrics__cash">
                  <span className="fs-t-caption">{en("W-PF-01.metric.cash")}</span>
                </span>
              </dd>
            </div>
            <div className="metrics__row">
              <dt>{en("W-PF-01.metric.holds")}</dt>
              <dd className="fs-t-figure">
                {en("W-PF-01.metric.holdsValue", { count: 3, amount: usd(TOTALS.redirectedCents) })}
              </dd>
            </div>
            <div className="metrics__row">
              <dt>{en("W-PF-01.metric.time")}</dt>
              <dd className="fs-t-figure">3 min 12 s</dd>
            </div>
          </dl>
        </section>

        <section className="proof__plots" aria-label="Plot field">
          <PlotField />
          <p className="fs-t-caption proof__muted">{en("W-PF-01.plots")}</p>
        </section>

        <footer className="proof__footer fs-t-caption">
          <p>{en("W-PF-01.footer.recon")}</p>
          <p>{en("W-PF-01.footer.simulator")}</p>
          <p>{en("W-PF-01.footer.priorArt")}</p>
        </footer>
      </main>
    </div>
  );
}

/** Abstract dots sized by kilos, placed by a hash-seeded layout: no basemap, no coordinates (RA 10173). */
function PlotField() {
  const known = new Map([
    [2, 74],
    [7, 144],
    [14, 148],
    [18, 120.4],
    [22, 96.5],
    [31, 61.2],
    [39, 88],
    [53, 300],
    [60, 128.5],
  ]);
  const w = 680;
  const h = 200;
  let seed = Number.parseInt(BATCH_SHA256.slice(0, 8), 16);
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const dots = Array.from({ length: 64 }, (_, i) => {
    const kg = known.get(i + 1);
    return { id: i + 1, x: 16 + rand() * (w - 32), y: 16 + rand() * (h - 32), kg };
  });
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" className="plots" aria-hidden>
      {dots.map((d) =>
        d.kg ? (
          <circle key={d.id} cx={d.x} cy={d.y} r={Math.sqrt(d.kg) * 0.55} className="plots__dot" />
        ) : (
          <circle key={d.id} cx={d.x} cy={d.y} r={2.5} className="plots__dot plots__dot--seed" />
        ),
      )}
    </svg>
  );
}
