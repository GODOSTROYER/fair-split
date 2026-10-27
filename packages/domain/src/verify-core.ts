// The Proof verifier with injectable crypto (exported as `@fairsplit/domain/verify`). Pure: no
// node built-ins, so the Proof page can run it in the browser with its own sha256 and Ed25519.
// entry_hash = sha256(prev_hash ‖ JCS({seq, kind, actorKind, actorId, impersonatedBy, payload, at}))
// with a genesis prev_hash of 64 zeros; then the six Proof plates (S3.12).
//
// Every plate is bound to the chain. A bundle field counts only where a ledger entry of the
// contract's shape attests it, so editing the bundle and re-hashing it still fails. Trust never
// comes from the bundle: approvals verify against the published officer keys and the ledger's head
// against a checkpoint signed by a pinned ledger key, both passed in by the caller (the app
// publishes them at /.well-known/fairsplit-keys.json). A re-chained bundle cannot be re-signed.
// Seeded and demo keys are samples: they fail, or read "sample" in an explicit demo mode, and never
// "verified". PayPal's own records anchor the run and are returned for matching: the invoice
// reference carries the card hash, `sender_batch_id` carries rc8 and the runSeq, and the batch note
// carries the batch digest's first 8 hex digits.
import {
  type ChainVerification,
  GENESIS_PREV_HASH,
  type Json,
  LedgerCheckpoint,
  type LedgerEntry,
  type LedgerPayload,
  LedgerPayloads,
  type PayoutItemStatus,
  type PlateResult,
  type ProofBundle,
  type ProofLedgerKind,
  type ProofStatus,
  ProofTrust,
  PublishedKeys,
  type SignedApproval,
} from "@fairsplit/contracts";
import {
  approvalBytes,
  batchCanonical,
  checkpointBytes,
  invoiceReference,
  linesRootJcs,
} from "./digest-input.js";
import { applyItemStatus, itemStatusFromEvent } from "./fsm.js";
import { batchNote, parseRunSlug, parseSenderItemId, seasonLabelOf, senderBatchId } from "./ids.js";
import { jcs } from "./jcs.js";
import { keyIdIsSample } from "./sample-keys.js";

export { keyIdIsSample } from "./sample-keys.js";

/** Synchronous hashing and signature primitives (node:crypto on the server, noble in a browser). */
export interface ProofCrypto {
  sha256Hex(data: string): string;
  verifyEd25519(publicKeyHex: string, message: Uint8Array, signatureHex: string): boolean;
}

export interface LedgerFact {
  kind: string;
  actorKind: LedgerEntry["actorKind"];
  actorId: string;
  impersonatedBy: string | null;
  payload: Json;
  at: string;
}

/** The string hashed for one ledger entry: prev_hash ‖ JCS(fields). */
export function ledgerPreimage(prevHash: string, seq: number, fact: LedgerFact): string {
  return (
    prevHash +
    jcs({
      seq,
      kind: fact.kind,
      actorKind: fact.actorKind,
      actorId: fact.actorId,
      impersonatedBy: fact.impersonatedBy,
      payload: fact.payload,
      at: fact.at,
    })
  );
}

export function verifyLedgerWith(
  entries: readonly LedgerEntry[],
  c: Pick<ProofCrypto, "sha256Hex">,
): { ok: boolean; brokenAtSeq: number | null } {
  let prevHash = GENESIS_PREV_HASH;
  let expectedSeq = 1;
  for (const e of entries) {
    const recomputed = c.sha256Hex(ledgerPreimage(e.prevHash, e.seq, e));
    if (e.seq !== expectedSeq || e.prevHash !== prevHash || recomputed !== e.entryHash) {
      return { ok: false, brokenAtSeq: e.seq };
    }
    prevHash = e.entryHash;
    expectedSeq += 1;
  }
  return { ok: true, brokenAtSeq: null };
}

export interface Attested<K extends ProofLedgerKind> {
  seq: number;
  at: string;
  actorId: string;
  payload: LedgerPayload<K>;
}

