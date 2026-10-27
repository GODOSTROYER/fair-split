/**
 * Splits plain UI copy into words and figures so `<Sentence>` can set figures in the figure face, tabular, with the
 * straight-bar zero, inside Atkinson prose (design §2.3: "Money is always set in FS Sans, even inside Atkinson
 * prose"). A figure is taken whole, unit and all: "US$300", "₱4,028", "30 Okt 2026", "148.0 kg", "1.62%", "09:12",
 * "2026-A", "M-014", "R1", so a date or a weight never changes face halfway through.
 */
export interface Segment {
  text: string;
  /** True for a figure (or an engine value, from `fillSentence`). */
  value: boolean;
}

/** Month abbreviations from `format.date` (S1.10): ceb and fil share theirs, en has its own. */
const MONTHS = "Ene|Peb|Mar|Abr|May|Hun|Hul|Ago|Set|Okt|Nob|Dis|Jan|Feb|Apr|Jun|Jul|Aug|Sep|Oct|Nov|Dec";
/** Letters that can follow a figure in ceb, fil or en copy (no lookbehind or \p{…}, to stay Hermes-safe). */
const L = "A-Za-zÑñ";

const FIGURE_RE = new RegExp(
  [
    "[−-]?US\\$\\d[\\d,]*(?:\\.\\d+)?", // money: US$300, −US$1.09
    "₱\\d[\\d,]*(?:\\.\\d+)?", // the peso estimate
    `\\b\\d{1,2} (?:${MONTHS})(?: \\d{4})?(?![${L}])`, // dates: 30 Okt 2026, 22 Oct
    `\\d[\\d,]*(?:\\.\\d+)? ?(?:kg|%)(?![${L}])`, // kilos and percentages
    `\\b\\d{4}-(?:\\d{2}|[A-Z])(?![${L}\\d])`, // season and card codes: 2026-A, 2026-04
    "\\b[A-Z]-\\d{3}\\b", // member and plot numbers: M-014
    "\\b[A-Z]{1,2}\\d{1,2}\\b", // rule and hold IDs: R1, H3
    "\\d(?:[\\d,.:]*\\d)?", // any other number: times, serials, counts (never a trailing full stop)
  ].join("|"),
  "g",
);

export function figures(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(FIGURE_RE)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: text.slice(last, at), value: false });
    out.push({ text: m[0], value: true });
    last = at + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), value: false });
  return out;
}

/**
 * Splits engine values (from `fillSentence`) down to their figures, so only figures change face: in
 * "0403, 0419, 0436 ug 0467" the "ug" stays prose, and "Lantern Bay" or "Nang Celing" never leave Atkinson.
 */
export function figureRuns(segments: readonly Segment[]): Segment[] {
  return segments.flatMap((s) => (s.value ? figures(s.text) : [s]));
}

/** True when a segment is set in the figure face: a figure that carries a digit. */
export function isFigure(s: Segment): boolean {
  return s.value && /\d/.test(s.text);
}

export interface PesoRun {
  text: string;
  /** True for a ₱ sign, which is set in the platform's own face (neither app face has the glyph, S2.3). */
  peso: boolean;
}

/**
 * Splits already formatted money into runs so a drawn amount can set each ₱ in the system font and every other
 * character in the amount face ("₱7,990.00" → "₱", "7,990.00"). `Txt` does the same for text; SVG amounts need the
 * runs as `TSpan`s. Joining the runs gives back the text exactly.
 */
export function pesoRuns(text: string): PesoRun[] {
  const out: PesoRun[] = [];
  let run = "";
  for (const ch of text) {
    if (ch !== "₱") {
      run += ch;
      continue;
    }
    if (run) out.push({ text: run, peso: false });
    run = "";
    out.push({ text: ch, peso: true });
  }
  if (run) out.push({ text: run, peso: false });
  return out;
}
