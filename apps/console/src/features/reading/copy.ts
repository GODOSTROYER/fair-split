// Reading-room words @fairsplit/i18n does not carry yet (W-TR-03), in the console's English. Every figure is
// the slip's own text or a score the reading reported; nothing here is a number of its own.

export const READING_COPY = {
  title: "Reading room",
  filmstrip: "Photos in the recorded run",
  progress: (read: number, total: number) => `${read} of ${total} slips read`,
  photoLink: (id: string, read: boolean, pending: boolean) =>
    `Photo ${id}${read ? ", read" : ", not read yet"}${pending ? ", needs a person" : ""}`,
  earlier: (count: number) => `Read earlier this season (${count})`,
  earlierHide: "Hide the earlier photos",
  earlierTile: (id: string, date: string) => `Photo ${id}, read ${date}`,
  archived: "Archived photo",
  bench: (id: string) => `Photo ${id}`,
  benchAlt: (id: string, serials: string) => `Photo ${id}: four weigh slips, ${serials}, on the clerk's mat`,
  benchKeys: "Plus and minus zoom; arrow keys move around the photo.",
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  zoomFit: "Fit",
  zoomLevel: (scale: string) => `${scale}×`,
  beds: (id: string) => `Rows read from photo ${id}`,
  bedsKeys:
    "J and K move between rows. Space opens the slip on the photo. Enter takes a doubtful field to a person.",
  col: {
    serial: "Slip",
    member: "Member",
    net: "Net kg",
    mc: "MC %",
    grade: "Grade",
    confidence: "Confidence",
  },
  waiting: "Waiting to be read",
  pinkCopy: "pink copy",
  whiteCopy: "white original",
  byHand: (serial: string) => `Enter slip ${serial} by hand`,
  entered: (name: string) => `Entered by ${name}`,
  readTwice: "Read twice by Claude",
  footer: (model: string, date: string) =>
    `Read by Claude (${model}), replay of a recorded run from ${date}. Amounts are computed by the engine, never by the model.`,
  earlierFooter: (date: string) => `Read on ${date}, earlier this season. Seeded sample.`,
  stateOffline: "You're offline. Rows already read stay; new ones arrive when the connection returns.",
  stateLivePaused: "Live reading is paused for today (budget cap). The recorded run still plays.",
} as const;