/** The entries of one Proof kind whose payload has the contract's shape. Others attest nothing. */
export function attestedEntries<K extends ProofLedgerKind>(
  ledger: readonly LedgerEntry[],
  kind: K,
): Attested<K>[] {
  const schema = LedgerPayloads[kind];
  const out: Attested<K>[] = [];
  for (const e of ledger) {
    if (e.kind !== kind) continue;
    const parsed = schema.safeParse(e.payload);
    if (parsed.success) {
      out.push({ seq: e.seq, at: e.at, actorId: e.actorId, payload: parsed.data as LedgerPayload<K> });
    }
  }
  return out;
}

const PASS: PlateResult = { ok: true, reason: null };
const fail = (reason: string): PlateResult => ({ ok: false, reason });
const sumOf = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0);

/** Runs one plate; a malformed bundle fails that plate instead of throwing. */
function guarded(reason: string, check: () => PlateResult): PlateResult {
  try {
    return check();
  } catch {
    return fail(reason);
  }
}

/** The `rows.accepted` entry for each of the bundle's documents (missing documents are skipped). */
function acceptedRows(p: ProofBundle): Attested<"rows.accepted">[] {
  const accepted = attestedEntries(p.ledger, "rows.accepted");
  return p.documents.flatMap((d) => {
    const e = accepted.find((x) => x.payload.documentId === d.documentId && x.payload.sha256 === d.sha256);
    return e ? [e] : [];
  });
}

/**
 * The run's last `lines.computed` entry. Plate 4 also requires it to come before every signature the
 * Proof counts, so it is the computation both keys signed: none for the run may follow them.
 */
function computedEntry(p: ProofBundle): Attested<"lines.computed"> | undefined {
  return attestedEntries(p.ledger, "lines.computed")
    .filter((e) => e.payload.runId === p.runId)
    .at(-1);
}

/** The `approval.signed` entry that records exactly this approval. */
function signedEntry(p: ProofBundle, a: SignedApproval): Attested<"approval.signed"> | undefined {
  const q = a.payload;
  return attestedEntries(p.ledger, "approval.signed").find(
    (e) =>
      e.actorId === q.approverId &&
      e.payload.runId === p.runId &&
      e.payload.role === a.role &&
      e.payload.keyId === a.keyId &&
      e.payload.approverId === q.approverId &&
      e.payload.batchSha256 === q.batchSha256 &&
      e.payload.nonce === q.nonce,
  );
}

// 1 Paid: PAID or MARKED_AS_PAID, 0.00 due, reference = rc:{sha16}, total = pool + disbursement,
// and an `invoice.funded` entry attests exactly that.
function platePaid(p: ProofBundle): PlateResult {
  const inv = p.invoice;
  if (inv.invoiceNumber !== `FS-${p.runSlug}`) return fail("The invoice number is not this run's.");
  if ((inv.status !== "PAID" && inv.status !== "MARKED_AS_PAID") || inv.dueCents !== 0) {
    return fail("The invoice is not paid in full.");
  }
  if (inv.reference !== invoiceReference(p.rateCard.sha256)) {
    return fail("The invoice reference does not carry the card hash.");
  }
  const quoted =
    p.pools.premiumPoolCents + p.pools.bonusPoolCents + p.rateCard.canonical.pricing.disbursementCents;
  if (inv.amountCents !== quoted)
    return fail("The invoice total is not the pool plus the disbursement line.");
  const funded = attestedEntries(p.ledger, "invoice.funded")
    .filter((e) => e.payload.runId === p.runId)
    .at(-1)?.payload;
  if (
    !funded ||
    funded.invoiceNumber !== inv.invoiceNumber ||
    funded.status !== inv.status ||
    funded.amountCents !== inv.amountCents ||
    funded.dueCents !== inv.dueCents ||
    funded.reference !== inv.reference
  ) {
    return fail("No entry in the chain attests this payment.");
  }
  return PASS;
}

