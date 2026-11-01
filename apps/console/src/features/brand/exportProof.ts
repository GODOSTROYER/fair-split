// "Export proof (CSV and JSON with hashes)" (W-BR-01, S1.8): built in the brand's own browser from the brand tier's
// bundle. It is the only place complete receivers and plot details appear (C-23): the screen shows names and masked
// receivers only. Pure functions, so the files are tested byte for byte; money and kilos are exact decimals from
// integer cents and grams (never floats), and every text cell is guarded against spreadsheet formula injection.

import type { ProofBundle, SeasonSnapshot } from "@fairsplit/contracts";

export const EXPORT_KIND = "fairsplit.proof.brand-export";

/** Integer cents as a plain decimal: 6445 → "64.45", −109 → "-1.09". No grouping, no symbol. */
export function centsDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new RangeError("cents must be a safe integer");
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Integer grams as kilos to the gram: 148000 → "148.000". */
export function gramsDecimal(grams: number): string {
  if (!Number.isSafeInteger(grams) || grams < 0) throw new RangeError("grams must be a non-negative integer");
  return `${Math.trunc(grams / 1000)}.${String(grams % 1000).padStart(3, "0")}`;
}

/**
 * One CSV cell (RFC 4180): quoted when it holds a comma, quote or line break. A text cell that a spreadsheet would
 * run as a formula (=, +, -, @, tab, CR) is prefixed with an apostrophe; numbers are left as they are.
 */
export function csvCell(value: string | number | null): string {
  if (value === null) return "";
  if (typeof value === "number") return String(value);
  const guarded = /^[=+\-@\t\r]/.test(value) && !/^-?\d+(\.\d+)?$/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export const CSV_COLUMNS = [
  "member_no",
  "name",
  "rail",
  "verified_kg",
  "grade1_kg",
  "premium_usd",
  "bonus_usd",
  "deductions_usd",
  "credits_usd",
  "net_usd",
  "line_sha256",
  "slips",
  "sender_item_id",
  "payout_item_id",
  "item_status",
  "item_event_id",
  "receiver",
  "plots",
  /** Where every PayPal value in the row ran: "simulated" (the simulator) or "sandbox" (I8, ADR-0002). */
  "paypal_rail",
  /** The bundle's provenance, in words (seeded sample, replay, …). */
  "provenance",
] as const;

export interface ExportMember {
  readonly memberNo: string;
  readonly name: string;
  readonly plots: readonly { readonly plotNo: string; readonly areaHa: string; readonly trees: number }[];
}

export function membersOf(
  snapshot: Pick<SeasonSnapshot, "members"> | undefined,
): ReadonlyMap<string, ExportMember> {
  return new Map(
    (snapshot?.members ?? []).map((m) => [
      m.memberNo,
      {
        memberNo: m.memberNo,
        name: m.displayName,
        plots: m.plots.map((p) => ({ plotNo: p.plotNo, areaHa: p.areaHa, trees: p.trees })),
      },
    ]),
  );
}

function itemFor(bundle: ProofBundle, memberNo: string) {
  // A re-route ("r37x1-M-031") is the newest item for its member.
  let found: ProofBundle["batch"]["items"][number] | undefined;
  for (const item of bundle.batch.items) if (item.senderItemId.endsWith(`-${memberNo}`)) found = item;
  return found;
}

/** Every member's line, one row each, with its hash, its slips and the PayPal item it was paid by. */
export function proofCsv(
  bundle: ProofBundle,
  members: ReadonlyMap<string, ExportMember>,
  meta: Pick<ExportMeta, "rail" | "provenance">,
): string {
  const rows: string[] = [CSV_COLUMNS.join(",")];
  for (const line of bundle.lines) {
    const k = line.canonical;
    const member = members.get(line.memberNo);
    const item = itemFor(bundle, line.memberNo);
    const plots = (member?.plots ?? []).map((p) => `${p.plotNo} ${p.areaHa} ha ${p.trees} trees`).join("; ");
    const cells: (string | number | null)[] = [
      line.memberNo,
      member?.name ?? null,
      line.rail,
      gramsDecimal(k.verifiedG),
      gramsDecimal(k.grade1G),
      centsDecimal(line.premiumCents),
      centsDecimal(line.bonusCents),
      centsDecimal(line.deductionsCents),
      centsDecimal(line.creditsCents),
      centsDecimal(line.netCents),
      line.lineSha256,
      k.slipSerials.join(" "),
      item?.senderItemId ?? null,
      item?.payoutItemId ?? null,
      item?.status ?? null,
      item?.eventId ?? null,
      item?.receiver ?? null,
      plots,
      meta.rail,
      meta.provenance,
    ];
    rows.push(cells.map(csvCell).join(","));
  }
  return `${rows.join("\r\n")}\r\n`;
}

export interface ExportMeta {
  readonly generatedAt: string;
  /** "simulated" or "sandbox": every PayPal value in the file carries its rail (I8). */
  readonly rail: "simulated" | "sandbox";
  readonly provenance: string | null;
}

/** The whole bundle (every hash, the ledger and its signed checkpoint), with names and plots beside it. */
export function proofJson(
  bundle: ProofBundle,
  members: ReadonlyMap<string, ExportMember>,
  meta: ExportMeta,
): string {
  const document = {
    v: 1,
    kind: EXPORT_KIND,
    runSlug: bundle.runSlug,
    generatedAt: meta.generatedAt,
    paypalRail: meta.rail,
    provenance: meta.provenance,
    note: "Names, complete receivers and plot details are shared with the brand under the data-sharing agreement. Re-check the bundle with verify-core against /.well-known/fairsplit-keys.json.",
    members: bundle.lines.map((line) => {
      const member = members.get(line.memberNo);
      const item = itemFor(bundle, line.memberNo);
      return {
        memberNo: line.memberNo,
        name: member?.name ?? null,
        receiver: item?.receiver ?? null,
        plots: member?.plots ?? [],
      };
    }),
    bundle,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function exportFileName(runSlug: string, ext: "csv" | "json"): string {
  return `fairsplit-proof-${runSlug.replace(/[^A-Za-z0-9-]/g, "")}.${ext}`;
}

/** Hands the viewer a file to save. Returns false where the browser cannot (no object URLs). */
export function downloadText(name: string, text: string, type: string): boolean {
  if (typeof URL === "undefined" || typeof URL.createObjectURL !== "function") return false;
  const url = URL.createObjectURL(new Blob([text], { type }));
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.append(a);
    a.click();
    a.remove();
    return true;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
