// Which signing keys are samples (I8): one rule for officer keys (Proof plate 5) and ledger keys
// (the checkpoint). Pure, no node built-ins: the browser verifier imports it.
//
// The registered kind from the trust registry decides first: only a person's app key (`app`), a
// persisted browser key (`web`) or the server's ledger key (`server`) can be real, and only with
// that kind's own ID shape (contracts' `KEY_ID_PATTERNS`). A key ID can then only make a key MORE
// sample, never less: a seeded ID (`fs-{persona}-s{n}`, `fs-ledger-s{n}`), a labelled demo ID
// (`fs-{persona}-demo-{6}`, register C-13) or an ID that is not its kind's shape is a sample.
// A `w` ID alone proves nothing: the treasurer's real key is `fs-analyn-w1` (S3.8, kind `web`),
// while judge sessions also make browser keys, told apart by their registered kind `web_demo`.
import { KEY_ID_PATTERNS } from "@fairsplit/contracts";

/** Kinds a real key is registered with, and the one ID shape each may carry. */
const REAL_KINDS: Readonly<Record<string, RegExp>> = {
  app: KEY_ID_PATTERNS.app,
  web: KEY_ID_PATTERNS.web,
  server: KEY_ID_PATTERNS.ledger,
};
/** A `demo` segment anywhere in an ID marks a demo key, whatever else the ID looks like. */
const DEMO_SEGMENT = /(?:^|-)demo(?:-|$)/;

/**
 * True when a signing key is a sample, so a Proof it signs can read "Sample" (in demo mode) and
 * never "Verified". `kind` must be the kind the trust registry publishes for the key; `web_demo`,
 * `seeded` and any unknown kind are samples.
 */
export function keyIdIsSample(keyId: string, kind: string | null | undefined): boolean {
  if (typeof keyId !== "string" || typeof kind !== "string") return true;
  const realShape = Object.hasOwn(REAL_KINDS, kind) ? REAL_KINDS[kind] : undefined;
  if (realShape === undefined) return true;
  return (
    KEY_ID_PATTERNS.seeded.test(keyId) ||
    KEY_ID_PATTERNS.seededLedger.test(keyId) ||
    KEY_ID_PATTERNS.demo.test(keyId) ||
    DEMO_SEGMENT.test(keyId) ||
    !realShape.test(keyId)
  );
}