// 2 Ratified: the card re-hashes to the value a `rate_card.ratified` entry carries, and it was
// ratified before the first slip, both by date and in chain order.
function plateRatified(p: ProofBundle, c: ProofCrypto): PlateResult {
  const card = p.rateCard;
  if (c.sha256Hex(jcs(card.canonical)) !== card.sha256) {
    return fail("The rate card does not re-hash to the published value.");
  }
  const ratified = attestedEntries(p.ledger, "rate_card.ratified").find(
    (e) => e.payload.rateCardSha256 === card.sha256,
  );
  if (!ratified || ratified.payload.ratifiedAt !== card.ratifiedAt) {
    return fail("No ratification in the chain carries this card hash.");
  }
  if (card.ratifiedAt.slice(0, 10) > p.firstSlipDate) return fail("A slip predates the rate card.");
  const rows = acceptedRows(p);
  if (rows.some((e) => e.seq < ratified.seq))
    return fail("A slip was accepted before the card was ratified.");
  const firstDate = rows.flatMap((e) => e.payload.slipDates).sort()[0];
  if (firstDate !== p.firstSlipDate) return fail("The first slip date differs from the chain's.");
  return PASS;
}

// 3 Read: every slip document hash is attested by a `rows.accepted` entry for that document.
function plateRead(p: ProofBundle): PlateResult {
  if (p.documents.length === 0) return fail("There are no slip photos.");
  if (new Set(p.documents.map((d) => d.documentId)).size !== p.documents.length) {
    return fail("A slip photo is listed twice.");
  }
  if (acceptedRows(p).length !== p.documents.length) return fail("A slip photo hash is not in the chain.");
  return PASS;
}

// 4 Computed: each line re-hashes, cites this card and adds up; the lines sum to the pools; the
// run's `lines.computed` entry carries the same lines root and pools; and it precedes every
// signature the Proof counts, so the lines were not computed again after they were signed. (A
// signature voided by a line edit may precede it: only the approvals in the bundle count.)
function plateComputed(p: ProofBundle, c: ProofCrypto): PlateResult {
  if (p.lines.length === 0) return fail("There are no lines.");
  if (new Set(p.lines.map((l) => l.memberNo)).size !== p.lines.length) return fail("A member has two lines.");
  for (const l of p.lines) {
    const k = l.canonical;
    if (
      c.sha256Hex(jcs(k)) !== l.lineSha256 ||
      k.memberNo !== l.memberNo ||
      k.rail !== l.rail ||
      k.rateCardSha256 !== p.rateCard.sha256 ||
      k.premiumCents !== l.premiumCents ||
      k.bonusCents !== l.bonusCents ||
      k.netCents !== l.netCents ||
      sumOf(k.deductions.map((d) => d.amountCents)) !== l.deductionsCents ||
      sumOf(k.credits.map((x) => x.amountCents)) !== l.creditsCents ||
      l.premiumCents + l.bonusCents - l.deductionsCents + l.creditsCents !== l.netCents
    ) {
      return fail("A line hash does not recompute.");
    }
  }
  if (
    sumOf(p.lines.map((l) => l.premiumCents)) !== p.pools.premiumPoolCents ||
    sumOf(p.lines.map((l) => l.bonusCents)) !== p.pools.bonusPoolCents
  ) {
    return fail("The lines do not sum to the pools.");
  }
  const computed = computedEntry(p);
  if (!computed) return fail("No computation for this run is in the chain.");
  const k = computed.payload;
  if (
    k.rateCardSha256 !== p.rateCard.sha256 ||
    k.lineCount !== p.lines.length ||
    k.linesRootSha256 !== c.sha256Hex(linesRootJcs(p.lines))
  ) {
    return fail("The line hashes differ from the computed run.");
  }
  if (
    k.premiumPoolCents !== p.pools.premiumPoolCents ||
    k.bonusPoolCents !== p.pools.bonusPoolCents ||
    k.netCents !== sumOf(p.lines.map((l) => l.netCents)) ||
    !k.balanced
  ) {
    return fail("The pools differ from the computed run.");
  }
  if (acceptedRows(p).some((e) => e.seq > computed.seq)) {
    return fail("A slip was accepted after the lines were computed.");
  }
  if (p.approvals.some((a) => (signedEntry(p, a)?.seq ?? Number.POSITIVE_INFINITY) < computed.seq)) {
    return fail("The lines were computed again after they were signed.");
  }
  return PASS;
}

