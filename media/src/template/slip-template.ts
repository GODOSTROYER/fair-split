/**
 * Slip template v1: the one printed weigh-slip form every synthetic slip is written on (S4.10, G5).
 *
 * The printed text below is quoted verbatim in every Codex prompt. Box rectangles are stored in
 * slip-normalised coordinates (0..1 of the slip's own width and height, origin top-left). They are a
 * nominal layout only: generated images never match the template pixel for pixel, so every image gets
 * its own reviewed crop fixture (media/fixtures/{id}.json) and the grid detector snaps to the ruled lines
 * that were actually drawn.
 *
 * `media/template/slip-v1.json` is generated from this module (`imagegen template`); a test keeps them equal.
 */

/** Field names follow the `Row` schema of the extraction contract (S4.2), so fixtures, labels and reads line up. */
export const SLIP_FIELDS = [
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
  "deduction_1",
  "deduction_2",
  "signature",
  "clerk_initials",
] as const;
export type SlipField = (typeof SLIP_FIELDS)[number];

/** Copy colours of the triplicate pad, named as in the extraction contract's `copy` enum. */
export const COPY_COLOURS = ["WHITE_ORIGINAL", "PINK_DUPLICATE", "YELLOW_TRIPLICATE"] as const;
export type CopyColour = (typeof COPY_COLOURS)[number];

export interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface TemplateBox {
  /** Printed box number, 1–13. */
  no: number;
  /** Printed label, verbatim (Cebuano/Filipino labels pending native review, OD-2). */
  label: string;
  /** English gloss, for docs and the review UI only; never printed. */
  gloss: string;
  /** Extraction field(s) written in this box; box 13 holds two deduction lines. */
  fields: readonly SlipField[];
  /** Ruled writing lines inside the value cell. */
  lines: 1 | 2;
}

export const SLIP_BOXES: readonly TemplateBox[] = [
  { no: 1, label: "Petsa", gloss: "Date", fields: ["date"], lines: 1 },
  { no: 2, label: "Miyembro No.", gloss: "Member no.", fields: ["member_no"], lines: 1 },
  { no: 3, label: "Ngalan", gloss: "Name", fields: ["member_name"], lines: 1 },
  { no: 4, label: "Plot No.", gloss: "Plot no.", fields: ["plot_no"], lines: 1 },
  { no: 5, label: "Sako", gloss: "Sacks", fields: ["sacks"], lines: 1 },
  { no: 6, label: "Gross (kg)", gloss: "Gross weight (kg)", fields: ["gross_kg"], lines: 1 },
  { no: 7, label: "Tare (kg)", gloss: "Tare (kg)", fields: ["tare_kg"], lines: 1 },
  { no: 8, label: "Net (kg)", gloss: "Net weight (kg)", fields: ["net_kg"], lines: 1 },
  { no: 9, label: "MC %", gloss: "Moisture content (%)", fields: ["mc_pct"], lines: 1 },
  { no: 10, label: "Bawas MC (kg)", gloss: "Less for moisture (kg)", fields: ["mc_less_kg"], lines: 1 },
  { no: 11, label: "Bayranan (kg)", gloss: "Payable weight (kg)", fields: ["payable_kg"], lines: 1 },
  { no: 12, label: "Grado", gloss: "Grade", fields: ["grade"], lines: 1 },
  { no: 13, label: "Kaltas", gloss: "Deductions", fields: ["deduction_1", "deduction_2"], lines: 2 },
];

export const SLIP_PRINTED = {
  coop: "BULAWANON KAKAW GROWERS MULTI-PURPOSE COOPERATIVE",
  place: "Calinan, Davao City",
  title: "RESIBO SA PAGTIMBANG / WEIGH SLIP · Uga nga kakaw",
  serialPrefix: "No.",
  signatureLabel: "Pirma / Thumbmark",
  clerkLabel: "Clerk",
  copyFooter: {
    WHITE_ORIGINAL: "ORIGINAL – MEMBER",
    PINK_DUPLICATE: "DUPLICATE – OFFICE",
    YELLOW_TRIPLICATE: "TRIPLICATE – LOGBOOK",
  } satisfies Record<CopyColour, string>,
  specimen: "SPECIMEN · SYNTHETIC DEMO PAD · NOT A RECORD",
} as const;

export const COPY_PAPER: Record<CopyColour, string> = {
  WHITE_ORIGINAL: "thin off-white carbonless pad paper",
  PINK_DUPLICATE: "thin pink carbonless duplicate paper",
  YELLOW_TRIPLICATE: "thin pale-yellow carbonless triplicate paper",
};

