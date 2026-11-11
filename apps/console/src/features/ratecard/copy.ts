// Rate-card words @fairsplit/i18n does not carry yet (W-TR-02), in the console's English. Rule texts R0–R4 and
// the bolted line come from the catalog (W-TR-02.*); figures, dates and hashes arrive formatted.

export const RATECARD_COPY = {
  title: "Rate card",
  /** The card's state in the title row's chip (round 5): ratified, so locked for the season. */
  ratifiedOn: (date: string) => `Ratified ${date}`,
  /** The title row's quiet control: the board's resolution folds away and back. */
  hideDoc: "Hide resolution",
  showDoc: "Show resolution",
  /** The two columns that scroll on their own, by name. */
  docLabel: (resolution: string) => `${resolution}, the board's resolution`,
  sideLabel: "Schedule A and its seal",
  schedule: "Schedule A",
  scheduleLede: "Open a rule for its clause",
  /** The stand-in's glyph words (its title and accessible name), with the page a rule was quoted from. */
  readFooter: (_model: string, page: number) =>
    `Seed stand-in, not a Claude recording. Seeded quote on page ${page}.`,
  readFooterIdle: (_model: string) =>
    "Seed stand-in, not a Claude recording. Each seeded rule cites its source page.",
  /** The page a rule was quoted from, as micro beside the glyph. */
  page: (n: number, of?: number) => (of === undefined ? `p. ${n}` : `Page ${n} of ${of}`),
  addTitle: "Add a deduction",
  addOpen: "Add a deduction",
  labelField: "What it's for",
  amountField: "Amount",
  sampleLabel: "Iba pa (Other)",
  sampleAmount: "₱150",
  addCommit: "Add to Schedule A",
  addCommitSr: (resolution: string, date: string) =>
    `Add to Schedule A. Locked: ${resolution} was ratified on ${date} and its rules don't change this season.`,
  /** The locked slab's caption ("locked", never "bolted": UI gate round 3). */
  locked: (card: string) => `Locked by ${card}`,
  /** The refusal's title (round 3): what was refused and until when; the explanation waits behind "Why". */
  refused: (next: string) => `Refused · Schedule A is closed until ${next}`,
  why: "Why",
  /** The "Why": one line, never the rule list; the hash it cites is `refusalHash`, printed apart. */
  refusalBody: (rateCard: string, season: string, next: string) =>
    `${rateCard} locked Schedule A for ${season}. A new deduction needs a ${next} resolution.`,
  refusalHash: (hashGroups: string) => `Rate card ${hashGroups}.`,
  propose: (season: string) => `Draft a proposal for ${season}`,
  proposeSr: "a draft that is not in force, can be undone",
  proposed: "Drafted below",
  proposalTitle: (season: string) => `Proposal for Season ${season}`,
  notInForce: "Not in force",
  proposalNote: (season: string) => `Unhashed, this screen only · needs a Board resolution before ${season}`,
  certified: "Certified by",
  attested: "Attested by",
  secretary: "Secretary",
  chair: "Chairperson",
  fullHash: "Full hash: ",
} as const;
