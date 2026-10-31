// M-MB-01 Bayad, the member's statement: the white original copy, square-cornered. Money first, audio second,
// then the receipt (design §6). Rendered inside the Adlaw phone frame, in the member's language.

import { type Lang, needsReviewChip, translate } from "@fairsplit/i18n";
import {
  AmountDisplay,
  type CapsuleFrame,
  Glyph,
  type GlyphName,
  type MotionPreference,
  ReceiptBar,
  Seal,
  Slab,
  StatusCapsule,
  UiProvider,
  useMotionMode,
} from "@fairsplit/ui-web";
import type { ReactNode } from "react";
import { Stamp } from "../chrome/Stamp.js";
import { heroLine, RC_SHORT } from "./content.js";
import { BATCH_SHA256, COOP, HERO, HERO_SLIPS, lineAfter, PEOPLE, SEASON } from "./fixture.js";
import { phpEstimate } from "./format.js";
import "./statement.css";

export type StatementState = "checking" | "sent" | "paid";

/** MM-1 still frame: capsule press and flood, the amount filling, the Paminawa invite ring. */
export interface StatementFrame {
  readonly capsule: CapsuleFrame;
  readonly solid: number;
  readonly invite: number;
}

export interface MemberStatementProps {
  readonly lang: Lang;
  readonly state: StatementState;
  readonly frame?: StatementFrame;
  readonly testId?: string;
  readonly elapsed?: string;
  readonly motion?: MotionPreference;
}

const TABS: readonly {
  readonly key: "app.tab.bayad" | "app.tab.resibo" | "app.tab.pangutana";
  readonly glyph: GlyphName;
}[] = [
  { key: "app.tab.bayad", glyph: "cash" },
  { key: "app.tab.resibo", glyph: "triplicate-slip" },
  { key: "app.tab.pangutana", glyph: "ms:help" },
];