const revokedBy = (revokedAt: string | null, at: string) =>
  revokedAt !== null && !(Date.parse(revokedAt) > Date.parse(at));

// 5 Two keys: the treasurer always signs and the Chair co-signs above the card's thresholds (R5).
// Each signature is over this batch and these lines (its `linesDigest` is the lines root of every
// member line, cash included), recorded by an `approval.signed` entry after its key's
// `key.registered` entry, and verifies against the key the officer registry publishes for that key
// ID, role and approver (passed in from outside the bundle). The bundle's keys, in the approval or
// in the ledger, are never trusted. Seeded or demo keys make the plate a sample (demo mode only):
// `keyIdIsSample` decides from the published kind, and the ledger's own registration or the key ID
// can only add to that.
function plateTwoKeys(
  p: ProofBundle,
  c: ProofCrypto,
  trust: ProofTrust,
  demoMode: boolean,
  sample: Set<string>,
): PlateResult {
  const items = p.batch.items;
  const total = sumOf(items.map((i) => i.amountCents));
  const cosign = p.rateCard.canonical.rules.cosign;
  const needsChair = total > cosign.batchOverCents || items.some((i) => i.amountCents > cosign.lineOverCents);
  const roles = p.approvals.map((a) => a.role);
  if (!roles.includes("treasurer")) return fail("The treasurer's signature is missing.");
  if (needsChair && !roles.includes("chair")) return fail("The Chair's co-signature is missing.");
  const distinct = (xs: string[]) => new Set(xs).size === xs.length;
  if (
    !distinct(roles) ||
    !distinct(p.approvals.map((a) => a.keyId)) ||
    !distinct(p.approvals.map((a) => a.payload.approverId))
  ) {
    return fail("Each signature must come from a different person with a different key.");
  }
  const keys = attestedEntries(p.ledger, "key.registered");
  const linesRoot = c.sha256Hex(linesRootJcs(p.lines));
  const publishedKeys: string[] = [];
  const sampleHere: string[] = [];
  for (const a of p.approvals) {
    const q = a.payload;
    if (
      a.role !== q.role ||
      q.runId !== p.runId ||
      q.rateCardSha256 !== p.rateCard.sha256 ||
      q.batchSha256 !== p.batch.batchSha256 ||
      q.itemCount !== items.length ||
      q.totalCents !== total ||
      q.currency !== "USD"
    ) {
      return fail("A signature is over a different batch.");
    }
    if (q.linesDigest !== linesRoot) return fail("A signature does not cover these lines.");
    const entry = signedEntry(p, a);
    if (!entry) return fail("A signature is not recorded in the chain.");
    if (Date.parse(entry.at) > Date.parse(q.exp)) return fail("A signature was recorded after it expired.");
    const published = trust.officers.filter((k) => k.keyId === a.keyId);
    const pub = published[0];
    if (!pub || published.length !== 1) return fail("A signing key is not among the published officer keys.");
    if (pub.role !== a.role || pub.approverId !== q.approverId) {
      return fail("A signing key is not published for its signer and role.");
    }
    if (revokedBy(pub.revokedAt, entry.at)) return fail("A signing key was revoked before it signed.");
    const regs = keys.filter((e) => e.payload.keyId === a.keyId);
    const reg = regs[0];
    if (
      !reg ||
      regs.some(
        (e) =>
          e.payload.publicKeyHex !== reg.payload.publicKeyHex ||
          e.payload.persona !== reg.payload.persona ||
          e.payload.kind !== reg.payload.kind,
      )
    ) {
      return fail("A signing key is not registered in the chain.");
    }
    if (reg.seq > entry.seq || reg.payload.persona !== q.approverId) {
      return fail("A signing key is not registered to its signer.");
    }
    if (reg.payload.publicKeyHex !== pub.publicKeyHex || a.publicKeyHex !== pub.publicKeyHex) {
      return fail("A signature's key differs from the published key.");
    }
    if (!c.verifyEd25519(pub.publicKeyHex, approvalBytes(q), a.signatureHex)) {
      return fail("The two signatures do not both verify over the same batch hash.");
    }
    publishedKeys.push(pub.publicKeyHex);
    if (keyIdIsSample(a.keyId, pub.kind) || keyIdIsSample(reg.payload.keyId, reg.payload.kind)) {
      sampleHere.push(a.keyId);
    }
  }
  if (new Set(publishedKeys).size !== publishedKeys.length) {
    return fail("Each signature must come from a different person with a different key.");
  }
  if (sampleHere.length > 0) {
    for (const k of sampleHere) sample.add(k);
    if (!demoMode) return fail("A signature uses a sample key, so this Proof can only read as a Sample.");
  }
  return PASS;
}

