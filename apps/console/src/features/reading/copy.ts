// Reading-room words @fairsplit/i18n does not carry yet (W-TR-03), in the console's English. Every figure is
// the slip's own text or a score the reading reported; nothing here is a number of its own.

export const READING_COPY = {
  title: "Reading room",
  filmstrip: "Photos in the recorded run",
  progress: (read: number, total: number) => `${read} of ${total} slips read`,
  photoLink: (id: string, read: boolean, pending: boolean) =>
    `Photo ${id}${read ? ", read" : ", not read yet"}${pending ? ", needs a person" : ""}`,
  earlier: (count: number) => `Read earlier this season (${count})`,
  earlierShort: "Earlier",
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
  illegible: "Too blurred to read",
  // confirm-one (S1.7): one tap confirms the zoom's read.
  field: {
    serial: "serial",
    date: "date",
    member_no: "member number",
    member_name: "member name",
    plot_no: "plot",
    sacks: "sacks",
    gross_kg: "gross kilos",
    tare_kg: "tare kilos",
    net_kg: "net kilos",
    mc_pct: "moisture",
    mc_less_kg: "moisture kilos",
    payable_kg: "payable kilos",
    grade: "grade",
  } as Readonly<Record<string, string>>,
  confirmTitle: (serial: string, field: string) => `Slip ${serial}, ${field}`,
  confirmReads: (display: string, value: string) =>
    `The two readings were ${display}; Claude's zoom read ${value}, which agrees with one of them.`,
  confirm: (value: string) => `Confirm ${value}`,
  confirmSr: (value: string, serial: string) =>
    `Confirm ${value} on slip ${serial}, as Claude's zoom read it`,
  confirmByHand: "Type it by hand instead",
  confirmNoSession: "Confirming waits for your run: press the first slab on the stage.",
  confirmNoHold: "This run hasn't raised a hold for this slip yet, so there's nothing to confirm.",
  confirmDecided: "This slip was already decided.",
  confirmed: (name: string) => `Confirmed by ${name}`,
  // blurred (S1.7): the clerk rescans.
  rescanTitle: (photoId: string) => `Photo ${photoId} needs a rescan`,
  rescanLine: (clerk: string) =>
    `Every field came back illegible on both readings. ${clerk} rescans it on the scale's phone.`,
  rescan: "Request rescan",
  rescanSr: (photoId: string, clerk: string) => `Request a rescan of photo ${photoId} from ${clerk}`,
  rescanUnavailable: (clerk: string) =>
    `Rescan requests reach ${clerk}'s phone once the server has a route for them. Nothing was sent.`,
  // The mock API streams no rows yet: this page plays a stand-in for the recorded run, built from the seed (mock
  // data only). The button names what plays (I8): never "the recorded reading".
  replay: "Play the seed's stand-in",
  replayAgain: "Play the stand-in again",
  replayStop: "Stop the stand-in",
  // The mock's stand-in is built from the seed's own text: not the recording, and it shows no scores.
  replayNote: (date: string) =>
    `Mock data: the mock API sends no rows, so this page plays a stand-in for the ${date} recording, built from the seed. It shows no agreement scores: none were read.`,
  replayRunning: (done: number, total: number, _date: string) =>
    `Playing the seed's stand-in here: ${done} of ${total} rows. Mock data.`,
  replayDone: (total: number, _date: string) => `Played all ${total} rows of the seed's stand-in. Mock data.`,
} as const;
