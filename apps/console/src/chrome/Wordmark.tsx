// The lockup: "Fair Split" always carries "co-op payroll" (register §1), never a middle dot. Stacked in the
// rail; on one line when compact (the stage bar, fallbacks).

import { WORDMARK } from "./copy.js";

export function Wordmark({ compact = false }: { readonly compact?: boolean }) {
  return (
    <p className="fsc-wordmark" data-compact={compact ? "" : undefined}>
      <span className="fsc-wordmark__name">{WORDMARK.name}:</span>{" "}
      <span className="fsc-wordmark__qualifier">{WORDMARK.qualifier}</span>
    </p>
  );
}
