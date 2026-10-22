// SMOKE ONLY. Draws slip-template-v1 look-alikes for the gateway/reader smoke test (spike S3
// prerequisite). C-24: eval images come from Codex image_gen only; these images live under
// packages/ai/src/read/smoke/fixtures and are never part of the eval set.
import type { Box, RowField } from "../schema.js";

export const SLIP_W = 1000;
export const SLIP_H = 1414;

export interface SlipSpec {
  serial: string;
  paper: "white" | "pink";
  footer: "ORIGINAL – MEMBER" | "DUPLICATE – OFFICE";
  values: Partial<Record<RowField, string>>;
  deductions: string[];
  signature: "SIGNED" | "THUMBMARK";
  /** Ink effects on single fields. */
  overwrite?: { field: RowField; from: string };
  smudge?: { field: RowField; charIndex: number };
  marginNote?: string;
}

interface Cell {
  field: RowField | "deductions" | "signature" | "clerk_initials";
  label: string;
  box: Box;
}

/** Box layout of the slip, in slip pixels. */
export const CELLS: Cell[] = (() => {
  const L = 40;
  const R = SLIP_W - 40;
  const mid = (L + R) / 2;
  const third = (R - L) / 3;
  const rows: Array<[number, number]> = [
    [250, 370],
    [385, 505],
    [520, 640],
    [655, 775],
    [790, 910],
    [925, 1105],
    [1120, 1240],
  ];
  const r = (i: number) => rows[i] as [number, number];
  const b = (x1: number, i: number, x2: number): Box => ({
    x1: Math.round(x1),
    y1: r(i)[0],
    x2: Math.round(x2),
    y2: r(i)[1],
  });
  return [
    { field: "date", label: "1  Petsa", box: b(L, 0, mid - 10) },
    { field: "member_no", label: "2  Miyembro No.", box: b(mid + 10, 0, R) },
    { field: "member_name", label: "3  Ngalan", box: b(L, 1, R) },
    { field: "plot_no", label: "4  Plot No.", box: b(L, 2, mid - 10) },
    { field: "sacks", label: "5  Sako", box: b(mid + 10, 2, R) },
    { field: "gross_kg", label: "6  Gross (kg)", box: b(L, 3, L + third - 10) },
    { field: "tare_kg", label: "7  Tare (kg)", box: b(L + third, 3, L + 2 * third - 10) },
    { field: "net_kg", label: "8  Net (kg)", box: b(L + 2 * third, 3, R) },
    { field: "mc_pct", label: "9  MC %", box: b(L, 4, L + third - 10) },
    { field: "mc_less_kg", label: "10  Bawas MC (kg)", box: b(L + third, 4, L + 2 * third - 10) },
    { field: "payable_kg", label: "11  Bayranan (kg)", box: b(L + 2 * third, 4, R) },
    { field: "grade", label: "12  Grado", box: b(L, 5, L + third - 10) },
    { field: "deductions", label: "13  Kaltas", box: b(L + third, 5, R) },
    { field: "signature", label: "Pirma / Thumbmark", box: b(L, 6, mid + 80) },
    { field: "clerk_initials", label: "Clerk", box: b(mid + 100, 6, R) },
  ];
})();

export const SERIAL_BOX: Box = { x1: 700, y1: 150, x2: 960, y2: 215 };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const INK = "#1d3fa6";
const HAND = "Ink Free, Segoe Print, Comic Sans MS, cursive";

function hand(x: number, y: number, text: string, size = 56, tilt = -1.2, colour = INK): string {
  return `<text x="${x}" y="${y}" font-family="${HAND}" font-size="${size}" fill="${colour}" transform="rotate(${tilt} ${x} ${y})">${esc(text)}</text>`;
}

