// One truth for counts and ids on screen (UI gate round 3): display helpers, so the console, the stage, Proof and
// the phone preview say the same thing. They never change a figure; they only say which figure it is.
// - The season is "2026-A" in every piece of display text; run slugs ("2026A-r37") stay as data (URLs, keys).
// - The invoice before the first press is the showcase run's (FS-2026A-r37, seeded, recorded 29 Oct): the judge's
//   own run gets its own number at the first press (FS-2026A-r1 on a fresh stack). So the first view labels the
//   showcase id as the showcase's; a session shows its own run's id alone.
// - Slips: 48 slip images are read in this run (photos A-L); 264 is every slip image in the season's 66 photos (the
//   54 earlier photos included). "48 this run · 264 season".
// - The pay split: 8 PayPal and 56 cash are planned until the run settles; then 7 PayPal and 57 cash (Rhea's line
//   moved to cash). Planned counts read in grey.

import type { SeasonSnapshot } from "@fairsplit/contracts";
import { atLeast, type RunView } from "../data/run-view.js";

/** "2026A" or "2026-A" → "2026-A": the season as people read it. Anything else comes back unchanged. */
export function seasonLabel(codeOrLabel: string): string {
  const m = /^(\d{4})-?([A-Z])$/.exec(codeOrLabel.trim());
  return m ? `${m[1]}-${m[2]}` : codeOrLabel;
}

/** A run slug for display: "2026A-r37" → { season: "2026-A", run: "r37", text: "2026-A · r37" }. */
export function runLabel(runSlug: string): {
  readonly season: string;
  readonly run: string;
  readonly text: string;
} {
  const m = /^(\d{4}[A-Z])-(r\d+)$/.exec(runSlug);
  if (!m) return { season: "", run: runSlug, text: runSlug };
  const season = seasonLabel(m[1] ?? "");
  const run = m[2] ?? runSlug;
  return { season, run, text: `${season} · ${run}` };
}

/** Where an invoice id comes from: the showcase run (before the first press) or the judge's own run. */
export type InvoiceSource = "showcase" | "session";

/** The showcase id's label, beside its number in the micro role. */
export const SHOWCASE_LABEL = "showcase run";

/**
 * The invoice id as the screen shows it: the number (PayPal's, so it stays as data) and, before the first press,
 * that it is the showcase run's. `spoken` is the whole thing for an accessible name or a title.
 */
export function invoiceLabel(
  number: string,
  source: InvoiceSource,
): { readonly number: string; readonly note: string | null; readonly spoken: string } {
  const note = source === "showcase" ? SHOWCASE_LABEL : null;
  return { number, note, spoken: note ? `Invoice ${number}, the ${note}'s` : `Invoice ${number}` };
}

/** The invoice the stage shows: the session's own run once there is one, else the showcase's, labelled. */
export function stageInvoice(
  snapshot: SeasonSnapshot | undefined,
  view: RunView | undefined,
  inSession: boolean,
): ReturnType<typeof invoiceLabel> | null {
  if (inSession && view?.invoice.number) return invoiceLabel(view.invoice.number, "session");
  const showcase = snapshot?.run.invoice.invoiceNumber;
  return showcase ? invoiceLabel(showcase, "showcase") : null;
}

/** Slip counts with their scope said: this run's 48 and the season's 264. */
export function slipCounts(snapshot: SeasonSnapshot): {
  readonly run: number;
  readonly season: number;
  readonly text: string;
} {
  const run = snapshot.slips.filter((s) => s.replaySet).length;
  const season = snapshot.figures.slipImages;
  return { run, season, text: `${run} this run · ${season} season` };
}

/**
 * The pay split for a count cell: planned until the run settles ("8 · 56 planned", grey), then what happened
 * ("7 PayPal · 57 cash"). Every number is the snapshot's.
 */
export function payCell(
  snapshot: SeasonSnapshot,
  view: RunView | undefined,
): {
  readonly phase: "planned" | "settled";
  readonly paypal: number;
  readonly cash: number;
  readonly text: string;
} {
  const f = snapshot.figures;
  const settled = view !== undefined && atLeast(view, "SETTLED");
  if (settled) {
    return {
      phase: "settled",
      paypal: f.endPaidMembers,
      cash: f.endCashMembers,
      text: `${f.endPaidMembers} PayPal · ${f.endCashMembers} cash`,
    };
  }
  return {
    phase: "planned",
    paypal: f.batchItemCount,
    cash: f.cashMembers,
    text: `${f.batchItemCount} · ${f.cashMembers} planned`,
  };
}