export function MemberStatement({
  lang,
  state,
  frame,
  testId = "M-MB-01",
  elapsed = "0:14",
  motion = "system",
}: MemberStatementProps) {
  const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
    translate(lang, key, values);
  const line = heroLine();
  const netCents = lineAfter(HERO).netCents;
  const date = lang === "en" ? SEASON.cashDay : SEASON.cashDayCeb;
  const paid = state === "paid";
  const capsuleText =
    state === "checking"
      ? t("M-MB-01.checking")
      : paid
        ? t("M-MB-01.paid", { date })
        : t("M-MB-01.sent", { elapsed });
  return (
    <UiProvider lang={lang} motion={motion}>
      <MotionAware>
        {(mode) => (
          <div className="mb" data-testid={testId} data-state={state} lang={lang}>
            {needsReviewChip(lang) && (
              <p className="mb-review fs-t-caption">{translate("en", "W-JG-01.machineTranslated")}</p>
            )}
            <article className="mb-card">
              <header className="mb-card__head">
                <p className="fs-t-label">{COOP.name}</p>
                <p className="fs-t-caption mb-muted">{t("M-MB-01.season", { season: SEASON.code })}</p>
              </header>
              <p className="mb-greeting fs-t-statement-lead">
                {t("M-MB-01.greeting", { name: HERO.greeting })}
              </p>
              {state === "checking" ? (
                <p className="mb-detail fs-t-statement-body">
                  {t("M-MB-01.checkingDetail", { kg: line.kg, count: HERO_SLIPS.length, date })}
                </p>
              ) : (
                <AmountDisplay
                  amount={line.net}
                  estimate={t("money.estimate", { php: phpEstimate(netCents) })}
                  hollow={!paid}
                  solid={frame?.solid}
                  lang={lang}
                  className="mb-amount"
                  testId={`${testId}.amount`}
                />
              )}
              <StatusCapsule
                state={state === "checking" ? "checking" : paid ? "paid" : "sent"}
                text={frame && frame.capsule.label > 0 ? t("M-MB-01.sent", { elapsed }) : capsuleText}
                nextText={frame ? t("M-MB-01.paid", { date }) : undefined}
                frame={frame?.capsule}
                lang={lang}
                testId={`${testId}.capsule`}
              />
              <div className="mb-listen">
                {frame && frame.invite > 0 && frame.invite < 1 && (
                  <span
                    className="mb-listen__ring"
                    aria-hidden
                    style={{
                      opacity: 1 - frame.invite,
                      transform: mode === "full" ? `scale(${1 + 0.05 * frame.invite})` : undefined,
                    }}
                  />
                )}
                <Slab
                  label={t("M-MB-01.listen")}
                  srLabel={t("M-MB-01.listen")}
                  depth="d1"
                  tone="chalk"
                  size="l"
                  width="100%"
                  glyph="listen"
                  testId={`${testId}.paminawa`}
                  onCommit={() => undefined}
                />
              </div>
              {state !== "checking" && (
                <ReceiptBar line={line} onSegment={() => undefined} testId={`${testId}.receipt`} />
              )}
              <ul className="mb-slips" aria-label={t("M-MB-01.slips")}>
                {HERO_SLIPS.map((s) => (
                  <li key={s} className="mb-slip fs-t-figure">
                    <Glyph name="triplicate-slip" size={16} />
                    {s}
                  </li>
                ))}
              </ul>
              {state !== "checking" && (
                <ol className="mb-history" aria-label={t("M-MB-01.history")}>
                  <li>
                    <span className="mb-history__stamps">
                      <Stamp stamp={{ initials: "AS", name: PEOPLE.treasurer.name, at: "10:31" }} />
                      <Stamp stamp={{ initials: "EC", name: PEOPLE.chair.name, at: "10:33" }} />
                    </span>
                    <span className="fs-t-label">{t("M-MB-01.history.approved", { a: "AS", b: "EC" })}</span>
                    <span className="fs-t-caption mb-muted">10:33</span>
                  </li>
                  <li>
                    <Glyph name="rail" size={18} />
                    <span className="fs-t-label">{t("M-MB-01.history.sent")}</span>
                    <span className="fs-t-caption mb-muted">10:34</span>
                  </li>
                  {paid && (
                    <li>
                      <Glyph name="ms:check" size={18} />
                      <span className="fs-t-label">{t("M-MB-01.history.paid")}</span>
                      <span className="fs-t-caption mb-muted">{date}</span>
                    </li>
                  )}
                </ol>
              )}
              <footer className="mb-card__foot">
                <Seal batchSha256={BATCH_SHA256} size={44} keys={state === "checking" ? 0 : 2} />
                <p className="fs-t-caption mb-muted">{t("M-MB-01.footer", { hash: RC_SHORT })}</p>
              </footer>
            </article>
            <p className="mb-questions fs-t-statement-body">
              {t("M-MB-01.questions", { treasurer: PEOPLE.treasurer.short })}
            </p>
            <button type="button" className="fs-flat mb-recheck" data-testid={`${testId}.recheck`}>
              {t("M-MB-01.recheck")}
            </button>
            <nav className="mb-nav" aria-label="Fair Split">
              {TABS.map((tab, i) => (
                <span key={tab.key} className="mb-nav__tab" aria-current={i === 0 ? "page" : undefined}>
                  <span className="mb-nav__indicator">
                    <Glyph name={i === 0 ? (`${tab.glyph}-fill` as GlyphName) : tab.glyph} size={22} />
                  </span>
                  <span className="fs-t-caption">{t(tab.key)}</span>
                </span>
              ))}
            </nav>
          </div>
        )}
      </MotionAware>
    </UiProvider>
  );
}

function MotionAware({
  children,
}: {
  readonly children: (mode: ReturnType<typeof useMotionMode>) => ReactNode;
}) {
  const mode = useMotionMode();
  return <>{children(mode)}</>;
}
