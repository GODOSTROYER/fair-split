// Console chrome for the static screens: the flat rail, the Run pill, the run strip, the bolted rate-card
// plate and the invoice plate. Prototype-only compositions of ui-web primitives; WS-CONSOLE builds the real
// screens on the same primitives.

import { AmountDisplay, Glyph, type GlyphName } from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { en, RC_SHORT } from "./content.js";
import { INVOICE, PEOPLE, RATE_CARD_SHA256, SEASON } from "./fixture.js";
import { hashPrefix, money, usd } from "./format.js";

const RAIL: readonly { readonly id: string; readonly label: string; readonly glyph: GlyphName }[] = [
  { id: "season", label: "Season", glyph: "sack" },
  { id: "rate-card", label: "Rate card", glyph: "bolt" },
  { id: "reading", label: "Reading room", glyph: "triplicate-slip" },
  { id: "split", label: "Split review", glyph: "hanging-scale" },
  { id: "approve", label: "Approve", glyph: "seal" },
  { id: "run", label: "Run", glyph: "rail" },
];

export type RailItem = (typeof RAIL)[number]["id"];

export function ConsoleRail({
  active,
  judge = true,
}: {
  readonly active: RailItem;
  readonly judge?: boolean;
}) {
  return (
    <nav className="con-rail" aria-label="Console">
      <p className="con-rail__lockup">
        Fair Split:<span>co-op payroll</span>
      </p>
      <ul className="con-rail__list">
        {RAIL.map((item) => (
          <li key={item.id}>
            <span className="con-rail__item" aria-current={item.id === active ? "page" : undefined}>
              <Glyph name={item.id === active ? (`${item.glyph}-fill` as GlyphName) : item.glyph} size={18} />
              {item.label}
            </span>
          </li>
        ))}
      </ul>
      {judge && <p className="con-rail__acting fs-t-caption">{en("W-JG-01.actingAs")}</p>}
    </nav>
  );
}

/** The Run pill names the next human step; the run's state word sits beside it. */
export function RunPill({ next, state }: { readonly next: string; readonly state: string }) {
  return (
    <p className="con-pill" data-testid="W-TR-01.runPill">
      <span className="con-pill__state fs-t-caption">{state}</span>
      <span className="fs-t-label">{next}</span>
    </p>
  );
}

export interface ConsoleFrameProps {
  readonly active: RailItem;
  readonly next: string;
  readonly state: string;
  readonly children: ReactNode;
  readonly overlay?: ReactNode;
  readonly testId: string;
  readonly screenState: string;
}

export function ConsoleFrame({
  active,
  next,
  state,
  children,
  overlay,
  testId,
  screenState,
}: ConsoleFrameProps) {
  return (
    <div className="con" data-testid={testId} data-state={screenState}>
      <ConsoleRail active={active} />
      <div className="con-main">
        <header className="con-top">
          <RunPill next={next} state={state} />
        </header>
        <div className="con-content">{children}</div>
        {overlay}
      </div>
    </div>
  );
}

const STAGES = [
  { id: "ratified", label: () => en("W-TR-01.strip.ratified", { date: SEASON.ratified }) },
  { id: "funded", label: () => en("W-TR-01.strip.funded") },
  { id: "read", label: () => en("W-TR-01.strip.read") },
  { id: "checked", label: () => en("W-TR-01.strip.checked") },
  { id: "approved", label: () => en("W-TR-01.strip.approved") },
  { id: "paid", label: () => en("W-TR-01.strip.paid") },
] as const;

/** Six stages in a true sequence (register §7); a stage lights only when its condition holds. */
export function RunStrip({ lit }: { readonly lit: number }) {
  return (
    <ol className="con-strip" aria-label="Run stages">
      {STAGES.map((s, i) => (
        <li key={s.id} className="con-strip__stage" data-lit={i < lit ? "" : undefined}>
          <span className="con-strip__mark" aria-hidden>
            {i < lit && <Glyph name="ms:check" size={14} />}
          </span>
          <span className="fs-t-label">{s.label()}</span>
        </li>
      ))}
    </ol>
  );
}

