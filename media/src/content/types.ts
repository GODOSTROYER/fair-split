import type { CopyColour, SlipField } from "../template/slip-template.js";

/**
 * Where an asset's content came from. Spike assets use provisional values taken from the decision
 * register (section 2) and invented filler; once WS-CORE's seed snapshot lands, every slip, photo and
 * logbook value must be rendered from `packages/seed/snapshot/season-2026A.json` instead (IC-03).
 */
export type ContentSource =
  | { kind: "provisional"; note: string }
  | { kind: "seed"; snapshotSha256: string }
  | { kind: "text-layer"; file: string };

/** Values Jessie writes into boxes 1–13 and the clerk box. An empty string means "left blank". */
export type SlipValues = Record<Exclude<SlipField, "serial" | "signature">, string>;

export type SlipArtifact =
  | {
      /** A dried water stain that washes out characters (slip 0462: gross and net, C4 "6?.80"). */
      kind: "WATER_STAIN";
      /** What the stain leaves readable, per field, with "?" for each washed-out character. */
      visible: Partial<Record<SlipField, string>>;
    }
  | {
      /** Text in the margin, in a different pen, that reads like an instruction (slip 0449, S4.7). */
      kind: "MARGIN_NOTE";
      text: string;
      /** Language of the note, for the eval label's `injection.lang` (S4.8 cells 19–21). */
      lang: "en" | "fil" | "ceb";
      /** The pen, as the prompt describes it. Its ink colour must differ from the clerk's blue ballpoint. */
      pen: string;
      /** Where the note goes; it must overlap no field (C-16: 0449 is a quarantine notice, not a hold). */
      placement: string;
    };

/** A ratified Schedule A rule id (R1–R4 deductions) or NO_MATCH for a line no rule allows (S4.2, AI-6). */
export type DeductionRule = "R1" | "R2" | "R3" | "R4" | "NO_MATCH";

/** Extra eval traps a slip carries beyond what its artifacts and copy colour imply (S4.8). */
export type ExtraTrap = "IMPLAUSIBLE_YIELD";

export interface SlipSpec {
  /** Pre-printed red serial, four digits. */
  serial: string;
  copy: CopyColour;
  values: SlipValues;
  /** How the member signs: a short cursive first name, or a thumbmark (M-002). */
  signature: { mark: "SIGNED"; text: string } | { mark: "THUMBMARK" };
  artifacts: readonly SlipArtifact[];
  /** The rule each written Kaltas line is an instance of (labels' `deductions[].rule`). */
  deductionRules?: Partial<Record<"deduction_1" | "deduction_2", DeductionRule>>;
  extraTraps?: readonly ExtraTrap[];
}

export const PHOTO_POSITIONS = ["TL", "TR", "BL", "BR"] as const;
export type PhotoPosition = (typeof PHOTO_POSITIONS)[number];

export type AssetKind = "slip_photo" | "slip_page" | "rate_card_page" | "logbook_page";

interface AssetBase {
  /** Stable asset id: photos A–L and P01–P54 (IC-11), or a descriptive id for other assets. */
  id: string;
  kind: AssetKind;
  title: string;
  source: ContentSource;
  orientation: "portrait" | "landscape";
  /**
   * The group of images read or replayed together (the S3 hero flats, a spike, later the A–L replay set
   * or the eval test set). Duplicates are keyed by serial and copy colour within one group: the pink 0457
   * is a duplicate of the white 0457 in the same group, while two renders of the same slip in different
   * groups (a flat and a four-slip spike photo) are never marked as duplicates of each other. Not to be
   * confused with an eval label's `set` (`dev` or `test`, S4.8).
   */
  group: string;
}

/** One slip photographed on the bamboo mat (an S3 hero slip, or a by-hand crop source). */
export interface SlipPageAsset extends AssetBase {
  kind: "slip_page";
  slip: SlipSpec;
  /** Set for carbon copies made as Codex edits of an accepted white original (S4.10). */
  editOf?: string;
}

/** Four slips on the mat (photos A–L and P01–P54). */
export interface SlipPhotoAsset extends AssetBase {
  kind: "slip_photo";
  slips: Readonly<Record<PhotoPosition, SlipSpec>>;
}

export interface DocLine {
  text: string;
  style?: "title" | "heading" | "body" | "small" | "signature";
}

/** A typed, signed page (BR 2026-04). Rendered verbatim from its text layer. */
export interface RateCardPageAsset extends AssetBase {
  kind: "rate_card_page";
  page: number;
  pages: number;
  textLayerFile: string;
}

export interface LogbookLine {
  line: number;
  date: string;
  serial: string;
  member_no: string;
  member_name: string;
  net_kg: string;
  grade: string;
  remarks: string;
}

/** A page of the bodega's delivery logbook, the second witness for slips (C4). */
export interface LogbookPageAsset extends AssetBase {
  kind: "logbook_page";
  page: number;
  month: string;
  lines: readonly LogbookLine[];
  /** Printed line slots on the page; lines beyond `lines.length` stay blank. */
  slots: number;
}

export type AssetSpec = SlipPageAsset | SlipPhotoAsset | RateCardPageAsset | LogbookPageAsset;
