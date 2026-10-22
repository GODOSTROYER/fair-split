// HoldCard: two voices and one decision (design §5, S2 §2.7). The engine's line is a template whose digits
// come from code; Claude's line is pencil, after the pencil glyph and the word "Claude", with no digits.
// Evidence shows as paper, then the money effect, then a gate chip and at most one d2 slab and one flat
// action. A decided hold (resolved, or excluded and carried to the next run: register §7) is flush ink with
// the decider's stamp and never shows actions. A hold is never an error and never red.

import type { DomainGlyph } from "@fairsplit/tokens/glyphs";
import type { ReactNode } from "react";
import { useT } from "./context.js";
import { type HoldCardProps, isFinalHoldState } from "./contract.js";
import { Glyph, type GlyphName } from "./Glyph.js";
import { InkStamp } from "./marks.js";
import { Print } from "./Print.js";
import { Slab } from "./Slab.js";

export interface WebHoldCardProps extends HoldCardProps {
  /** The evidence, as Paper (photos, crops, twin compare). */
  readonly evidence?: ReactNode;
  readonly testId: string;
  readonly className?: string;
}

const KIND_GLYPH: Readonly<Record<HoldCardProps["hold"]["kind"], DomainGlyph>> = {
  DUPLICATE_SLIP: "duplicate",
  IMPLAUSIBLE_YIELD: "plot",
  NO_RULE: "bolt",
  RATE_MISMATCH: "triplicate-slip",
  SUSPECTED_INJECTION: "pencil",
  LOW_CONFIDENCE: "logbook",
  MASS_BALANCE: "hanging-scale",
};

export function HoldCard({ hold, gate, actions, resolution, evidence, testId, className }: WebHoldCardProps) {
  const t = useT();
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
            label={t(`hold.kind.${hold.kind}`)}
          />
        </span>
        <h2 className="fs-hold__title fs-t-title-2" id={`${testId}-title`}>
          {hold.title}
        </h2>
      </header>

      <p className="fs-hold__gate" data-gate={gate} data-testid={`${testId}.gate`}>
        <Glyph name={gate === "BLOCKS_APPROVAL" ? "hanging-scale" : "logbook"} size={16} />
        <span className="fs-t-label">{t(`hold.gate.${gate}`)}</span>
      </p>

      <dl className="fs-hold__voices">
        <div className="fs-hold__voice" data-voice="engine">
          <dt className="fs-t-caption">{t("hold.engine")}</dt>
          <dd className="fs-t-body">{hold.engineLine}</dd>
        </div>
        {hold.claudeLine && (
          <div className="fs-hold__voice" data-voice="claude">
            <dt className="fs-t-caption">
              <Glyph name="pencil" size={14} />
              {t("hold.claude")}
            </dt>
            <dd className="fs-t-body">
              <Print value={hold.claudeLine} provenance="claude" state="pencil" typeRole="body" />
            </dd>
          </div>
        )}
      </dl>

      {evidence && (
        <section className="fs-hold__evidence" aria-label={t("hold.evidence")}>
          {evidence}
        </section>
      )}

      {hold.effect && (
        <div className="fs-hold__effect">
          <p className="fs-t-caption">{t("hold.effect")}</p>
          <p className="fs-t-body">{hold.effect}</p>
        </div>
      )}

      <footer className="fs-hold__actions">
        {decided ? (
          <p className="fs-hold__resolution" data-testid={`${testId}.resolution`}>
            {resolution && <InkStamp stamp={resolution} />}
            <span className="fs-t-label">
              {hold.state === "excluded"
                ? t("hold.state.EXCLUDED")
                : resolution
                  ? t("hold.state.RESOLVED", { initials: resolution.initials, time: resolution.at })
                  : t("hold.state.RESOLVED_UNSTAMPED")}
            </span>
          </p>
        ) : hold.state === "asked-chair" ? (
          <p className="fs-hold__status fs-t-label">{t("hold.state.ASKED_CHAIR")}</p>
        ) : (
          <>
            {hold.state === "conflict" && (
              <p className="fs-hold__status fs-t-label">{t("hold.state.CONFLICT")}</p>
            )}
            <div className="fs-hold__buttons">
              <div className="fs-hold__slab">
                {slab.suggestedByClaude && (
                  <p className="fs-hold__suggested fs-t-caption">
                    <Glyph name="pencil" size={14} />
                    {t("hold.suggested")}
                  </p>
                )}
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
                  <button type="button" className="fs-flat" data-testid={flat.testId} onClick={flat.onSelect}>
                    {flat.label}
                  </button>
                  {flat.note && <span className="fs-t-caption">{flat.note}</span>}
                </div>
              )}
            </div>
          </>
        )}
      </footer>
    </article>
  );
}