/** A bolted plate: plate-2 face, steel-hatched edges, two bolt heads. Zero travel for anyone. */
export function BoltedPlate({
  children,
  testId,
}: {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <section className="con-bolted" data-testid={testId}>
      <span className="con-bolted__bolt con-bolted__bolt--l" aria-hidden />
      <span className="con-bolted__bolt con-bolted__bolt--r" aria-hidden />
      {children}
    </section>
  );
}

export function RateCardPlate() {
  return (
    <BoltedPlate testId="W-TR-02.bolted">
      <p className="con-plate__title">
        <Glyph name="bolt" size={18} />
        <span className="fs-t-title-2">{SEASON.rateCard}</span>
      </p>
      <p className="fs-t-hash con-plate__hash">sha256 {hashPrefix(RATE_CARD_SHA256, 4)}</p>
      <p className="fs-t-caption con-muted">
        {en("W-TR-02.bolted", { hash: RC_SHORT, date: SEASON.ratifiedLong, card: SEASON.rateCard })}
      </p>
      <ul className="con-rules fs-t-caption">
        {(["R0", "R1", "R2", "R3", "R4"] as const).map((rule) => (
          <li key={rule}>
            <span>{rule}</span> {en(`W-TR-02.${rule}`)}
          </li>
        ))}
      </ul>
    </BoltedPlate>
  );
}

export function InvoicePlate({ funded = false }: { readonly funded?: boolean }) {
  return (
    <section
      className="con-plate con-invoice"
      data-testid="W-TR-01.invoice"
      data-state={funded ? "funded" : "waiting"}
    >
      <p className="con-plate__title">
        <Glyph name="triplicate-slip" size={18} />
        <span className="fs-t-label">{en("W-TR-01.invoice", { number: SEASON.invoiceNumber })}</span>
      </p>
      <AmountDisplay amount={money(INVOICE.totalCents)} typeRole="amount-l" hollow={!funded} />
      <dl className="con-pools">
        <div>
          <dt>
            {en("W-TR-01.pool.premium")} <Glyph name="ms:lock" size={14} />
          </dt>
          <dd className="fs-t-figure">{usd(INVOICE.premiumCents)}</dd>
          <dd className="fs-t-caption con-muted">{en("W-TR-01.pool.premiumNote")}</dd>
        </div>
        <div>
          <dt>{en("W-TR-01.pool.bonus")}</dt>
          <dd className="fs-t-figure">{usd(INVOICE.bonusCents)}</dd>
        </div>
        <div>
          <dt>{en("W-TR-01.pool.disbursement")}</dt>
          <dd className="fs-t-figure">{usd(INVOICE.disbursementCents)}</dd>
        </div>
      </dl>
      <p className="fs-t-caption con-muted">
        {en("W-TR-01.invoice.memo", { season: SEASON.code, hash: RC_SHORT, lot: SEASON.lot })}
      </p>
      <p className="fs-t-caption">
        <Glyph name="pencil" size={14} /> {en("W-TR-01.invoice.drafted")}
      </p>
      <p className="fs-t-caption con-muted">
        {en("W-TR-01.invoice.autoCancel", { date: `${SEASON.autoCancel} 2026` })}
      </p>
      <p className="con-invoice__status fs-t-label">{en("W-TR-01.invoice.waiting")}</p>
    </section>
  );
}

export function KeySlot({
  name,
  why,
  status,
  signed,
  stamp,
}: {
  readonly name: string;
  readonly why?: string;
  readonly status: string;
  readonly signed: boolean;
  readonly stamp?: string;
}) {
  return (
    <div className="con-key" data-state={signed ? "signed" : "waiting"}>
      <span className="con-key__slot" aria-hidden>
        {signed && stamp ? (
          <span className="fs-stamp fs-t-stamp">{stamp}</span>
        ) : (
          <Glyph name="seal" size={18} />
        )}
      </span>
      <span className="con-key__text">
        <span className="fs-t-label">{name}</span>
        {why && <span className="fs-t-caption con-muted">{why}</span>}
        <span className="fs-t-caption">{status}</span>
      </span>
    </div>
  );
}

export const TREASURER = PEOPLE.treasurer;
export const CHAIR = PEOPLE.chair;
