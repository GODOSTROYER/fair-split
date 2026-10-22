// View models for the prototype, built from the fixture and the catalogs the way the API's DTOs will arrive:
// every figure pre-formatted, every sentence from @fairsplit/i18n.

import { type Lang, type MessageKey, translate, type Values } from "@fairsplit/i18n";
import { Glyph, type HoldView, Paper, Print, type StatementLineView } from "@fairsplit/ui-web";
import {
  HERO,
  HERO_RATE,
  HOLDS,
  lineAfter,
  lineWithDuplicate,
  MEMBERS,
  RATE_CARD_SHA256,
  RULES,
  SEASON,
  TOTALS,
} from "./fixture.js";
import { hashPrefix, money, percent, phpEstimate, plain, usd } from "./format.js";
import { SlipSheet } from "./slips.js";

export const en = (key: MessageKey, values?: Values) => translate("en", key, values);
export const RC_SHORT = hashPrefix(RATE_CARD_SHA256);

/** The hero statement line (M-014), as the statement DTO will carry it. */
export function heroLine(): StatementLineView {
  const line = lineAfter(HERO);
  return {
    memberNo: HERO.no,
    kg: "148.0 kg",
    rate: HERO_RATE,
    premiumRule: "R0",
    premium: money(line.premiumCents),
    bonus: money(line.bonusCents),
    deductions: [
      {
        id: "cbu",
        name: "CBU",
        rule: "R1",
        card: SEASON.rateCard,
        amount: money(-line.cbuCents),
      },
    ],
    credits: [],
    net: money(line.netCents),
    netPhp: phpEstimate(line.netCents),
  };
}

export function holdH1(state: HoldView["state"] = "open"): HoldView {
  const dioning = MEMBERS.find((m) => m.no === HOLDS.H1.member);
  return {
    id: "H1",
    kind: "DUPLICATE_SLIP",
    title: en("W-TR-06.H1.title", { slip: HOLDS.H1.slip }),
    engineLine: en("W-TR-06.H1.engine", {
      slip: HOLDS.H1.slip,
      photoA: HOLDS.H1.photoA,
      photoB: HOLDS.H1.photoB,
      amount: usd(TOTALS.duplicateMovedCents),
      members: 63,
      name: dioning?.greeting ?? "",
      shrink: percent(TOTALS.shrinkWithDuplicateBp),
      limit: percent(RULES.massBalanceLimitBp).replace(".00", ".0"),
    }),
    claudeLine: en("W-TR-06.H1.claude"),
    effect: en("W-TR-06.H1.effect", {
      amount: usd(TOTALS.duplicateMovedCents),
      members: 63,
      shrink: percent(TOTALS.shrinkBp),
    }),
    state,
  };
}

export function holdH2(state: HoldView["state"] = "open"): HoldView {
  return {
    id: "H2",
    kind: "IMPLAUSIBLE_YIELD",
    title: en("W-TR-06.H2.title", { name: "Merlyn Ponce" }),
    engineLine: en("W-TR-06.H2.engine", {
      name: "Merlyn Ponce",
      kg: "300.0 kg",
      trees: HOLDS.H2.trees,
      perTree: `${HOLDS.H2.kgPerTree} kg`,
      limit: RULES.yieldLimit,
    }),
    claudeLine: en("W-TR-06.H2.claude"),
    state,
  };
}

export function holdH3(state: HoldView["state"] = "open"): HoldView {
  return {
    id: "H3",
    kind: "NO_RULE",
    title: en("W-TR-06.H3.title", { slip: HOLDS.H3.slip }),
    engineLine: en("W-TR-06.H3.engine", {
      multa: HOLDS.H3.multa,
      slip: HOLDS.H3.slip,
      name: "Nong Tidoy",
      credit: usd(320),
      hauling: HOLDS.H3.hauling,
    }),
    claudeLine: en("W-TR-06.H3.claude"),
    state,
  };
}

/** H1's evidence: the white original from photo B and the pink duplicate from photo D, matched. */
export function TwinEvidence({ compact = false }: { readonly compact?: boolean }) {
  const width = compact ? 104 : 132;
  return (
    <div className="twin">
      <div className="twin__crops">
        <figure className="twin__crop">
          <Paper alt={`Slip ${HOLDS.H1.slip}, white original, photo ${HOLDS.H1.photoA}`}>
            <SlipSheet serial={HOLDS.H1.slip} copy="white" width={width} />
          </Paper>
          <figcaption className="fs-t-caption">
            Photo {HOLDS.H1.photoA}, white original <span className="twin__serial">{HOLDS.H1.slip}</span>
          </figcaption>
        </figure>
        <figure className="twin__crop">
          <Paper alt={`Slip ${HOLDS.H1.slip}, pink duplicate, photo ${HOLDS.H1.photoB}`}>
            <SlipSheet serial={HOLDS.H1.slip} copy="pink" width={width} faint />
          </Paper>
          <figcaption className="fs-t-caption">
            Photo {HOLDS.H1.photoB}, pink duplicate <span className="twin__serial">{HOLDS.H1.slip}</span>
          </figcaption>
        </figure>
      </div>
      <p className="twin__verdict">
        <Glyph name="duplicate" size={16} />
        <Print value={en("W-TR-06.H1.twin")} provenance="engine" state="pencil" typeRole="label" />
      </p>
    </div>
  );
}

/** Grid rows for W-TR-05: the register's nine members, in the state H1 leaves them. */
export interface GridRow {
  readonly no: string;
  readonly name: string;
  readonly lang: Lang;
  readonly kg: string;
  readonly kgPerTree?: string;
  readonly premium: string;
  readonly bonus: string;
  readonly kaltas: readonly { readonly name: string; readonly amount: string; readonly rule: string }[];
  readonly credit: string;
  readonly net: string;
  readonly rail: "paypal" | "cash";
  readonly status: "ready" | "held" | "reserved" | "by-hand";
  readonly hold?: string;
}

export function splitRows(stage: "h1-open" | "resolved"): GridRow[] {
  return MEMBERS.map((m) => {
    const line = stage === "h1-open" ? lineWithDuplicate(m) : lineAfter(m);
    const kaltas: { name: string; amount: string; rule: string }[] = [];
    if (line.cbuCents)
      kaltas.push({ name: en("W-TR-05.kaltas.cbu"), amount: plain(-line.cbuCents), rule: "R1" });
    if (line.loanCents)
      kaltas.push({ name: en("W-TR-05.kaltas.loan"), amount: plain(-line.loanCents), rule: "R3" });
    const status: GridRow["status"] =
      stage === "resolved"
        ? "ready"
        : m.hold === "H1" || m.hold === "H2"
          ? "held"
          : m.hold === "H3"
            ? "reserved"
            : m.hold === "BY_HAND"
              ? "by-hand"
              : "ready";
    return {
      no: m.no,
      name: m.name,
      lang: m.lang,
      kg: `${(line.kgTenths / 10).toFixed(1)}`,
      kgPerTree: m.no === HOLDS.H2.member ? HOLDS.H2.kgPerTree : undefined,
      premium: plain(line.premiumCents),
      bonus: plain(line.bonusCents),
      kaltas,
      credit: line.creditCents ? plain(line.creditCents) : "",
      net: plain(line.netCents),
      rail: m.rail,
      status,
      hold: m.hold,
    };
  });
}

export const LIMIT = RULES.yieldLimit;
