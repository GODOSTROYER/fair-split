import { BR_PAGES, SPECIMEN_DOC } from "../content/br-2026-04.js";
import type {
  AssetSpec,
  DocLine,
  LogbookPageAsset,
  PhotoPosition,
  RateCardPageAsset,
  SlipPageAsset,
  SlipPhotoAsset,
  SlipSpec,
} from "../content/types.js";
import { PHOTO_POSITIONS } from "../content/types.js";
import {
  COPY_PAPER,
  printedFormSpec,
  SLIP_BOXES,
  SLIP_PRINTED,
  type SlipField,
} from "../template/slip-template.js";

/** Prompt version; bump when the skeleton changes so manifests show which prompts made which images. */
export const PROMPT_VERSION = "p2";

const POSITION_NAMES: Record<PhotoPosition, string> = {
  TL: "Top-left",
  TR: "Top-right",
  BL: "Bottom-left",
  BR: "Bottom-right",
};

/** Preamble that turns one `codex exec` into exactly one built-in image_gen call (AI-11). */
export function execPreamble(mode: "generate" | "edit"): string {
  const action =
    mode === "generate"
      ? "Call the built-in image_gen tool exactly once with the image description below (use it as the prompt, verbatim apart from formatting)."
      : "Image 1 (attached) is the edit target. Call the built-in image_gen tool exactly once to edit Image 1 as described below (use the description as the edit prompt, verbatim apart from formatting).";
  return [
    `You are generating one synthetic evidence image for a demo. ${action} Do not run shell commands, do not create, copy or move any files, and do not call image_gen more than once. After the image is generated, reply with the single word DONE.`,
  ].join("\n");
}

const AVOID =
  "Avoid: logos, brand names, real seals, watermarks, hands, people, pens on the paper, blur, heavy shadows, glare.";

/** What each field should visibly read on the image: the value, or the stain pattern with "?". */
export function expectedVisible(slip: SlipSpec): Record<SlipField, string> {
  const out = {
    serial: slip.serial,
    ...slip.values,
    signature: slip.signature.mark,
  } as Record<SlipField, string>;
  for (const a of slip.artifacts) {
    if (a.kind === "WATER_STAIN") for (const [f, v] of Object.entries(a.visible)) out[f as SlipField] = v;
  }
  return out;
}

function quote(v: string): string {
  return v === "" ? "leave blank" : `"${v}"`;
}

/** The labelled value lines for one slip ("Row 6 Gross (kg): "38.75""). */
export function slipValueLines(slip: SlipSpec): string[] {
  const v = slip.values;
  const lines: string[] = [];
  for (const box of SLIP_BOXES) {
    if (box.lines === 1) {
      const field = box.fields[0] as keyof typeof v;
      lines.push(`- Row ${box.no} ${box.label}: ${quote(v[field])}`);
    } else if (v.deduction_1 === "" && v.deduction_2 === "") {
      lines.push(`- Row ${box.no} ${box.label}: leave both lines completely blank`);
    } else {
      lines.push(
        `- Row ${box.no} ${box.label}, first line: ${quote(v.deduction_1)}; second line: ${quote(v.deduction_2)}`,
      );
    }
  }
  const sig =
    slip.signature.mark === "SIGNED"
      ? `a short cursive signature reading "${slip.signature.text}" in blue ballpoint`
      : "one inked thumbprint in purple stamp-pad ink, no writing";
  lines.push(`- ${SLIP_PRINTED.signatureLabel} box: ${sig}`);
  lines.push(`- ${SLIP_PRINTED.clerkLabel} box: ${quote(v.clerk_initials)}`);
  return lines;
}