type CheckpointResult = ChainVerification["checkpoint"];

/**
 * The ledger's head must be exactly what a pinned ledger key signed for this run: the checkpoint's
 * key ID is pinned once and not revoked (whatever date the checkpoint claims), it names this run,
 * its seq and entry hash are the last entry's (nothing truncated or appended), it is dated no
 * earlier than that entry, and the signature verifies. A sample ledger key (`keyIdIsSample`: seeded
 * kind or ID) makes it a sample (demo mode only). Without a valid checkpoint, nothing verifies;
 * PayPal's anchors are returned either way.
 */
function checkCheckpoint(
  p: ProofBundle,
  ledger: readonly LedgerEntry[],
  c: ProofCrypto,
  trust: ProofTrust,
  demoMode: boolean,
  sample: Set<string>,
): CheckpointResult {
  const raw = (p as { checkpoint?: unknown }).checkpoint;
  if (raw === undefined || raw === null) {
    return { ok: false, reason: "There is no signed ledger checkpoint.", seq: null, keyId: null };
  }
  const parsed = LedgerCheckpoint.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "The ledger checkpoint could not be read.", seq: null, keyId: null };
  }
  const cp = parsed.data;
  const no = (reason: string): CheckpointResult => ({ ok: false, reason, seq: cp.seq, keyId: cp.keyId });
  const pinned = trust.ledger.filter((k) => k.keyId === cp.keyId);
  const key = pinned[0];
  if (!key || pinned.length !== 1) return no("The ledger checkpoint is not signed by a pinned ledger key.");
  // A checkpoint's `at` is the signer's own claim, so it cannot show the key signed before its
  // revocation: a revoked ledger key is untrusted for every checkpoint.
  if (key.revokedAt !== null) return no("The ledger key has been revoked.");
  if (cp.runId !== p.runId) return no("The checkpoint is for another run.");
  const head = ledger.at(-1);
  if (!head || ledger.length !== cp.seq || head.seq !== cp.seq || head.entryHash !== cp.entryHash) {
    return no("The signed checkpoint does not match the ledger's head.");
  }
  if (!(Date.parse(cp.at) >= Date.parse(head.at)))
    return no("The checkpoint is older than the ledger's head.");
  if (!c.verifyEd25519(key.publicKeyHex, checkpointBytes(cp), cp.signatureHex)) {
    return no("The ledger checkpoint's signature does not verify.");
  }
  if (keyIdIsSample(cp.keyId, key.kind)) {
    sample.add(cp.keyId);
    if (!demoMode)
      return no(
        "The ledger checkpoint is signed with a sample key, so this Proof can only read as a Sample.",
      );
  }
  return { ok: true, reason: null, seq: cp.seq, keyId: cp.keyId };
}

