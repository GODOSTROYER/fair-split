import type { DocLine } from "./types.js";

/**
 * BR 2026-04, the Board resolution that ratifies the Season 2026-A rate card (register section 2,
 * design direction section 0, S4.3). This module is the source of the printed pages and of their text
 * layer sidecar, `media/docs/BR-2026-04.text.json`, which stands in for a scanner's OCR layer.
 *
 * Schedule A clause quotes are verbatim from S4.3 ("WS-MEDIA prints it verbatim"); the register's values
 * are unchanged. Cebuano headings are pending native review (OD-2). The GA meeting date is this
 * workstream's choice (the register only says the resolution cites the GA approval).
 */

export const BR_RESOLUTION_NO = "2026-04";
export const BR_RATIFIED_ON = "2026-03-14";
export const BR_GA_MEETING = "28 February 2026";

export interface ScheduleClause {
  /** As printed: R0..R6, or CLOSED for the closed-list clause. */
  ruleId: string;
  /** Printed heading (Cebuano, with an English gloss in brackets where useful). */
  heading: string;
  /** Verbatim clause text (S4.3); every term's source quote must be a substring of this. */
  quote: string;
}

export const SCHEDULE_A: readonly ScheduleClause[] = [
  {
    ruleId: "R0",
    heading: "R0  Premium ug bonus (Premium and quality bonus)",
    quote:
      "The premium paid by the buyer shall be shared among members in proportion to verified kilos delivered. No deduction of any kind shall be made from the premium. The quality bonus shall be shared in proportion to verified Grade 1 kilos.",
  },
  {
    ruleId: "R1",
    heading: "R1  CBU (Capital build-up)",
    quote:
      "Capital build-up (CBU): 5% of the member's quality bonus, until the member's paid-up CBU reaches ₱5,000.",
  },
  {
    ruleId: "R2",
    heading: "R2  Hakot (Hauling)",
    quote: "Hauling: ₱1.50 per kilo of net weight for deliveries collected at a purok pickup point.",
  },
  {
    ruleId: "R3",
    heading: "R3  Utang (Loan)",
    quote:
      "Loan repayment: only with a signed Authority to Deduct on file, and not more than 50% of the member's quality bonus.",
  },
  {
    ruleId: "R4",
    heading: "R4  Bale (Cash advance)",
    quote:
      "Cash advance: only against a numbered voucher, and not more than 30% of the member's quality bonus.",
  },
  {
    ruleId: "R5",
    heading: "R5  Pirma sa Chairperson (Co-signature)",
    quote:
      "The Chairperson shall co-sign any payout batch over US$300, any member line over US$150, and any override of a hold.",
  },
  {
    ruleId: "R6",
    heading: "R6  Mga utlanan (Limits)",
    quote:
      "Verified kilos must agree with kilos shipped within ±2.0%. A member's season kilos may not exceed 1.6 kg per registered tree. Any reading below 0.85 confidence shall be confirmed by a person.",
  },
  {
    ruleId: "CLOSED",
    heading: "Sirado nga lista (Closed list)",
    quote:
      "No deduction other than those in this Schedule shall be applied to any member payout. This Schedule shall not be amended during Season 2026-A.",
  },
];

const SIGNATORIES: DocLine[] = [
  { text: "CERTIFIED CORRECT:", style: "small" },
  { text: "MA. THERESA L. GUMAPAC", style: "signature" },
  { text: "Secretary", style: "small" },
  { text: "ATTESTED:", style: "small" },
  { text: "ERNESTO P. CABAHUG", style: "signature" },
  { text: "Chairperson", style: "small" },
];

export const SPECIMEN_DOC = "SPECIMEN · SYNTHETIC DEMO DOCUMENT · NOT A RECORD";

/** Page 1: the resolution, citing the GA approval, ratified 14 Mar 2026, certified by the Secretary. */
export const BR_PAGE_1: readonly DocLine[] = [
  { text: "BULAWANON KAKAW GROWERS MULTI-PURPOSE COOPERATIVE", style: "title" },
  { text: "Calinan, Davao City", style: "body" },
  { text: "OFFICE OF THE BOARD OF DIRECTORS", style: "heading" },
  { text: "BOARD RESOLUTION NO. 2026-04", style: "title" },
  { text: "Series of 2026", style: "body" },
  {
    text: "ADOPTING SCHEDULE A, THE RATE CARD FOR SHARING THE BUYER PREMIUM AND QUALITY BONUS FOR SEASON 2026-A",
    style: "heading",
  },
  {
    text: `WHEREAS, the General Assembly, at its meeting of ${BR_GA_MEETING}, approved that the premium and the quality bonus paid by the buyer, Lantern Bay Chocolate Co., for dried fermented cacao delivered in Season 2026-A (1 April to 31 August 2026) be shared among the members who deliver;`,
    style: "body",
  },
  {
    text: "WHEREAS, the General Assembly directed the Board of Directors to fix the rules of sharing, and the only deductions that may be made, before the first delivery of the season;",
    style: "body",
  },
  {
    text: "NOW, THEREFORE, on motion duly seconded, the Board RESOLVED, as it hereby RESOLVES, to adopt Schedule A, attached as page 2, as the rate card for Season 2026-A, binding on the Treasurer for every payout of the season.",
    style: "body",
  },
  { text: "RATIFIED this 14th day of March 2026 at Calinan, Davao City.", style: "body" },
  ...SIGNATORIES,
  { text: "Page 1 of 2", style: "small" },
  { text: SPECIMEN_DOC, style: "small" },
];

/** Page 2: Schedule A, rules R0–R6 and the closed list, verbatim. */
export const BR_PAGE_2: readonly DocLine[] = [
  { text: "BOARD RESOLUTION NO. 2026-04 · SCHEDULE A", style: "title" },
  { text: "RATE CARD, SEASON 2026-A (1 April to 31 August 2026)", style: "heading" },
  ...SCHEDULE_A.flatMap((c): DocLine[] => [
    { text: c.heading, style: "heading" },
    { text: c.quote, style: "body" },
  ]),
  ...SIGNATORIES,
  { text: "Page 2 of 2", style: "small" },
  { text: SPECIMEN_DOC, style: "small" },
];

export const BR_PAGES: readonly (readonly DocLine[])[] = [BR_PAGE_1, BR_PAGE_2];

/** The text-layer document written to media/docs/BR-2026-04.text.json. */
export function textLayerDocument(verification: {
  status: "unverified" | "agent-checked" | "human-verified";
  by: string | null;
  at: string | null;
  notes: string[];
}) {
  return {
    document: `BR ${BR_RESOLUTION_NO}`,
    resolution_no: BR_RESOLUTION_NO,
    ratified_on: BR_RATIFIED_ON,
    synthetic: true,
    label: "Synthetic sample",
    description:
      "Text layer for the image-only BR 2026-04 scans: the exact printed text, standing in for a scanner's OCR layer (S4.3). Claude reads only the images; this file is used to check quotes.",
    pages: BR_PAGES.map((lines, i) => ({
      page: i + 1,
      image: `docs/br-2026-04-p${i + 1}.webp`,
      lines: lines.map((l) => l.text),
      text: lines.map((l) => l.text).join("\n"),
    })),
    clauses: SCHEDULE_A.map((c) => ({ rule_id: c.ruleId, page: 2, heading: c.heading, quote: c.quote })),
    verification,
    nativeReview: "Cebuano headings pending native review (OD-2)",
  };
}