/** The slip as an SVG group in slip coordinates (0..SLIP_W, 0..SLIP_H). */
export function slipSvg(spec: SlipSpec): string {
  const paper = spec.paper === "white" ? "#fbf8f0" : "#f4d5dc";
  const parts: string[] = [];
  parts.push(
    `<rect x="0" y="0" width="${SLIP_W}" height="${SLIP_H}" fill="${paper}" stroke="#7a6f62" stroke-width="2"/>`,
  );
  parts.push(
    `<text x="40" y="78" font-family="Arial" font-weight="bold" font-size="22" fill="#2b2b2b">BULAWANON KAKAW GROWERS MULTI-PURPOSE COOPERATIVE · Calinan, Davao City</text>`,
  );
  parts.push(
    `<text x="40" y="118" font-family="Arial" font-size="21" fill="#2b2b2b">RESIBO SA PAGTIMBANG / WEIGH SLIP · Uga nga kakaw</text>`,
  );
  parts.push(
    `<text x="710" y="200" font-family="Arial" font-weight="bold" font-size="40" fill="#b3261e">No. ${esc(spec.serial)}</text>`,
  );
  for (const cell of CELLS) {
    const { box } = cell;
    parts.push(
      `<rect x="${box.x1}" y="${box.y1}" width="${box.x2 - box.x1}" height="${box.y2 - box.y1}" fill="none" stroke="#5c5247" stroke-width="2"/>`,
    );
    parts.push(
      `<text x="${box.x1 + 8}" y="${box.y1 + 24}" font-family="Arial" font-size="19" fill="#5c5247">${esc(cell.label)}</text>`,
    );
    const vx = box.x1 + 24;
    const vy = box.y2 - 26;
    if (cell.field === "deductions") {
      spec.deductions.forEach((line, i) => {
        parts.push(hand(vx, box.y1 + 85 + i * 62, line, 44, -0.8));
      });
    } else if (cell.field === "signature") {
      if (spec.signature === "SIGNED") {
        parts.push(
          `<path d="M ${vx} ${vy} c 30 -60 60 40 90 -10 s 40 -50 70 10 s 50 20 90 -30 c 20 -20 40 30 70 0" fill="none" stroke="${INK}" stroke-width="4"/>`,
        );
      } else {
        const cx = vx + 70;
        const cy = vy - 30;
        parts.push(`<ellipse cx="${cx}" cy="${cy}" rx="38" ry="48" fill="#6b4e8a" fill-opacity="0.35"/>`);
        for (let k = 1; k <= 5; k++) {
          parts.push(
            `<ellipse cx="${cx}" cy="${cy}" rx="${k * 7}" ry="${k * 9}" fill="none" stroke="#4b3466" stroke-opacity="0.6" stroke-width="2"/>`,
          );
        }
      }
    } else {
      const value = spec.values[cell.field];
      if (value === undefined || value === "") continue;
      if (spec.overwrite?.field === cell.field) {
        parts.push(hand(vx, vy, spec.overwrite.from));
        const w = 30 * spec.overwrite.from.length;
        parts.push(
          `<line x1="${vx - 6}" y1="${vy - 18}" x2="${vx + w}" y2="${vy - 22}" stroke="${INK}" stroke-width="5"/>`,
        );
        parts.push(hand(vx + w + 36, vy - 4, value));
      } else {
        parts.push(hand(vx, vy, value));
      }
    }
  }
  parts.push(
    `<text x="40" y="1300" font-family="Arial" font-weight="bold" font-size="24" fill="#2b2b2b">${esc(spec.footer)}</text>`,
  );
  parts.push(
    `<text x="40" y="1352" font-family="Arial" font-size="18" fill="#6d6d6d">SPECIMEN · SYNTHETIC DEMO PAD · NOT A RECORD</text>`,
  );
  if (spec.marginNote) {
    parts.push(
      `<text x="26" y="1240" font-family="Segoe Print, Comic Sans MS, cursive" font-size="22" fill="#111111" transform="rotate(-90 26 1240)">${esc(spec.marginNote)}</text>`,
    );
  }
  return parts.join("\n");
}

/** The cell of a field, in slip pixels. */
export function cellOf(field: RowField | "deductions" | "signature"): Box {
  if (field === "serial") return SERIAL_BOX;
  const cell = CELLS.find((c) => c.field === field);
  if (!cell) throw new Error(`no cell for ${field}`);
  return cell.box;
}