/**
 * Nominal layout in slip-normalised coordinates, measured from the first accepted Codex rendering of
 * this template (spike E1, 22 Oct). Column edges: table left, number|label divider, label|value divider,
 * table right. Row edges: 14 values, the top of row 1 to the bottom of row 13 (row 13 is double height).
 */
export const SLIP_GEOMETRY = {
  table: { x: [0.058, 0.128, 0.355, 0.94] as const },
  rows: [
    0.159, 0.202, 0.246, 0.289, 0.332, 0.376, 0.419, 0.464, 0.51, 0.556, 0.602, 0.647, 0.694, 0.783,
  ] as const,
  serial: { x1: 0.8, y1: 0.09, x2: 0.95, y2: 0.13 },
  signature: { x1: 0.058, y1: 0.807, x2: 0.613, y2: 0.916 },
  clerk: { x1: 0.645, y1: 0.807, x2: 0.94, y2: 0.916 },
  footer: { x1: 0.2, y1: 0.925, x2: 0.8, y2: 0.975 },
} as const;

/** Nominal rectangle of every field, derived from {@link SLIP_GEOMETRY}. */
export function nominalFieldRects(): Record<SlipField, Rect> {
  const [, , valueLeft, tableRight] = SLIP_GEOMETRY.table.x;
  const rows = SLIP_GEOMETRY.rows;
  const out: Partial<Record<SlipField, Rect>> = {
    serial: { ...SLIP_GEOMETRY.serial },
    signature: { ...SLIP_GEOMETRY.signature },
    clerk_initials: { ...SLIP_GEOMETRY.clerk },
  };
  for (const box of SLIP_BOXES) {
    const top = rows[box.no - 1];
    const bottom = rows[box.no];
    if (top === undefined || bottom === undefined) throw new Error(`template rows missing for box ${box.no}`);
    if (box.lines === 1) {
      const field = box.fields[0];
      if (field) out[field] = { x1: valueLeft, y1: top, x2: tableRight, y2: bottom };
    } else {
      const mid = (top + bottom) / 2;
      const [f1, f2] = box.fields;
      if (f1) out[f1] = { x1: valueLeft, y1: top, x2: tableRight, y2: mid };
      if (f2) out[f2] = { x1: valueLeft, y1: mid, x2: tableRight, y2: bottom };
    }
  }
  for (const f of SLIP_FIELDS) if (!out[f]) throw new Error(`template has no rectangle for ${f}`);
  return out as Record<SlipField, Rect>;
}

/** The printed form, as quoted in every slip prompt (one line per printed element). */
export function printedFormSpec(copy: CopyColour | "PER_SLIP" = "WHITE_ORIGINAL"): string[] {
  const footer =
    copy === "PER_SLIP"
      ? `Footer line, bold: the copy name ("${SLIP_PRINTED.copyFooter.WHITE_ORIGINAL}" on white originals)`
      : `Footer line, bold: "${SLIP_PRINTED.copyFooter[copy]}"`;
  const labels = SLIP_BOXES.map((b) => `"${b.no} ${b.label}"`).join(", ");
  return [
    `Top line, bold: "${SLIP_PRINTED.coop}"`,
    `Second line: "${SLIP_PRINTED.place}"`,
    `Third line, bold: "${SLIP_PRINTED.title}"`,
    `Top-right corner: the pre-printed serial number in red ink, "${SLIP_PRINTED.serialPrefix} " followed by the slip's four-digit serial`,
    `Below the header: a ruled table with 13 numbered rows in three columns: the printed row number, the printed label, and an empty writing box. The row labels, top to bottom: ${labels} (row 13 is twice as tall, with two ruled writing lines)`,
    `Under the table, side by side: a box labelled "${SLIP_PRINTED.signatureLabel}" and a small box labelled "${SLIP_PRINTED.clerkLabel}"`,
    footer,
    `Last line, small: "${SLIP_PRINTED.specimen}"`,
    "No logos, no seals, no prices and no money boxes",
  ];
}

/** Serialisable template document written to media/template/slip-v1.json. */
export function templateDocument() {
  return {
    id: "slip-v1",
    version: 1,
    synthetic: true,
    description:
      "Printed weigh-slip template v1 for synthetic Fair Split evidence. Rectangles are slip-normalised (0..1, origin top-left) and nominal; per-image reviewed fixtures are the only source of crops.",
    paper: { pad: "triplicate carbonless", nominalFormat: "A6", copies: COPY_PAPER },
    printed: SLIP_PRINTED,
    boxes: SLIP_BOXES,
    fields: SLIP_FIELDS,
    geometry: SLIP_GEOMETRY,
    fieldRects: nominalFieldRects(),
    nativeReview: "Cebuano and Filipino labels pending native review (OD-2)",
  };
}