/** PayPal's own records of the run, as the bundle states them (plates 1 and 6 check them). */
function anchorsOf(p: ProofBundle): ChainVerification["anchors"] {
  const read = (get: () => unknown): string | null => {
    try {
      const v = get();
      return typeof v === "string" ? v : null;
    } catch {
      return null;
    }
  };
  return {
    invoiceNumber: read(() => p.invoice.invoiceNumber),
    invoiceReference: read(() => p.invoice.reference),
    senderBatchId: read(() => p.batch.senderBatchId),
    batchNote: read(() => p.batch.note),
    batchNoteDigest: read(() => p.batch.batchSha256.slice(0, 8)),
  };
}

// 6 Payout items: the items recompute to the signed hash, carry this run's IDs, pay exactly the
// on-rail lines, match the `payout.submitting` entry written after both signatures, and every
// status is the forward-only fold of verified `webhook.applied` entries.
function platePayoutItems(p: ProofBundle, c: ProofCrypto): PlateResult {
  const b = p.batch;
  const season = p.rateCard.canonical.season;
  const slug = parseRunSlug(p.runSlug);
  if (b.items.length === 0) return fail("The batch has no items.");
  if (
    !slug ||
    slug.seasonCode !== season ||
    b.runId !== p.runId ||
    b.rateCardSha256 !== p.rateCard.sha256 ||
    b.senderBatchId !== senderBatchId(season, p.rateCard.sha256, slug.runSeq)
  ) {
    return fail("The batch ID does not carry this card and run.");
  }
  const canon = batchCanonical(
    { runId: b.runId, senderBatchId: b.senderBatchId, rateCardSha256: b.rateCardSha256 },
    b.items.map((i) => ({
      senderItemId: i.senderItemId,
      receiver: i.receiver,
      amountCents: i.amountCents,
      currency: i.currency,
    })),
  );
  if (c.sha256Hex(canon.jcs) !== b.batchSha256) {
    return fail("The batch hash doesn't match the signed batch. Proof withheld.");
  }
  if (b.note !== batchNote(seasonLabelOf(season), b.batchSha256)) {
    return fail("The batch note does not carry the batch digest.");
  }
  const submitting = attestedEntries(p.ledger, "payout.submitting").find(
    (e) => e.payload.runId === p.runId && e.payload.senderBatchId === b.senderBatchId,
  );
  if (
    !submitting ||
    submitting.payload.batchSha256 !== b.batchSha256 ||
    submitting.payload.itemCount !== canon.itemCount ||
    submitting.payload.totalCents !== canon.totalCents ||
    submitting.payload.note !== b.note
  ) {
    return fail("The posted batch differs from the one in the chain.");
  }
  for (const a of p.approvals) {
    const entry = signedEntry(p, a);
    if (!entry || entry.seq > submitting.seq) return fail("The batch was posted before it was signed.");
  }

  const lineOf = new Map(p.lines.map((l) => [l.memberNo, l]));
  const paidMembers = new Set<string>();
  for (const it of b.items) {
    const id = parseSenderItemId(it.senderItemId);
    if (!id || id.runSeq !== slug.runSeq || id.rerouteN !== null || paidMembers.has(id.memberNo)) {
      return fail("An item ID does not belong to this run.");
    }
    paidMembers.add(id.memberNo);
    const line = lineOf.get(id.memberNo);
    if (line?.rail !== "PAYPAL" || line.netCents !== it.amountCents) {
      return fail("An item amount differs from the member's computed line.");
    }
  }
  const computed = computedEntry(p);
  if (!computed || computed.payload.onRailNetCents !== canon.totalCents) {
    return fail("The batch does not pay exactly the on-rail lines.");
  }

  const events = attestedEntries(p.ledger, "webhook.applied");
  const cancels = attestedEntries(p.ledger, "payout.cancel");
  for (const it of b.items) {
    let status: PayoutItemStatus = "SUBMITTED";
    let lastEventId: string | null = null;
    for (const e of events) {
      const ev = e.payload;
      if (ev.resource !== "payout_item" || ev.senderItemId !== it.senderItemId) continue;
      if (
        e.seq < submitting.seq ||
        ev.verified === "dev_mock" ||
        itemStatusFromEvent(ev.eventType) !== ev.status ||
        ev.payoutItemId !== it.payoutItemId
      ) {
        return fail("An item status does not rest on a verified event.");
      }
      const cancelRequested = cancels.some(
        (x) => x.payload.senderItemId === it.senderItemId && x.seq > submitting.seq && x.seq < e.seq,
      );
      const applied = applyItemStatus(status, ev.status, { cancelRequested });
      if (applied.applied) {
        status = applied.next;
        lastEventId = ev.eventId;
      }
    }
    const rests =
      lastEventId === null
        ? (it.status === "SUBMITTED" || it.status === "PENDING") && it.eventId === null
        : status === it.status && lastEventId === it.eventId;
    if (!rests) return fail("An item status does not rest on a verified event.");
  }
  return PASS;
}