function artifactLines(slip: SlipSpec): string[] {
  const out: string[] = [];
  for (const a of slip.artifacts) {
    if (a.kind === "WATER_STAIN") {
      const fields = Object.keys(a.visible)
        .map((f) => SLIP_BOXES.find((b) => b.fields.includes(f as SlipField)))
        .filter((b) => b !== undefined)
        .map((b) => `row ${b.no} (${b.label})`);
      // Never quote the "?" pattern itself: on 22 Oct Codex drew a literal "?" (or a "7") where the
      // pattern had one. Name the washed-out characters by position instead, and forbid substitutes.
      const washed = Object.entries(a.visible)
        .map(([f, vis]) => washedOutPhrase(slip.values[f as keyof typeof slip.values], vis))
        .join("; and ");
      out.push(
        `- One dried water stain on this slip only: a pale brownish tide-mark ring about the size of a coin over the writing boxes of ${fields.join(" and ")}. Inside the stain the blue ink has bled and spread into a soft pale-blue smudge: ${washed}. Draw each washed-out character only as a formless pale-blue blur with no recognisable shape; never draw a question mark, another digit or any other symbol in its place. The other characters of those values, and every other value on the slip, stay crisp and readable.`,
      );
    } else {
      out.push(
        `- One note written on this slip by a different person, ${a.placement}, in ${a.pen} (not the clerk's blue ballpoint), reading exactly: "${a.text}". The note stays outside every printed box and does not touch or overlap any printed text, any box or any of the clerk's handwriting; render it legibly, character for character.`,
      );
    }
  }
  return out;
}

/** The constraints line; a slip with a margin note allows exactly that one extra piece of handwriting. */
function slipConstraints(slip: SlipSpec): string {
  const extra = slip.artifacts.some((a) => a.kind === "MARGIN_NOTE")
    ? "no other handwriting anywhere apart from the one note described under Artifacts"
    : "no other handwriting anywhere";
  return `Constraints: render every quoted value exactly; ${extra}; no extra digits, ticks or corrections; all text legible; the whole slip in frame.`;
}

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
];

/** "in "64.80" the second character, the "4", is washed out" for value "64.80" and pattern "6?.80". */
export function washedOutPhrase(value: string, visible: string): string {
  const positions = [...visible].flatMap((ch, i) => (ch === "?" ? [i] : []));
  if (positions.length === 0 || visible.length !== value.length) {
    throw new Error(`stain pattern "${visible}" must mark washed-out characters of "${value}" with "?"`);
  }
  const parts = positions.map((i) => `the ${ORDINALS[i] ?? `${i + 1}th`} character, the "${value[i]}"`);
  return `in "${value}" ${parts.join(" and ")} ${positions.length === 1 ? "is" : "are"} washed out`;
}

const HAND =
  "Handwriting: blue ballpoint pen, neat upright BLOCK CAPITALS by one clerk (Jessie), each value written once inside its own row's writing box, digits clear with a visible decimal point. Render every value exactly, character for character.";

export function renderSlipPage(asset: SlipPageAsset): string {
  const s = asset.slip;
  if (asset.editOf) return renderCarbonCopyEdit(asset);
  return [
    execPreamble("generate"),
    "",
    "Use case: photorealistic-natural",
    "Asset type: synthetic evidence photo for a software demo (clearly a specimen form)",
    "Primary request: a phone photo, taken from above, of ONE filled-in paper weigh slip lying flat on a woven bamboo mat.",
    "Composition/framing: portrait image; the slip fills about 80% of the frame, nearly square to the camera (tilted at most 3 degrees), all four edges of the slip fully visible with a margin of bamboo mat around it; a few dried brown cacao beans at one edge of the frame, not touching the slip.",
    "Lighting/mood: soft warm daylight from the left, faint natural shadow under the paper edge, sharp focus everywhere, no glare.",
    `Materials/textures: ${COPY_PAPER[s.copy]}, slightly wavy; printed text in black ink; handwriting in blue ballpoint pen.`,
    "",
    "Printed form (the same pre-printed template on every slip; render the printed text exactly):",
    ...printedFormSpec(s.copy).map((l) => `- ${l}`),
    `- This slip's red serial: "${SLIP_PRINTED.serialPrefix} ${s.serial}"`,
    "",
    HAND,
    ...slipValueLines(s),
    ...(s.artifacts.length ? ["", "Artifacts (only these):", ...artifactLines(s)] : []),
    "",
    slipConstraints(s),
    AVOID,
  ].join("\n");
}

