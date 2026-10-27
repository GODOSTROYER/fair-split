// axe-core 4.13.0 over a rendered tree (WCAG 2.2 AA tags). jsdom has no layout, so colour contrast is not
// computable here: contrast is tested on the tokens (packages/tokens contrast gate) and by Playwright on real
// pages. Everything structural (names, roles, landmarks, labels, ARIA) is checked on every state.

import axe from "axe-core";

export interface AxeOptions {
  /** Extra rule IDs to switch off for one call, each with a reason in the test. */
  readonly disable?: readonly string[];
}

const ALWAYS_OFF = ["color-contrast", "color-contrast-enhanced"] as const;

export async function axeViolations(root: Element, options: AxeOptions = {}): Promise<axe.Result[]> {
  const rules: axe.RuleObject = {};
  for (const id of [...ALWAYS_OFF, ...(options.disable ?? [])]) rules[id] = { enabled: false };
  const result = await axe.run(root, {
    runOnly: {
      type: "tag",
      values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"],
    },
    rules,
    resultTypes: ["violations"],
  });
  return result.violations;
}

/** A readable summary of violations, for the assertion message. */
export function describeViolations(violations: readonly axe.Result[]): string {
  return violations
    .map(
      (v) =>
        `${v.id} (${v.impact ?? "?"}): ${v.help}\n${v.nodes.map((n) => `  ${n.target.join(" ")}`).join("\n")}`,
    )
    .join("\n");
}

/** Throws with every violation listed when axe finds any. */
export async function expectNoAxeViolations(root: Element, options: AxeOptions = {}): Promise<void> {
  const violations = await axeViolations(root, options);
  if (violations.length > 0)
    throw new Error(`axe found ${violations.length} violation(s):\n${describeViolations(violations)}`);
}
