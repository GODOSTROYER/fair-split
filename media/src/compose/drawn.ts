import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { draftField, draftReview } from "../fixtures/build.js";
import { SLIP_ROW_FIELDS, type SlipFixture, SlipImageFixture } from "../fixtures/schema.js";
import type { CopyColour, SlipField } from "../template/slip-template.js";
import { sha256 } from "../util/hash.js";

/** Only the seed's written boxes are rendered; no amount is inferred or computed here. */
export interface SeedSlip {
  serial: string;
  copy: CopyColour;
  photoId: string;
  position: "TL" | "TR" | "BL" | "BR";
  boxes: Record<string, string | string[]>;
  signature: "SIGNED" | "THUMBMARK";
  clerkInitials: string;
  marginNote: string | null;
}

export const xml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const jsonBytes = (value: unknown) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function writtenFields(slip: SeedSlip): Record<SlipField, string> {
  const names = [
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
  const fields = Object.fromEntries(names.map((field, i) => [field, String(slip.boxes[String(i + 1)])]));
  return {
    ...fields,
    serial: slip.serial,
    deduction_1: slip.boxes["13"]?.[0] ?? "",
    deduction_2: slip.boxes["13"]?.[1] ?? "",
    signature: slip.signature,
    clerk_initials: slip.clerkInitials,
  } as Record<SlipField, string>;
}

export async function drawSlip(slip: SeedSlip, root: string) {
  const templateBytes = readFileSync(join(root, "template/slip-v1.json"));
  const template = JSON.parse(templateBytes.toString("utf8"));
  const W = 900,
    H = 1180;
  const values = writtenFields(slip);
  const rects = template.fieldRects as Record<SlipField, { x1: number; y1: number; x2: number; y2: number }>;
  const text = (x: number, y: number, value: string, size: number, color = "#343833", max = 0) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}"${max ? ` textLength="${max}" lengthAdjust="spacingAndGlyphs"` : ""}>${xml(value)}</text>`;
  const lines: string[] = [];
  for (const x of template.geometry.table.x)
    lines.push(
      `<path d="M${x * W} ${template.geometry.rows[0] * H} V${template.geometry.rows.at(-1) * H}"/>`,
    );
  for (const y of template.geometry.rows)
    lines.push(
      `<path d="M${template.geometry.table.x[0] * W} ${y * H} H${template.geometry.table.x[3] * W}"/>`,
    );
  const labels = template.boxes
    .map((b: { no: number; label: string }) =>
      text(63, (template.geometry.rows[b.no - 1] + 0.029) * H, `${b.no}  ${b.label}`, 17),
    )
    .join("");
  const fields = Object.entries(values)
    .map(([name, value]) => {
      const box = rects[name as SlipField];
      const size = name === "member_name" ? 23 : 27;
      const width = (box.x2 - box.x1) * W - 20;
      const visible =
        name === "signature" ? (value === "SIGNED" ? "SPECIMEN SIGNATURE" : "SPECIMEN THUMBMARK") : value;
      return text(
        box.x1 * W + 8,
        box.y1 * H + (box.y2 - box.y1) * H * 0.72,
        visible,
        size,
        name === "serial" ? "#9b4436" : "#294c71",
        visible.length * size * 0.58 > width ? width : 0,
      );
    })
    .join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="100%" height="100%" fill="#f1e9d5"/><g font-family="Arial, sans-serif">${text(42, 34, template.printed.coop, 19)}${text(42, 63, template.printed.place, 18)}${text(42, 95, template.printed.title, 19)}${text(42, 137, "code-drawn · synthetic", 21)}<g stroke="#777765" stroke-width="1.5">${lines.join("")}</g>${labels}${fields}${text(55, 948, template.printed.signatureLabel, 17)}${text(585, 948, template.printed.clerkLabel, 17)}${text(140, 1118, template.printed.copyFooter[slip.copy], 22)}${text(105, 1148, template.printed.specimen, 19)}</g></svg>`;
  const bytes = await sharp(Buffer.from(svg)).webp({ lossless: true }).toBuffer();
  const id = `code-${slip.serial}`;
  const file = `slips/code/${id}.webp`;
  const field = (name: SlipField) => draftField(rects[name], values[name], values[name]);
  const source: SlipFixture = {
    slot: "ONLY",
    serial: slip.serial,
    copy: slip.copy,
    quad: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    rect: { x1: 0, y1: 0, x2: 1, y2: 1 },
    fields: Object.fromEntries(SLIP_ROW_FIELDS.map((f) => [f, field(f)])) as SlipFixture["fields"],
    deductions: [field("deduction_1"), field("deduction_2")],
    signature: field("signature"),
    anomalies: [],
    traps: slip.boxes["13"]?.length ? ["DEDUCTION_MARKS"] : [],
    trapChecks: [],
    duplicateOf: null,
  };
  if (slip.marginNote) throw new Error("margin-note slips must retain their checked hero flat");
  const fixture = SlipImageFixture.parse({
    v: 2,
    id,
    group: "replay-code-sources",
    synthetic: true,
    kind: "slip_page",
    template: "slip-v1",
    image: { master: file, display: file, width: W, height: H, sha256: sha256(bytes) },
    slips: [source],
    review: draftReview("Exact code-drawn template geometry; no visual or model-reading claim"),
  });
  return {
    file,
    bytes,
    fixture,
    fixtureFile: `fixtures/code/${id}.json`,
    templateSha256: sha256(templateBytes),
  };
}