/** Pink or yellow copies are Codex edits of the accepted white original (S4.10). */
export function renderCarbonCopyEdit(asset: SlipPageAsset): string {
  const s = asset.slip;
  const colour = s.copy === "PINK_DUPLICATE" ? "pink" : "pale-yellow";
  return [
    execPreamble("edit"),
    "",
    "Use case: precise-object-edit",
    `Primary request: turn Image 1 into the same slip's ${colour} carbon copy, photographed the same way: ${COPY_PAPER[s.copy]}, with fainter, slightly softer carbon-transferred strokes in the same blue, and identical characters in identical positions.`,
    `Change only: the paper colour to ${colour}; the handwriting and the signature to fainter carbon strokes; the bold footer line from "${SLIP_PRINTED.copyFooter.WHITE_ORIGINAL}" to "${SLIP_PRINTED.copyFooter[s.copy]}".`,
    `Keep unchanged: every printed label, the red serial "${SLIP_PRINTED.serialPrefix} ${s.serial}", every handwritten character and digit exactly as in Image 1, the bamboo mat, the cacao beans, framing, perspective and lighting.`,
    "",
    "The handwritten values must still read exactly:",
    ...slipValueLines(s),
    "",
    "Constraints: no new handwriting, no missing characters, no extra marks; the whole slip in frame.",
    AVOID,
  ].join("\n");
}

export function renderSlipPhoto(asset: SlipPhotoAsset): string {
  const out = [
    execPreamble("generate"),
    "",
    "Use case: photorealistic-natural",
    "Asset type: synthetic evidence photo for a software demo (clearly specimen forms)",
    "Primary request: a phone photo, taken from above at a slight angle, of FOUR filled-in paper weigh slips lying flat on a woven bamboo mat, arranged in a 2 x 2 grid (top-left, top-right, bottom-left, bottom-right), not overlapping, each slip tilted at most 4 degrees.",
    "Composition/framing: landscape image; the four slips together fill about 90% of the frame; all edges of all four slips fully visible with a thin margin of bamboo mat around and between them; a few dried brown cacao beans at one edge of the frame, not touching any slip.",
    "Lighting/mood: soft warm daylight from the left, faint natural shadow under the paper edges, sharp focus everywhere, no glare.",
    "Materials/textures: thin carbonless pad paper (colour per slip below), slightly wavy; printed text in black ink; handwriting in blue ballpoint pen.",
    "",
    "Printed form (the same pre-printed template on all four slips; render the printed text exactly):",
    ...printedFormSpec("PER_SLIP").map((l) => `- ${l}`),
    "",
    HAND,
  ];
  for (const pos of PHOTO_POSITIONS) {
    const s = asset.slips[pos];
    out.push(
      "",
      `${POSITION_NAMES[pos]} slip, red serial "${SLIP_PRINTED.serialPrefix} ${s.serial}", ${COPY_PAPER[s.copy]}, footer "${SLIP_PRINTED.copyFooter[s.copy]}":`,
      ...slipValueLines(s),
      ...artifactLines(s),
    );
  }
  out.push(
    "",
    "Constraints: render every quoted value exactly; no other handwriting anywhere; no extra digits, ticks or corrections; all four slips fully in frame and legible.",
    AVOID,
  );
  return out.join("\n");
}

function docLine(l: DocLine): string {
  switch (l.style) {
    case "title":
      return `[bold, larger] "${l.text}"`;
    case "heading":
      return `[bold] "${l.text}"`;
    case "small":
      return `[small] "${l.text}"`;
    case "signature":
      return `[a handwritten signature in blue ink above the typed name] "${l.text}"`;
    default:
      return `"${l.text}"`;
  }
}

export function renderRateCardPage(asset: RateCardPageAsset): string {
  const lines = BR_PAGES[asset.page - 1];
  if (!lines) throw new Error(`BR 2026-04 has no page ${asset.page}`);
  return [
    execPreamble("generate"),
    "",
    "Use case: photorealistic-natural",
    "Asset type: synthetic evidence scan for a software demo (clearly a specimen document)",
    `Primary request: a flat document scan of page ${asset.page} of ${asset.pages} of a typed, signed board resolution of a small farmers' cooperative in the Philippines, printed on plain white A4 paper.`,
    "Composition/framing: portrait image; the whole page fills the frame edge to edge, straight, evenly lit like a flatbed scan; generous margins; single column of left-aligned typed text in a plain office serif typeface, black ink.",
    "Materials/textures: slightly off-white office paper with faint scanner texture; the two signatures are in blue ballpoint ink.",
    "",
    "Text (verbatim, in this order, top to bottom; render every word, digit and symbol exactly; nothing else on the page):",
    ...lines.map((l) => `- ${docLine(l)}`),
    "",
    'Layout notes: the "CERTIFIED CORRECT:" block (signature, name, "Secretary") sits on the left and the "ATTESTED:" block (signature, name, "Chairperson") on the right, side by side near the bottom; the page number and the specimen line are the last two lines, small and centred.',
    `Constraints: render every quoted line exactly, including "₱", "%", "±" and "US$"; no extra text, no stamps, no letterhead logo, no seal; keep "${SPECIMEN_DOC}" visible.`,
    "Avoid: logos, real seals, watermarks, hands, shadows, curled pages, blur.",
  ].join("\n");
}

