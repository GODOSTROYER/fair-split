// By-hand words @fairsplit/i18n does not carry yet (W-TR-04), in the console's English. Every figure is the
// slip's text, the logbook's, or kilos arithmetic on them; nothing here is money.

export const BY_HAND_COPY = {
  title: (serial: string) => `Slip ${serial}`,
  /** The header's grey context: what this screen does. */
  titleContext: "by hand",
  /** The slip's state in the title row's chip (round 5): a person's decision, then the treasurer's ink. */
  stateNeeds: "Needs a person",
  stateEntered: "Entered",
  /** The header's micro line: who the slip belongs to, "name · M-060" (the number set in the id role). */
  whoJoin: " · ",
  /** The one line (spec §3.5), the reading as a figure, then the stand-in's glyph ("placeholder score" is cut). */
  promptLine: "A stain hides one digit.",
  promptLinePlain: "The gross weight is unclear.",
  /** The prompt as its words read in order (the tag's tail is for screen readers). */
  prompt: (_serial: string, _name: string, reading: string, _score: string | null) =>
    `A stain hides one digit. ${reading} Seed stand-in, not a Claude recording`,
  promptPlain: (_serial: string, _name: string, reading: string) =>
    `The gross weight is unclear. ${reading} Seed stand-in, not a Claude recording`,
  noNeed: (serial: string) =>
    `Slip ${serial} needs nothing by hand: the seed stand-in has no doubtful field.`,
  openReading: "Open it in the reading room",
  crop: (serial: string) => `slip ${serial} · 3×`,
  cropAlt: (serial: string) => `Slip ${serial}: gross, tare and net, under a water stain`,
  logbook: (page: number, from: number, to: number) => `logbook p. ${page} · lines ${from}–${to} · witness`,
  logbookAlt: (page: number, line: number, net: string) =>
    `Logbook page ${page}, line ${line}: ${net} kg net, in the clerk's hand`,
  inputLabel: (_serial: string) => "Gross kg",
  inputHint: "Type the hidden digit. The rest is already filled in from the slip.",
  inputHintWhole: "Type the gross kilos as written on the slip, with two decimals.",
  typeWhole: "Type the whole value",
  useMask: "Fill only the hidden digit",
  useLogbook: (line: number) => `Use logbook line ${line}`,
  usedLogbook: (line: number) => `From logbook line ${line}`,
  live: (gross: string, tare: string, net: string) => `${gross} − ${tare} tare = ${net} net.`,
  matches: (page: number, line: number) => `Matches logbook page ${page}, line ${line}.`,
  mismatch: (net: string, line: number, logbookNet: string) =>
    `${net} doesn't match logbook line ${line} (${logbookNet}). Check both.`,
  noWitness: "No logbook line for this slip.",
  enter: (value: string) => `Enter ${value}`,
  enterAnyway: (value: string) => `Enter ${value} anyway`,
  enterSr: (value: string, serial: string) => `Enter ${value} kilos for slip ${serial}, changes a line`,
  needDigit: "Digit needed",
  needValue: "Type the gross kilos first.",
  checkBoth: "Check the slip and the logbook first.",
  notRead: (serial: string) =>
    `Slip ${serial} hasn't been read in this run yet. Its row prints in the reading room first.`,
  noField: (serial: string) =>
    `This step isn't wired on the server yet: it doesn't say which field on slip ${serial} takes the entry. Nothing changed.`,
  readFirst: "Watch the reading room",
  anywayOpen: "Enter anyway with a reason",
  offPath:
    "This console computes the split from the logbook's value, so it can't take a different one yet: the payout wouldn't follow it. Check the slip, or use the logbook line.",
  skip: "Skip for now",
  skipped: (serial: string) => `Skipped. Approval waits for slip ${serial}.`,
  unskip: "Enter it now",
  committed: (name: string) => `Entered by ${name}`,
  /** The result's one caption (round 3): who, and the witness line it came from or agrees with. */
  committedFrom: (name: string, line: number) => `Entered by ${name} · logbook line ${line}`,
  committedMatches: (name: string, line: number) => `Entered by ${name} · matches logbook line ${line}`,
  committedMismatch: (line: number, logbookNet: string) =>
    `Logbook line ${line} says ${logbookNet}: they don't match.`,
  /** The result's kilos: "64.80 − 0.30 = 64.50 kg" (the slip's text and the server's derived net). */
  minus: "−",
  kg: (value: string) => `${value} kg`,
  /** The next action, named for the work it opens. */
  reviewHolds: (n: number) => (n === 1 ? "Review 1 hold" : `Review ${n} holds`),
  sending: "Entering the value.",
  next: "Next",
} as const;
