import type {
  AssetSpec,
  ContentSource,
  LogbookLine,
  LogbookPageAsset,
  RateCardPageAsset,
  SlipPageAsset,
  SlipPhotoAsset,
  SlipSpec,
  SlipValues,
} from "./types.js";

/**
 * Spike content for 22–23 Oct, before WS-CORE's seed snapshot exists. Figures the register fixes are used
 * as written (serials, members, slip 0403 = 38.45 kg, slip 0457 = 42.0 kg, slip 0458's hauling ₱91.20 on
 * 60.80 kg and its multa ₱200, slip 0462 = 64.80 gross − 0.30 tare = 64.50 net, logbook page 14 line 7).
 * Everything else (dates, plots, moisture, the other logbook lines) is provisional filler, and these
 * assets are regenerated from the seed once it lands.
 */
const PROVISIONAL: ContentSource = {
  kind: "provisional",
  note: "Spike content from register section 2 plus filler; regenerate from the seed snapshot (IC-03).",
};

function values(v: Partial<SlipValues> & Pick<SlipValues, "date" | "member_no" | "member_name">): SlipValues {
  return {
    plot_no: "",
    sacks: "1 PP",
    gross_kg: "",
    tare_kg: "0.30",
    net_kg: "",
    mc_pct: "",
    mc_less_kg: "0.00",
    payable_kg: "",
    grade: "G1",
    deduction_1: "",
    deduction_2: "",
    clerk_initials: "JD",
    ...v,
  };
}

export const SLIP_0403: SlipSpec = {
  serial: "0403",
  copy: "WHITE_ORIGINAL",
  values: values({
    date: "05/21/2026",
    member_no: "M-014",
    member_name: "CONSOLACION BACUS",
    plot_no: "P-014-A",
    gross_kg: "38.75",
    net_kg: "38.45",
    mc_pct: "6.8",
    payable_kg: "38.45",
  }),
  signature: { mark: "SIGNED", text: "Consolacion" },
  artifacts: [],
};

export const SLIP_0457: SlipSpec = {
  serial: "0457",
  copy: "WHITE_ORIGINAL",
  values: values({
    date: "07/14/2026",
    member_no: "M-007",
    member_name: "DIONISIO LAPINIG",
    plot_no: "P-007-A",
    gross_kg: "42.30",
    net_kg: "42.00",
    mc_pct: "7.0",
    payable_kg: "42.00",
  }),
  signature: { mark: "SIGNED", text: "Dionisio" },
  artifacts: [],
};

export const SLIP_0457_PINK: SlipSpec = { ...SLIP_0457, copy: "PINK_DUPLICATE" };

export const SLIP_0458: SlipSpec = {
  serial: "0458",
  copy: "WHITE_ORIGINAL",
  values: values({
    date: "07/14/2026",
    member_no: "M-018",
    member_name: "TEODORO PACAÑA",
    plot_no: "P-018-A",
    gross_kg: "61.10",
    net_kg: "60.80",
    mc_pct: "6.9",
    payable_kg: "60.80",
    deduction_1: "HAULING ₱91.20",
    deduction_2: "MULTA (ABSENT GA) ₱200",
  }),
  signature: { mark: "SIGNED", text: "Teodoro" },
  artifacts: [],
};

export const SLIP_0462: SlipSpec = {
  serial: "0462",
  copy: "WHITE_ORIGINAL",
  values: values({
    date: "07/15/2026",
    member_no: "M-060",
    member_name: "ARNEL SUMAMPAO",
    plot_no: "P-060-A",
    gross_kg: "64.80",
    net_kg: "64.50",
    mc_pct: "7.0",
    payable_kg: "64.50",
  }),
  signature: { mark: "SIGNED", text: "Arnel" },
  artifacts: [{ kind: "WATER_STAIN", visible: { gross_kg: "6?.80", net_kg: "6?.50" } }],
};

function slipPage(id: string, title: string, slip: SlipSpec, editOf?: string): SlipPageAsset {
  return {
    id,
    kind: "slip_page",
    title,
    source: PROVISIONAL,
    orientation: "portrait",
    slip,
    ...(editOf ? { editOf } : {}),
  };
}

export const SPIKE_PHOTO_4UP: SlipPhotoAsset = {
  id: "spike-4up",
  kind: "slip_photo",
  title: "Spike: four hero slips on the mat (0403, 0457, 0458, 0462)",
  source: PROVISIONAL,
  orientation: "landscape",
  slips: { TL: SLIP_0403, TR: SLIP_0457, BL: SLIP_0458, BR: SLIP_0462 },
};

