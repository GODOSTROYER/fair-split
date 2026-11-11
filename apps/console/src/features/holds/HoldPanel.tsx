// The hold drawer's card (W-TR-06; UI gate round 4): ui-web's HoldCard as the drawer draws it, with the console's
// round-4 words. Its gate is a status pill of a few words ("Blocks approval", never a sentence with a full stop); H1
// has no engine row and one effect line ("If counted once: +US$17.94 to 63 members · 2.05% → 1.62%") right above its
// decision, its evidence under the decision; H2 and H3 keep the engine's sentence and the seed's. Round 5: the
// decision's pair stands at one 48 px height with the secondary's caption under the pair; a decided hold is a
// compact success card, flush ink with the decider's stamp, its evidence one disclosure away, and never shows
// actions. A hold is never an error and never red. The markup and test IDs are HoldCard's, so ui-web's styles and
// the drawer's tests read it as one.
//
// The catalog's gate words (i18n `hold.gate.*`) are still sentences; WS-DS shortens them (reported), and HoldCard
// can then draw this card again.

import type { DomainGlyph } from "@fairsplit/tokens/glyphs";
import {
  type FlatAction,
  Glyph,
  type GlyphName,
  type HoldCardState,
  type HoldGate,
  type HoldKind,
  InkStamp,
  isFinalHoldState,
  Print,
  Slab,
  type SlabAction,
  type StampView,
} from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { en, HOLDS } from "../split/shared/copy.js";

const KIND_GLYPH: Readonly<Record<HoldKind, DomainGlyph>> = {
  DUPLICATE_SLIP: "duplicate",
  IMPLAUSIBLE_YIELD: "plot",
  NO_RULE: "bolt",
  RATE_MISMATCH: "triplicate-slip",
  SUSPECTED_INJECTION: "pencil",
  LOW_CONFIDENCE: "logbook",
  MASS_BALANCE: "hanging-scale",
};

export interface PanelHold {
  readonly kind: HoldKind;
  readonly title: string;
  /** The engine's sentence; null leaves the row out (H1: its effect line says what counting it once does). */
  readonly engineLine: string | null;
  /** The seed's sentence (never credited to a live Claude reading on a seeded run). */
  readonly claudeLine?: string | null;
  readonly effect?: string | null;
  readonly state: HoldCardState;
}

export interface HoldPanelProps {
  readonly hold: PanelHold;
  readonly gate: HoldGate;
  /** At most one d2 slab and one flat action. Never shown once the hold is resolved or excluded. */
  readonly actions: readonly [SlabAction] | readonly [SlabAction, FlatAction];
  readonly resolution?: StampView;
  readonly evidence?: ReactNode;
  /** The effect's caption ("Money effect"); null makes the effect the card's one line on the heading step. */
  readonly effectLabel?: string | null;
  readonly testId: string;
  readonly className?: string;
}

