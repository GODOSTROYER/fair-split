// Writes packages/i18n/REVIEW.md from the catalogs and the sign-off ledger. A test fails when the committed
// file is stale, so the review sheet always lists every Cebuano and Filipino string.
//
//   pnpm --filter @fairsplit/i18n review

import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { en } from "./catalog/en.js";
import { MACHINE_TRANSLATED_LABEL, reviewEntries } from "./review.js";

const cell = (s: string) => s.replaceAll("|", "\\|");

export function renderReviewDoc(): string {
  const entries = reviewEntries();
  const pending = entries.filter((e) => e.status === "pending-native-review").length;
  const lines = [
    "# Native review",
    "",
    `Every Cebuano (ceb) and Filipino (fil) string is "${MACHINE_TRANSLATED_LABEL}" until a native speaker`,
    "signs it off (OD-2, decision due 5 Nov). Judge Mode shows that chip while any key below is pending.",
    "Record a sign-off in `src/review.ts` (`SIGN_OFFS`) with the reviewer and the date, then run",
    "`pnpm --filter @fairsplit/i18n review` to rewrite this file.",
    "",
    `Pending: ${pending} of ${entries.length}.`,
    "",
  ];
  const rows = entries.map((e) => [
    `\`${e.key}\``,
    e.lang,
    cell(e.text),
    cell(en[e.key]),
    e.signOff ? `signed off by ${e.signOff.reviewer}, ${e.signOff.date}` : "pending native review",
  ]);
  lines.push(...table(["Key", "Lang", "Text", "English", "Status"], rows));
  return `${lines.join("\n")}\n`;
}

/** A Markdown table with padded columns, the way Biome formats Markdown. */
function table(head: string[], rows: string[][]): string[] {
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? "").length)));
  const line = (cells: string[]) => `| ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join(" | ")} |`;
  return [line(head), line(widths.map((w) => "-".repeat(w))), ...rows.map(line)];
}

export const REVIEW_DOC = resolve(dirname(fileURLToPath(import.meta.url)), "../REVIEW.md");

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(REVIEW_DOC, renderReviewDoc());
  console.log("wrote packages/i18n/REVIEW.md");
}
