// Which signing keys are samples (I8): one rule for officer keys (Proof plate 5) and ledger keys
// (the checkpoint). Pure, no node built-ins: the browser verifier imports it.
//
// The registered kind from the trust registry decides first: only a real person's key (`app`, or a
// `web` browser key) or the server's ledger key (`server`) can be real. A key ID can then only make
// a key MORE sample, never less: a seeded ID `fs-{persona}-s{n}` (including `fs-ledger-s{n}`), a
// labelled demo ID `fs-{persona}-demo-{6}` (register C-13) or an ID of no real shape is a sample.
// A `w` ID alone proves nothing either way: the treasurer's real key is `fs-analyn-w1` (S3.8), while
// judge sessions also make `w` keys, which are told apart by their registered kind `web_demo`.

/** Kinds a real key is registered with. Every other kind, `web_demo`, `seeded` or unknown, is a sample. */
const REAL_KINDS: Readonly<Record<string, RegExp>> = {
  /** A person's device key: `fs-{persona}-{a|w}{n}`. */
  app: /^fs-[a-z]+-[aw]\d+$/,
  web: /^fs-[a-z]+-[aw]\d+$/,
  /** The server's ledger key: `fs-ledger-k{n}`. */
  server: /^fs-ledger-k\d+$/,
};
const SEEDED_ID = /^fs-[a-z]+-s\d+$/;
const DEMO_ID = /(?:^|-)demo(?:-|$)/;

/**
 * True when a signing key is a sample, so a Proof it signs can read "Sample" (in demo mode) and
 * never "Verified". `kind` must be the kind the trust registry publishes for the key.
 */
export function keyIdIsSample(keyId: string, kind: string | null | undefined): boolean {
  if (typeof keyId !== "string" || typeof kind !== "string") return true;
  const realShape = Object.hasOwn(REAL_KINDS, kind) ? REAL_KINDS[kind] : undefined;
  if (realShape === undefined) return true;
  return SEEDED_ID.test(keyId) || DEMO_ID.test(keyId) || !realShape.test(keyId);
}