/**
 * The trust anchors as given: a bare `ProofTrust` or the published `/.well-known/fairsplit-keys.json`
 * document (version 1). Anything unreadable trusts nothing, so verification fails closed.
 */
function readTrust(trust: unknown): ProofTrust {
  const published = PublishedKeys.safeParse(trust);
  if (published.success) return { officers: published.data.officers, ledger: published.data.ledger };
  const bare = ProofTrust.safeParse(trust);
  return bare.success ? bare.data : { officers: [], ledger: [] };
}

export interface VerifyOptions {
  /**
   * Explicitly labelled demo mode (the seeded showcase and Judge Mode's browser keys): a bundle
   * signed with seeded or demo keys reads "sample" instead of failing. It never yields "verified".
   */
  demoMode?: boolean;
}

/**
 * Verifies the ledger chain and its signed checkpoint, then the six Proof plates, each bound to the
 * chain. `trust` must come from outside the bundle (the published keys); an unreadable `trust`
 * trusts nothing. `ok` is true only when `status` is "verified".
 */
export function verifyChainWith(
  proof: ProofBundle,
  c: ProofCrypto,
  trust: ProofTrust | PublishedKeys,
  options: VerifyOptions = {},
): ChainVerification {
  const demoMode = options.demoMode === true;
  const t = readTrust(trust);
  const ledger = Array.isArray(proof.ledger) ? proof.ledger : [];
  let chain: { ok: boolean; brokenAtSeq: number | null };
  try {
    chain = verifyLedgerWith(ledger, c);
  } catch {
    chain = { ok: false, brokenAtSeq: null };
  }
  const sample = new Set<string>();
  let checkpoint: CheckpointResult;
  try {
    checkpoint = checkCheckpoint(proof, ledger, c, t, demoMode, sample);
  } catch {
    checkpoint = { ok: false, reason: "The ledger checkpoint could not be read.", seq: null, keyId: null };
  }
  const plates = {
    paid: guarded("The invoice could not be read.", () => platePaid(proof)),
    ratified: guarded("The rate card could not be read.", () => plateRatified(proof, c)),
    read: guarded("The slip photos could not be read.", () => plateRead(proof)),
    computed: guarded("The lines could not be read.", () => plateComputed(proof, c)),
    twoKeys: guarded("The signatures could not be read.", () => plateTwoKeys(proof, c, t, demoMode, sample)),
    payoutItems: guarded("The batch hash doesn't match the signed batch. Proof withheld.", () =>
      platePayoutItems(proof, c),
    ),
  };
  const consistent = chain.ok && checkpoint.ok && Object.values(plates).every((p) => p.ok);
  const status: ProofStatus = !consistent
    ? "failed"
    : sample.size === 0
      ? "verified"
      : demoMode
        ? "sample"
        : "failed";
  return {
    ok: status === "verified",
    status,
    chain: { ok: chain.ok, entries: ledger.length, brokenAtSeq: chain.brokenAtSeq },
    checkpoint,
    plates,
    sampleKeys: [...sample].sort(),
    anchors: anchorsOf(proof),
  };
}
