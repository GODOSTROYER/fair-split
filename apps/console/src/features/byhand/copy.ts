// By-hand words @fairsplit/i18n does not carry yet (W-TR-04), in the console's English. Every figure is the
// slip's text, the logbook's, or kilos arithmetic on them; nothing here is money.

export const BY_HAND_COPY = {
  title: (serial: string) => `Slip ${serial}, by hand`,
  prompt: (serial: string, name: string, reading: string, score: string | null) =>
    `Slip ${serial}, ${name}. A water stain covers one digit of the gross weight. Claude read ${reading}${score ? ` (${score})` : ""}.`,
  promptPlain: (serial: string, name: string, reading: string) =>
    `Slip ${serial}, ${name}. Claude wasn't sure of the gross weight and read ${reading}.`,
  noNeed: (serial: string) =>
    `Slip ${serial} needs nothing by hand: Claude's two reads agreed on every field.`,
  openReading: "Open it in the reading room",
  crop: "The slip, three times its size in the photo",
  cropAlt: (serial: string) => `Slip ${serial}: gross, tare and net, under a water stain`,
  logbook: (page: number, from: number, to: number) =>
    `Logbook page ${page}, lines ${from} to ${to}: the second witness`,
  logbookAlt: (page: number, line: number, net: string) =>
    `Logbook page ${page}, line ${line}: ${net} kg net, in the clerk's hand`,
  inputLabel: (serial: string) => `Gross kilos on slip ${serial}`,
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
  needDigit: "Type the hidden digit first.",
  needValue: "Type the gross kilos first.",
  checkBoth: "Check the slip and the logbook first.",
  notRead: (serial: string) =>
    `Slip ${serial} hasn't been read in this run yet. Its row prints in the reading room first.`,
  noField: (serial: string) =>
    `This step isn't wired on the server yet: it doesn't say which field on slip ${serial} takes the entry. Nothing changed.`,
  readFirst: "Watch the reading room",
  anywayOpen: "Enter anyway with a reason",
  reasonLabel: "Why the slip is right and the logbook isn't",
  reasonNote: "The reason stays on this console: the entry the API takes is the value alone.",
  skip: "Skip for now",
  skipped: (serial: string) => `Skipped. Approval waits for slip ${serial}.`,
  unskip: "Enter it now",
  committed: (name: string) => `Entered by ${name}`,
  committedFrom: (name: string, line: number) => `Entered by ${name}, from logbook line ${line}`,
  committedNet: (net: string) => `Net ${net} kg.`,
  sending: "Entering the value.",
  next: "Next",
} as const;
