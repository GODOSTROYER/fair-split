// The evidence on each hold card, as paper (design §2.5: evidence is the only thing that casts a shadow).
// H1: the two copies of slip 0457 side by side, converging, then their matching fields lit in turn (MM-3, "The
// pink copy"; S2.9: the two photos are separate generations, so the proof is matching fields, not an overlay).
// Serial, date, member and net kg light in turn, 120 ms apart, their values printing in ink, two to a row; one
// canary underline draws beneath the two serials (design §7 M3), then "4/4 fields match" prints. The count is
// the DTO's: a field that differs keeps its pencil "≠" and is never lit, so a mismatch reads "3/4". H2: the
// registry's plots and the kilos-per-tree bar. H3: box 13 of slip 0458, each line against Schedule A's closed
// list (its four rules as micro chips). Every figure is the seed's or the engine's.

import type { SnapshotSlip } from "@fairsplit/contracts";
import { MOMENTS, type MomentPhase, TIMING } from "@fairsplit/motion";
import { Glyph, Print } from "@fairsplit/ui-web";
import { HOLDS } from "../split/shared/copy.js";
import { copyWord, SlipPaper } from "../split/shared/SlipPaper.js";
import type { NoRuleFacts, TwinRow, YieldFacts } from "./model.js";

type Mm3Phase = MomentPhase<"MM-3">;
const MM3 = MOMENTS["MM-3"] as readonly Mm3Phase[];

/** True once MM-3 has reached `at` (phases run in the catalogue's order). */
export function reached(phase: Mm3Phase, at: Mm3Phase): boolean {
  return MM3.indexOf(phase) >= MM3.indexOf(at);
}

export interface TwinCompareProps {
  readonly a: SnapshotSlip;
  readonly b: SnapshotSlip;
  readonly rows: readonly TwinRow[];
  /** The MM-3 phase the evidence shows. */
  readonly phase: Mm3Phase;
  /** Animate the phase's entrance (a live act); history and replays draw the phase in place. */
  readonly animate: boolean;
  readonly mode: "full" | "reduced" | "low";
}

export function TwinCompare({ a, b, rows, phase, animate, mode }: TwinCompareProps) {
  const matched = rows.filter((r) => r.match);
  const converged = reached(phase, "converge");
  // pairs: the matching fields light in turn (MM3_PAIRS order), one TIMING.pairStagger apart.
  const lit = reached(phase, "pairs");
  const ready = reached(phase, "ready");
  let pair = 0;
  const copy = (slip: SnapshotSlip, side: "a" | "b") => (
    <figure className="fsr-twin__copy" data-side={side} data-copy={slip.copy}>
      <SlipPaper
        slip={slip}
        width={152}
        alt={HOLDS.slipAlt(slip.serial, copyWord(slip.copy), slip.photoId)}
        testId={`W-TR-06.twin.${side}`}
      />
      <figcaption className="fsr-twin__caption fs-t-micro">
        {HOLDS.copyCaption(slip.photoId, copyWord(slip.copy))}
      </figcaption>
    </figure>
  );
  return (
    <div
      className="fsr-twin"
      data-phase={phase}
      data-animate={animate ? "" : undefined}
      data-converged={converged ? "" : undefined}
      data-lit={lit ? "" : undefined}
      data-motion={mode}
      data-testid="W-TR-06.twin"
    >
      <div className="fsr-twin__copies">
        {copy(a, "a")}
        <span className="fsr-twin__seam" aria-hidden />
        {copy(b, "b")}
      </div>
      <table className="fsr-twin__fields" data-testid="W-TR-06.twin.fields">
        <caption className="fs-sr">{HOLDS.compareCaption}</caption>
        <thead className="fs-sr">
          <tr>
            <th scope="col">Field</th>
            <th scope="col">{copyWord(a.copy)}</th>
            <th scope="col">{copyWord(b.copy)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.field}
              data-field={r.field}
              data-match={r.match ? "" : undefined}
              data-lit={lit && r.match ? "" : undefined}
              style={
                r.match ? { ["--fsr-pair-at" as string]: `${pair++ * TIMING.pairStagger}ms` } : undefined
              }
              data-testid={`W-TR-06.twin.${r.field}`}
            >
              <th scope="row" className="fs-t-caption">
                {HOLDS.field[r.field]}
              </th>
              <td className="fs-t-figure">{r.a}</td>
              <td className="fs-t-figure">
                <span className="fsr-twin__eq" aria-hidden>
                  {r.match ? "=" : "≠"}
                </span>
                {r.b}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p
        className="fsr-twin__verdict"
        data-testid="W-TR-06.twin.verdict"
        data-all={matched.length === rows.length ? "" : undefined}
        title={HOLDS.fieldsMatchSpoken(matched.length, rows.length)}
        hidden={!ready}
      >
        <Glyph name="duplicate" size={16} />
        <Print
          value={HOLDS.fieldsMatch(matched.length, rows.length)}
          provenance="engine"
          state="pencil"
          typeRole="label"
          reveal={animate && ready}
        />
      </p>
    </div>
  );
}

