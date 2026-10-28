// SMOKE ONLY. A code-drawn, one-page stub of a board resolution's Schedule A, used once to check the
// AI-5 rate-card reader against the live API (and the AI-6 classifier against its terms). C-24: eval
// images come from Codex image_gen only; this page lives under packages/ai/src/read/smoke/fixtures
// and is never part of the eval set or the seed. The wording of R1, R2, R5 and the closed list is
// S4.3's Schedule A, verbatim; the resolution number marks it as a stub.
import type { DeductionTerm } from "../../classify/classify.js";
import { inputShaOf } from "../../gateway/index.js";
import type { TextLayer } from "../../ratecard/schema.js";

export const RATECARD_STUB_ID = "smoke-ratecard";
export const RATECARD_STUB_FILE = `${RATECARD_STUB_ID}.png`;
export const PAGE_W = 1240;
export const PAGE_H = 1754;

/** Printed lines, top to bottom; a rule's sentence may wrap over several lines. */
export const STUB_HEADER = [
  "BULAWANON KAKAW GROWERS MULTI-PURPOSE COOPERATIVE",
  "Calinan, Davao City",
  "BOARD RESOLUTION No. BR 2026-99 (SMOKE STUB)",
  "Ratified on 14 March 2026",
  "SCHEDULE A: Season 2026-A rate card (excerpt)",
] as const;

export const STUB_RULES: ReadonlyArray<{ id: string; text: string }> = [
  {
    id: "R1",
    text: "Capital build-up (CBU): 5% of the member's quality bonus, until the member's paid-up CBU reaches ₱5,000.",
  },
  {
    id: "R2",
    text: "Hauling: ₱1.50 per kilo of net weight for deliveries collected at a purok pickup point.",
  },
  {
    id: "R5",
    text: "The Chairperson shall co-sign any payout batch over US$300, any member line over US$150, and any override of a hold.",
  },
  {
    id: "CLOSED",
    text: "No deduction other than those in this Schedule shall be applied to any member payout. This Schedule shall not be amended during Season 2026-A.",
  },
];

export const STUB_SIGNATORIES = [
  { role: "SECRETARY", label: "Secretary", name: "Marites Dagohoy" },
  { role: "CHAIR", label: "Chairperson", name: "Ernesto Cabahug" },
] as const;

/** Handwriting added to the printed page: S4.3 says it never becomes a term. */
export const STUB_AMENDMENT = "R7 Iba pa P150";
export const STUB_FOOTER = "SPECIMEN · SYNTHETIC SMOKE PAGE · NOT A RECORD";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Greedy word wrap at `max` characters (no hyphenation, so a quote spans lines with spaces). */
export function wrap(text: string, max = 74): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(" ")) {
    if (line && line.length + 1 + word.length > max) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** The page as SVG: printed text in Arial, the amendment in a handwriting face, two signatures. */
export function ratecardStubSvg(): string {
  const parts: string[] = [`<rect width="100%" height="100%" fill="#fdfcf7"/>`];
  const text = (x: number, y: number, s: string, size: number, weight = "normal") =>
    parts.push(
      `<text x="${x}" y="${y}" font-family="Arial" font-size="${size}" font-weight="${weight}" fill="#222222">${esc(s)}</text>`,
    );
  const [org, place, resolution, ratified, schedule] = STUB_HEADER;
  text(90, 130, org, 32, "bold");
  text(90, 175, place, 26);
  text(90, 260, resolution, 30, "bold");
  text(90, 305, ratified, 26);
  text(90, 395, schedule, 28, "bold");
  let y = 470;
  for (const rule of STUB_RULES) {
    text(90, y, rule.id === "CLOSED" ? "Closed list" : rule.id, 26, "bold");
    for (const line of wrap(rule.text)) {
      text(260, y, line, 26);
      y += 40;
    }
    y += 34;
  }
  // The handwritten amendment, in the margin beside the schedule, in another pen.
  parts.push(
    `<text x="760" y="${y + 10}" font-family="Ink Free, Segoe Print, Comic Sans MS, cursive" font-size="40" fill="#1d3fa6" transform="rotate(-4 760 ${y + 10})">${esc(STUB_AMENDMENT)}</text>`,
  );
  const sigY = 1460;
  STUB_SIGNATORIES.forEach((s, i) => {
    const x = 120 + i * 560;
    parts.push(
      `<path d="M ${x + 20} ${sigY - 30} c 40 -70 80 50 120 -15 s 50 -60 90 10 s 60 25 110 -35" fill="none" stroke="#1d3fa6" stroke-width="4"/>`,
    );
    parts.push(
      `<line x1="${x}" y1="${sigY}" x2="${x + 440}" y2="${sigY}" stroke="#222222" stroke-width="2"/>`,
    );
    text(x, sigY + 40, s.name, 26);
    text(x, sigY + 78, s.label, 24);
  });
  text(90, 1700, STUB_FOOTER, 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}">\n${parts.join("\n")}\n</svg>`;
}

/** The human-verified text layer stand-in: every printed line, in order (S4.3 sidecar shape). */
export function ratecardStubTextLayer(): TextLayer {
  const lines = [
    ...STUB_HEADER,
    ...STUB_RULES.flatMap((r) => [r.id === "CLOSED" ? "Closed list" : r.id, r.text]),
    ...STUB_SIGNATORIES.flatMap((s) => [s.name, s.label]),
    STUB_FOOTER,
  ];
  return {
    document: RATECARD_STUB_ID,
    pages: [{ page: 1, text: lines.join("\n") }],
    verified_by: "code (drawn from these strings)",
  };
}

/** The stub's ratified deduction terms as the classifier sees them (typed values, as WS-CORE ratifies). */
export const STUB_DEDUCTION_TERMS: readonly DeductionTerm[] = [
  {
    rule_id: "R1",
    label: "Capital build-up (CBU)",
    quote: STUB_RULES[0]?.text ?? "",
    basis: "PCT_OF_BONUS",
    value: { unit: "bp", value: 500 },
    cap: { unit: "centavos", value: 500_000 },
    requires_document: "NONE",
  },
  {
    rule_id: "R2",
    label: "Hauling",
    quote: STUB_RULES[1]?.text ?? "",
    basis: "PER_NET_KG",
    value: { unit: "centavos_per_kg", value: 150 },
    cap: null,
    requires_document: "NONE",
  },
];

/** A stand-in for the ratified card's rc8 (WS-CORE hashes the real card). */
export const STUB_RC8 = inputShaOf(STUB_DEDUCTION_TERMS).slice(0, 8);
