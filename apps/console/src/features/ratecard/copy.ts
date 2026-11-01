// Rate-card words @fairsplit/i18n does not carry yet (W-TR-02), in the console's English. Rule texts R0–R4 and
// the bolted line come from the catalog (W-TR-02.*); figures, dates and hashes arrive formatted.

export const RATECARD_COPY = {
  title: "Rate card",
  lede: (resolution: string, date: string) =>
    `${resolution}, ratified ${date}, before the first slip. These rules are a labelled seed stand-in, not a Claude recording; the Secretary and the Chair signed them; the hash bolted them.`,
  schedule: "Schedule A",
  scheduleLede: "Printed from the ratified card. Point at a rule to see the clause it was read from.",
  readFooter: (_model: string, page: number) =>
    `Seed stand-in, not a Claude recording. Seeded quote on page ${page}.`,
  readFooterIdle: (_model: string) =>
    "Seed stand-in, not a Claude recording. Each seeded rule cites its source page.",
  addTitle: "Add a deduction",
  addOpen: "Add a deduction",
  labelField: "What it's for",
  amountField: "Amount, as written",
  sampleLabel: "Iba pa (Other)",
  sampleAmount: "₱150",
  addCommit: "Add to Schedule A",
  addCommitSr: (resolution: string, date: string) =>
    `Add to Schedule A. Bolted: ${resolution} was ratified on ${date} and its rules don't change this season.`,
  refused: "Refused by the server, citing the hash",
  propose: (season: string) => `Draft a proposal for ${season}`,
  proposeSr: "a draft that is not in force, can be undone",
  proposed: "Drafted below",
  proposalTitle: (season: string) => `Proposal for Season ${season}`,
  notInForce: "Not in force",
  proposalNote: (season: string) =>
    `Unhashed and kept on this screen only. A new Board resolution has to ratify it before Season ${season}'s first slip.`,
  certified: "Certified by",
  attested: "Attested by",
  secretary: "Secretary",
  chair: "Chairperson",
  fullHash: "Full hash: ",
  page: (n: number, of: number) => `Page ${n} of ${of}`,
} as const;