export interface YieldEvidenceProps {
  readonly facts: YieldFacts;
  readonly plots: readonly {
    readonly plotNo: string;
    readonly areaHa: string;
    readonly trees: number;
    readonly registered: boolean;
  }[];
  /** H2 decided with the plot registered: the bar reads the new figure. */
  readonly registered: boolean;
}

/** H2: the registry's plots, the one not registered yet, and kilos a tree against the ratified limit. */
export function YieldEvidence({ facts, plots, registered }: YieldEvidenceProps) {
  const ratio = registered && facts.ratioAfter !== null ? facts.ratioAfter : facts.ratio;
  const perTree = registered && facts.perTreeAfter !== null ? facts.perTreeAfter : facts.perTree;
  const over = ratio > 1;
  return (
    <div className="fsr-yield" data-testid="W-TR-06.yield">
      <figure className="fsr-yield__bar" data-over={over ? "" : undefined}>
        <span className="fsr-yield__track" aria-hidden>
          <span className="fsr-yield__fill" style={{ width: `${Math.min(1, ratio) * 50}%` }} />
          {over && <span className="fsr-yield__over" style={{ width: `${Math.min(1, ratio - 1) * 50}%` }} />}
          <span className="fsr-yield__limit" />
        </span>
        <figcaption className="fsr-yield__caption">
          <span className="fs-t-figure" data-testid="W-TR-06.yield.now">
            {HOLDS.perTreeNow(perTree)}
          </span>
          <span className="fs-t-caption">{HOLDS.perTreeLimit(facts.limit)}</span>
        </figcaption>
      </figure>
      <div className="fsr-plots">
        <p className="fsr-plots__title fs-t-caption fsr-muted" title={HOLDS.plotPrivate}>
          {HOLDS.plotsTitle}
          <Glyph name="ms:lock" size={12} label={HOLDS.plotPrivate} />
        </p>
        <ul>
          {plots.map((p) => {
            const isRegistered = p.registered || registered;
            return (
              <li
                key={p.plotNo}
                data-registered={isRegistered ? "" : undefined}
                data-testid={`W-TR-06.plot.${p.plotNo}`}
              >
                <Glyph name={isRegistered ? "plot-fill" : "plot"} size={16} />
                <span className="fs-t-figure">
                  {isRegistered
                    ? HOLDS.plotRegistered(p.plotNo, p.areaHa, p.trees)
                    : HOLDS.plotPending(p.plotNo, p.areaHa, p.trees)}
                </span>
                {!isRegistered && (
                  <span className="fsr-plots__pending fs-t-label">{HOLDS.plotNotRegistered}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

export interface NoRuleEvidenceProps {
  readonly slip: SnapshotSlip | undefined;
  readonly facts: NoRuleFacts;
}

/** H3: box 13 of the slip, each written deduction against Schedule A's closed list. */
export function NoRuleEvidence({ slip, facts }: NoRuleEvidenceProps) {
  return (
    <div className="fsr-norule" data-testid="W-TR-06.norule">
      {slip && (
        <SlipPaper
          slip={slip}
          width={184}
          alt={HOLDS.slipAlt(slip.serial, copyWord(slip.copy), slip.photoId)}
          markLine={facts.text}
          testId="W-TR-06.norule.slip"
        />
      )}
      <div className="fsr-norule__marks">
        <p className="fs-t-caption fsr-muted">{HOLDS.marksTitle(facts.serial)}</p>
        <ul>
          {facts.marks.map((m) => (
            <li key={m.text} data-rule={m.rule ?? "none"}>
              <span className="fs-t-body">{m.text}</span>
              {m.rule ? (
                <span className="fsr-norule__ok fs-t-label">
                  <Glyph name="ms:check" size={14} />
                  {HOLDS.ruleOk(m.rule)}
                </span>
              ) : (
                <span className="fsr-norule__none fs-t-label">
                  <Glyph name="bolt" size={14} />
                  {HOLDS.markNoRule}
                </span>
              )}
            </li>
          ))}
        </ul>
        <p className="fsr-norule__rules" title={HOLDS.closedList}>
          <span className="fs-t-caption fsr-muted">{HOLDS.closedListLabel}</span>
          {HOLDS.rules.map((r) => (
            <span
              key={r.id}
              className="fsr-norule__rule fs-t-micro"
              data-used={facts.marks.some((m) => m.rule === r.id) ? "" : undefined}
            >
              {r.id} {r.name}
            </span>
          ))}
          <span className="fs-sr">{HOLDS.closedList}</span>
        </p>
      </div>
    </div>
  );
}
