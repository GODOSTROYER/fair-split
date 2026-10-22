// Print: what a machine says (design §2.5). Flat text with no container and never a button. Claude's
// readings and the engine's figures print in pencil until the two keys turn them to ink; approved amounts
// waiting for the member are hollow; a field read below 0.85 confidence sits in a You cell for a person.

import type { TypeRoleName } from "@fairsplit/tokens";
import { useMotionMode, useT } from "./context.js";
import { AUTO_ACCEPT, type PrintProps } from "./contract.js";

export interface WebPrintProps extends PrintProps {
  /** Type role, from the token type scale. Money, kilos and hashes use a tabular role. */
  readonly typeRole?: TypeRoleName;
  readonly testId?: string;
  readonly as?: "span" | "div" | "p";
  readonly className?: string;
}

export function Print({
  value,
  provenance,
  confidence,
  state,
  footer,
  reveal = false,
  typeRole = "figure",
  testId,
  as: Tag = "span",
  className,
}: WebPrintProps) {
  const t = useT();
  const mode = useMotionMode();
  const low = confidence !== undefined && confidence < AUTO_ACCEPT;
  const classes = ["fs-print", `fs-t-${typeRole}`, className].filter(Boolean).join(" ");
  const revealAttr = reveal ? (mode === "reduced" ? "fade" : "wipe") : undefined;
  const body = low ? (
    <span className="fs-you" data-testid={testId ? `${testId}.you` : undefined}>
      <span className="fs-you__value">{value}</span>
      <span className="fs-you__tag">{t("you.tag")}</span>
    </span>
  ) : (
    value
  );
  return (
    <Tag
      className={classes}
      data-testid={testId}
      data-state={state}
      data-provenance={provenance}
      data-confidence={low ? "low" : confidence !== undefined ? "accepted" : undefined}
      data-reveal={revealAttr}
    >
      <span className="fs-print__value">{body}</span>
      {footer && <span className="fs-print__footer fs-t-caption">{footer}</span>}
    </Tag>
  );
}