export function renderLogbookPage(asset: LogbookPageAsset): string {
  const cols = ["Line", "Petsa", "Slip No.", "Miyembro No.", "Ngalan", "Net (kg)", "Grado", "Puna / Remarks"];
  const rows = asset.lines.map(
    (l) =>
      `- Line ${l.line}: Petsa "${l.date}", Slip No. "${l.serial}", Miyembro No. "${l.member_no}", Ngalan "${l.member_name}", Net (kg) "${l.net_kg}", Grado "${l.grade}", Puna / Remarks ${l.remarks ? `"${l.remarks}"` : "blank"}`,
  );
  return [
    execPreamble("generate"),
    "",
    "Use case: photorealistic-natural",
    "Asset type: synthetic evidence photo for a software demo (clearly a specimen ledger page)",
    `Primary request: a phone photo, taken from straight above, of one page of a hardbound delivery logbook (a ruled columnar ledger) lying open on a wooden desk; page ${asset.page} fills about 85% of the frame.`,
    "Composition/framing: portrait image; the whole page visible with its four corners, nearly square to the camera; a sliver of the facing page and the binding at one side.",
    "Lighting/mood: soft even daylight, sharp focus everywhere, no glare.",
    "Materials/textures: cream ruled ledger paper with faint green column rules; printed headings in black; handwriting in blue ballpoint.",
    "",
    "Printed on the page:",
    `- Top line, bold: "DELIVERY LOGBOOK · BULAWANON KAKAW GROWERS MPC"`,
    `- Top-right corner: "Page ${asset.page}"`,
    `- Column headings, left to right: ${cols.map((c) => `"${c}"`).join(", ")}`,
    `- ${asset.slots} ruled lines; the Line column has the printed numbers 1 to ${asset.slots}`,
    `- Bottom line, small: "SPECIMEN · SYNTHETIC DEMO LOGBOOK · NOT A RECORD"`,
    "",
    `Handwritten (blue ballpoint, neat upright BLOCK CAPITALS by the clerk Jessie): at the top left, "${asset.month}"; then lines 1 to ${asset.lines.length}, one delivery per line; lines ${asset.lines.length + 1} to ${asset.slots} stay blank. Render every value exactly:`,
    ...rows,
    "",
    "Constraints: render every quoted value exactly, in its own line and column; no other handwriting; no extra digits, ticks or corrections; all text legible.",
    "Avoid: logos, brand names, real seals, watermarks, hands, people, pens on the page, blur, heavy shadows, glare.",
  ].join("\n");
}

export function renderPrompt(asset: AssetSpec): string {
  switch (asset.kind) {
    case "slip_page":
      return renderSlipPage(asset);
    case "slip_photo":
      return renderSlipPhoto(asset);
    case "rate_card_page":
      return renderRateCardPage(asset);
    case "logbook_page":
      return renderLogbookPage(asset);
  }
}

/** Every literal the image must show, used by tests and by the review checklist. */
export function requiredLiterals(asset: AssetSpec): string[] {
  switch (asset.kind) {
    case "slip_page":
      return slipLiterals(asset.slip);
    case "slip_photo":
      return PHOTO_POSITIONS.flatMap((p) => slipLiterals(asset.slips[p]));
    case "rate_card_page":
      return (BR_PAGES[asset.page - 1] ?? []).map((l) => l.text);
    case "logbook_page":
      return asset.lines.flatMap((l) =>
        [l.date, l.serial, l.member_no, l.member_name, l.net_kg, l.grade, l.remarks].filter((x) => x !== ""),
      );
  }
}

function slipLiterals(s: SlipSpec): string[] {
  return [
    `${SLIP_PRINTED.serialPrefix} ${s.serial}`,
    ...Object.values(s.values).filter((x) => x !== ""),
    ...s.artifacts.flatMap((a) => (a.kind === "MARGIN_NOTE" ? [a.text] : [])),
  ];
}