const LOGBOOK_P14_LINES: readonly LogbookLine[] = [
  {
    line: 1,
    date: "07/14",
    serial: "0456",
    member_no: "M-039",
    member_name: "J. RIPALDA",
    net_kg: "35.20",
    grade: "G1",
    remarks: "",
  },
  {
    line: 2,
    date: "07/14",
    serial: "0457",
    member_no: "M-007",
    member_name: "D. LAPINIG",
    net_kg: "42.00",
    grade: "G1",
    remarks: "",
  },
  {
    line: 3,
    date: "07/14",
    serial: "0458",
    member_no: "M-018",
    member_name: "T. PACAÑA",
    net_kg: "60.80",
    grade: "G1",
    remarks: "MULTA GA ₱200",
  },
  {
    line: 4,
    date: "07/14",
    serial: "0459",
    member_no: "M-053",
    member_name: "M. PONCE",
    net_kg: "51.70",
    grade: "G1",
    remarks: "",
  },
  {
    line: 5,
    date: "07/15",
    serial: "0460",
    member_no: "M-022",
    member_name: "P. OMPAD",
    net_kg: "30.40",
    grade: "G2",
    remarks: "",
  },
  {
    line: 6,
    date: "07/15",
    serial: "0461",
    member_no: "M-002",
    member_name: "F. YBAÑEZ",
    net_kg: "24.60",
    grade: "G1",
    remarks: "",
  },
  {
    line: 7,
    date: "07/15",
    serial: "0462",
    member_no: "M-060",
    member_name: "A. SUMAMPAO",
    net_kg: "64.50",
    grade: "G1",
    remarks: "",
  },
  {
    line: 8,
    date: "07/15",
    serial: "0463",
    member_no: "M-031",
    member_name: "R. JUMAWAN",
    net_kg: "28.90",
    grade: "G1",
    remarks: "",
  },
  {
    line: 9,
    date: "07/16",
    serial: "0464",
    member_no: "M-053",
    member_name: "M. PONCE",
    net_kg: "48.30",
    grade: "G2",
    remarks: "",
  },
  {
    line: 10,
    date: "07/16",
    serial: "0465",
    member_no: "M-039",
    member_name: "J. RIPALDA",
    net_kg: "26.10",
    grade: "G1",
    remarks: "",
  },
];

export const LOGBOOK_P14: LogbookPageAsset = {
  id: "logbook-p14",
  kind: "logbook_page",
  title: "Logbook page 14 (July 2026); line 7 is slip 0462, 64.50 net",
  source: PROVISIONAL,
  orientation: "portrait",
  page: 14,
  month: "JULY 2026",
  lines: LOGBOOK_P14_LINES,
  slots: 12,
};

function brPage(page: number): RateCardPageAsset {
  return {
    id: `br-2026-04-p${page}`,
    kind: "rate_card_page",
    title: `BR 2026-04, page ${page} of 2${page === 2 ? " (Schedule A)" : ""}`,
    source: { kind: "text-layer", file: "docs/BR-2026-04.text.json" },
    orientation: "portrait",
    page,
    pages: 2,
    textLayerFile: "docs/BR-2026-04.text.json",
  };
}

/** Every asset this spike generates, keyed by id. */
export const SPIKE_ASSETS: readonly AssetSpec[] = [
  slipPage("spike-0403", "Spike: slip 0403, M-014 (white original)", SLIP_0403),
  slipPage("spike-0457-white", "Spike: slip 0457, M-007 (white original)", SLIP_0457),
  slipPage(
    "spike-0457-pink",
    "Spike: slip 0457, M-007 (pink duplicate, Codex edit)",
    SLIP_0457_PINK,
    "spike-0457-white",
  ),
  slipPage("spike-0458", "Spike: slip 0458, M-018 (hauling and the unruled multa)", SLIP_0458),
  slipPage("spike-0462", "Spike: slip 0462, M-060 (water stain over gross and net)", SLIP_0462),
  SPIKE_PHOTO_4UP,
  brPage(1),
  brPage(2),
  LOGBOOK_P14,
];

export function findAsset(id: string, assets: readonly AssetSpec[] = SPIKE_ASSETS): AssetSpec {
  const a = assets.find((x) => x.id === id);
  if (!a) throw new Error(`Unknown asset "${id}". Known: ${assets.map((x) => x.id).join(", ")}`);
  return a;
}
