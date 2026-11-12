// ReceiptBar: why a member's number is their number, read left to right (design §5, S2 §2.7):
// kilos × rate, then the premium (protected, never deducted), the bonus, ruled deductions as rule chips,
// credits, and the net. Every segment can be tapped and reports its rect (MM-7 starts from it). The row
// becomes a list in narrow containers, which is also how it reads at large text sizes.

import type { MouseEvent, ReactNode } from "react";
import { useT } from "./context.js";
import type { ReceiptBarProps, SegmentId, StatementLineView } from "./contract.js";
import { Glyph } from "./Glyph.js";
import { ruleChipTitle } from "./marks.js";

export interface WebReceiptBarProps extends ReceiptBarProps {
  readonly testId?: string;
  /** Which segment is lifted into its ink frame (MM-7 "framed"). */
  readonly active?: SegmentId;
  readonly className?: string;
}

interface SegmentSpec {
  readonly id: SegmentId;
  readonly operator: "" | "×" | "+" | "−" | "=";
  readonly label: ReactNode;
  readonly value: string;
  readonly spoken: string;
  readonly note?: ReactNode;
  readonly kind: "basis" | "pay" | "rule" | "credit" | "net";
}

function segments(line: StatementLineView, t: ReturnType<typeof useT>): SegmentSpec[] {
  const out: SegmentSpec[] = [
    {
      id: "kg-rate",
      operator: "",
      label: line.kg,
      value: `× ${line.rate}`,
      spoken: `${line.kg} × ${line.rate}`,
      kind: "basis",
    },
    {
      id: "premium",
      operator: "=",
      label: (
        <>
          {t("M-MB-01.premium")} <Glyph name="ms:lock" size={14} />
        </>
      ),
      value: line.premium.display,
      spoken: `${t("M-MB-01.premium")}, ${line.premium.spoken}, ${t("M-MB-01.noDeductions")}`,
      note: t("M-MB-01.noDeductions"),
      kind: "pay",
    },
    {
      id: "bonus",
      operator: "+",
      label: t("M-MB-01.bonus"),
      value: line.bonus.display,
      spoken: `${t("M-MB-01.bonus")}, ${line.bonus.spoken}`,
      kind: "pay",
    },
  ];
  for (const rule of line.deductions) {
    out.push({
      id: `rule:${rule.id}`,
      operator: "−",
      label: rule.name,
      value: rule.amount.display,
      spoken: `${rule.name}, ${rule.amount.spoken}, ${t("M-MB-01.rule", { rule: rule.rule, card: rule.card })}`,
      note: t("M-MB-01.rule", { rule: rule.rule, card: rule.card }),
      kind: "rule",
    });
  }
  for (const credit of line.credits) {
    out.push({
      id: `credit:${credit.id}`,
      operator: "+",
      label: credit.name,
      value: credit.amount.display,
      spoken: `${credit.name}, ${credit.amount.spoken}`,
      kind: "credit",
    });
  }
  out.push({
    id: "net",
    operator: "=",
    label: line.netPhp ? t("money.estimate", { php: line.netPhp }) : "",
    value: line.net.display,
    spoken: line.net.spoken,
    kind: "net",
  });
  return out;
}

export function ReceiptBar({ line, onSegment, testId, active, className }: WebReceiptBarProps) {
  const t = useT();
  const items = segments(line, t);
  const report = (id: SegmentId) => (e: MouseEvent<HTMLButtonElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSegment(id, { x: r.x, y: r.y, width: r.width, height: r.height });
  };
  return (
    <div className={["fs-receipt", className].filter(Boolean).join(" ")} data-testid={testId}>
      <ol className="fs-receipt__row">
        {items.map((s) => (
          <li key={s.id} className="fs-receipt__item" data-kind={s.kind}>
            {s.operator && (
              <span className="fs-receipt__op" aria-hidden>
                {s.operator}
              </span>
            )}
            <button
              type="button"
              className="fs-receipt__seg"
              data-segment={s.id}
              data-active={active === s.id ? "" : undefined}
              data-testid={testId ? `${testId}.${s.id}` : undefined}
              aria-label={s.spoken}
              onClick={report(s.id)}
            >
              <span className="fs-receipt__label fs-t-caption">{s.label}</span>
              <span
                className={
                  s.kind === "net" ? "fs-receipt__value fs-t-amount-l" : "fs-receipt__value fs-t-figure"
                }
              >
                {s.kind === "rule" ? (
                  // Round 5: no ids for people. The chip reads its amount; the rule's id is its title.
                  <span
                    className="fs-rule-chip"
                    title={typeof s.note === "string" && s.note ? ruleChipTitle(s.note) : undefined}
                  >
                    {s.value}
                  </span>
                ) : (
                  s.value
                )}
              </span>
              {s.note && s.kind === "pay" && <span className="fs-receipt__note fs-t-caption">{s.note}</span>}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