export function HoldPanel({
  hold,
  gate,
  actions,
  resolution,
  evidence,
  effectLabel = en("hold.effect"),
  testId,
  className,
}: HoldPanelProps) {
  const [slab, flat] = actions;
  const decided = isFinalHoldState(hold.state);
  return (
    <article
      className={["fs-hold", className].filter(Boolean).join(" ")}
      data-testid={testId}
      data-state={hold.state}
      data-gate={gate}
      aria-labelledby={`${testId}-title`}
    >
      <header className="fs-hold__head">
        <span className="fs-hold__kind">
          <Glyph
            name={(decided ? KIND_GLYPH[hold.kind] : `${KIND_GLYPH[hold.kind]}-fill`) as GlyphName}
            size={20}
            label={en(`hold.kind.${hold.kind}`)}
          />
        </span>
        <h2 className="fs-hold__title fs-t-title-2" id={`${testId}-title`}>
          {hold.title}
        </h2>
      </header>

      <p className="fs-hold__gate" data-gate={gate} data-testid={`${testId}.gate`}>
        <Glyph name={gate === "BLOCKS_APPROVAL" ? "hanging-scale" : "logbook"} size={16} />
        <span className="fs-t-label">{HOLDS.gate[gate] ?? en(`hold.gate.${gate}`)}</span>
      </p>

      {(hold.engineLine || hold.claudeLine) && (
        <dl className="fs-hold__voices">
          {hold.engineLine && (
            <div className="fs-hold__voice" data-voice="engine">
              <dt className="fs-t-caption">{en("hold.engine")}</dt>
              <dd className="fs-t-body">{hold.engineLine}</dd>
            </div>
          )}
          {hold.claudeLine && (
            <div className="fs-hold__voice" data-voice="seeded">
              <dt className="fs-t-caption">
                <Glyph name="pencil" size={14} />
                {en("hold.seeded")}
              </dt>
              <dd className="fs-t-body">
                <Print value={hold.claudeLine} provenance="seeded" state="pencil" typeRole="body" />
              </dd>
            </div>
          )}
        </dl>
      )}

      {/* A decided hold is a compact success card (round 5): its evidence stays one disclosure away. */}
      {evidence &&
        (decided ? (
          <details className="fs-hold__evidence fsr-hold__more" data-testid={`${testId}.evidence`}>
            <summary className="fs-link fs-t-label">
              {en("hold.evidence")}
              <Glyph name="ms:expand-more" size={16} className="fsr-hold__more-mark" />
            </summary>
            {evidence}
          </details>
        ) : (
          <section className="fs-hold__evidence" aria-label={en("hold.evidence")}>
            {evidence}
          </section>
        ))}

      {hold.effect &&
        (effectLabel === null ? (
          <p className="fs-hold__effect fs-hold__effect--line fs-t-heading" data-testid={`${testId}.effect`}>
            {hold.effect}
          </p>
        ) : (
          <div className="fs-hold__effect">
            <p className="fs-t-caption">{effectLabel}</p>
            <p className="fs-t-body">{hold.effect}</p>
          </div>
        ))}

      <footer className="fs-hold__actions">
        {decided ? (
          <p className="fs-hold__resolution" data-testid={`${testId}.resolution`}>
            {resolution && <InkStamp stamp={resolution} />}
            <span className="fs-t-label">
              {hold.state === "excluded"
                ? en("hold.state.EXCLUDED")
                : resolution
                  ? en("hold.state.RESOLVED", { initials: resolution.initials, time: resolution.at })
                  : en("hold.state.RESOLVED_UNSTAMPED")}
            </span>
          </p>
        ) : hold.state === "asked-chair" ? (
          <p className="fs-hold__status fs-t-label">{en("hold.state.ASKED_CHAIR")}</p>
        ) : (
          <>
            {hold.state === "conflict" && (
              <p className="fs-hold__status fs-t-label">{en("hold.state.CONFLICT")}</p>
            )}
            {/* The pair at one 48 px height (round 5), the secondary's caption under the pair, not under one button. */}
            <div className="fs-hold__buttons">
              <div className="fs-hold__slab">
                <Slab
                  label={slab.label}
                  srLabel={slab.srLabel}
                  depth="d2"
                  tone="chalk"
                  testId={slab.testId}
                  onCommit={slab.onCommit}
                  frame={hold.state === "resolving" ? { state: "committed", travel: 5 } : undefined}
                />
              </div>
              {flat && (
                <div className="fs-hold__flat">
                  <button
                    type="button"
                    className="fs-flat"
                    data-size="l"
                    data-testid={flat.testId}
                    onClick={flat.onSelect}
                    {...(flat.note ? { "aria-describedby": `${testId}-flat-note` } : {})}
                  >
                    {flat.label}
                  </button>
                </div>
              )}
            </div>
            {flat?.note && (
              <p id={`${testId}-flat-note`} className="fs-hold__note fs-t-caption">
                {flat.note}
              </p>
            )}
          </>
        )}
      </footer>
    </article>
  );
}
