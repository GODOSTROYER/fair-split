import type { CopyColour, RowField } from "./schema.js";

/** Slip template v1 (S4.10): printed box number and label of every field. */
export const FIELD_INFO: Record<RowField, { box: string; label: string }> = {
  serial: { box: "No.", label: "Serial (red, printed)" },
  line_no: { box: "Line", label: "Logbook line no." },
  date: { box: "1", label: "Petsa" },
  member_no: { box: "2", label: "Miyembro No." },
  member_name: { box: "3", label: "Ngalan" },
  plot_no: { box: "4", label: "Plot No." },
  sacks: { box: "5", label: "Sako" },
  gross_kg: { box: "6", label: "Gross (kg)" },
  tare_kg: { box: "7", label: "Tare (kg)" },
  net_kg: { box: "8", label: "Net (kg)" },
  mc_pct: { box: "9", label: "MC %" },
  mc_less_kg: { box: "10", label: "Bawas MC (kg)" },
  payable_kg: { box: "11", label: "Bayranan (kg)" },
  grade: { box: "12", label: "Grado" },
  clerk_initials: { box: "Clerk", label: "Clerk initials" },
};

export const KILO_FIELDS = [
  "gross_kg",
  "tare_kg",
  "net_kg",
  "mc_less_kg",
  "payable_kg",
] as const satisfies readonly RowField[];
export type KiloField = (typeof KILO_FIELDS)[number];
export const isKiloField = (f: string): f is KiloField => (KILO_FIELDS as readonly string[]).includes(f);

/**
 * Required fields per row kind; only required fields are scored (S4.2 agreement). Slips fill boxes
 * 1-12 and carry a printed serial; logbook lines carry a line number, serial, date, member and net.
 */
const SLIP_REQUIRED: readonly RowField[] = [
  "serial",
  "date",
  "member_no",
  "member_name",
  "plot_no",
  "sacks",
  "gross_kg",
  "tare_kg",
  "net_kg",
  "mc_pct",
  "mc_less_kg",
  "payable_kg",
  "grade",
];
const LOGBOOK_REQUIRED: readonly RowField[] = ["line_no", "serial", "date", "member_no", "net_kg"];

export function requiredFields(copy: CopyColour): readonly RowField[] {
  return copy === "LOGBOOK_LINE" ? LOGBOOK_REQUIRED : SLIP_REQUIRED;
}

/** Fields that are scored when present even if not required (an optional field ABSENT in both is skipped). */
export function scoredFields(copy: CopyColour): readonly RowField[] {
  const req = requiredFields(copy);
  const optional: RowField[] = copy === "LOGBOOK_LINE" ? ["member_name", "plot_no", "gross_kg", "grade"] : [];
  return [...req, ...optional.filter((f) => !req.includes(f))];
}

/** A LOW_CONFIDENCE hold blocks approval when kilos, serial, member or grade are affected (S4.2). */
export function lowConfidenceGate(field: RowField): "BLOCKS_APPROVAL" | "RESERVES_LINE" {
  return isKiloField(field) || field === "serial" || field === "member_no" || field === "grade"
    ? "BLOCKS_APPROVAL"
    : "RESERVES_LINE";
}

/** The zoom label, e.g. "Box 6 'Gross (kg)' of slip 0462". */
export function zoomLabel(field: RowField, serial: string): string {
  const info = FIELD_INFO[field];
  const where = /^\d+$/.test(info.box) ? `Box ${info.box} '${info.label}'` : `The '${info.label}' field`;
  return `${where} of slip ${serial || "(serial unread)"}`;
}
