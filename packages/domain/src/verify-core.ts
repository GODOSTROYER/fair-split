// The Proof verifier with injectable crypto (exported as `@fairsplit/domain/verify`). Pure: no
// node built-ins, so the Proof page can run it in the browser with its own sha256 and Ed25519.
// entry_hash = sha256(prev_hash ‖ JCS({seq, kind, actorKind, actorId, impersonatedBy, payload, at}))
// with a genesis prev_hash of 64 zeros; then the six Proof plates (S3.12).
//
// Every plate is bound to the chain. A bundle field counts only where a ledger entry of the
// contract's shape attests it, and public keys come only from `key.registered` entries, so editing
// the bundle and re-hashing or re-signing it still fails. PayPal's own records anchor the chain:
// the invoice reference carries the card hash, `sender_batch_id` carries rc8 and the runSeq, and the
// batch note carries the batch digest's first 8 hex digits.
import {
  type ChainVerification,
  GENESIS_PREV_HASH,
  type Json,
  type LedgerEntry,
  type LedgerPayload,
  LedgerPayloads,
  type PayoutItemStatus,
  type PlateResult,
  type ProofBundle,
  type ProofLedgerKind,
  type SignedApproval,
} from "@fairsplit/contracts";
import { approvalBytes, batchCanonical, invoiceReference, linesRootJcs } from "./digest-input.js";
import { applyItemStatus, itemStatusFromEvent } from "./fsm.js";
import { batchNote, parseRunSlug, parseSenderItemId, seasonLabelOf, senderBatchId } from "./ids.js";
import { jcs } from "./jcs.js";

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

/** The run's last `lines.computed` entry. */
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

// 4 Computed: each line re-hashes, cites this card and adds up; the lines sum to the pools; and
// the run's `lines.computed` entry carries the same lines root and pools.
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
  return PASS;
}

// 5 Two keys: the treasurer always signs and the Chair co-signs above the card's thresholds (R5).
// Each signature is over this batch, recorded by an `approval.signed` entry, and verifies against
// the public key of a `key.registered` entry for the signer. The bundle's own key is never trusted.
function plateTwoKeys(p: ProofBundle, c: ProofCrypto): PlateResult {
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
    const entry = signedEntry(p, a);
    if (!entry) return fail("A signature is not recorded in the chain.");
    if (Date.parse(entry.at) > Date.parse(q.exp)) return fail("A signature was recorded after it expired.");
    const regs = keys.filter((e) => e.payload.keyId === a.keyId);
    const reg = regs[0];
    if (
      !reg ||
      regs.some(
        (e) =>
          e.payload.publicKeyHex !== reg.payload.publicKeyHex || e.payload.persona !== reg.payload.persona,
      )
    ) {
      return fail("A signing key is not registered in the chain.");
    }
    if (reg.seq > entry.seq || reg.payload.persona !== q.approverId) {
      return fail("A signing key is not registered to its signer.");
    }
    if (a.publicKeyHex !== reg.payload.publicKeyHex) {
      return fail("A signature's key differs from the registered key.");
    }
    if (!c.verifyEd25519(reg.payload.publicKeyHex, approvalBytes(q), a.signatureHex)) {
      return fail("The two signatures do not both verify over the same batch hash.");
    }
  }
  return PASS;
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

/** Verifies the ledger chain, then the six Proof plates, each bound to the chain. */
export function verifyChainWith(proof: ProofBundle, c: ProofCrypto): ChainVerification {
  const chain = verifyLedgerWith(proof.ledger, c);
  const plates = {
    paid: guarded("The invoice could not be read.", () => platePaid(proof)),
    ratified: guarded("The rate card could not be read.", () => plateRatified(proof, c)),
    read: guarded("The slip photos could not be read.", () => plateRead(proof)),
    computed: guarded("The lines could not be read.", () => plateComputed(proof, c)),
    twoKeys: guarded("The signatures could not be read.", () => plateTwoKeys(proof, c)),
    payoutItems: guarded("The batch hash doesn't match the signed batch. Proof withheld.", () =>
      platePayoutItems(proof, c),
    ),
  };
  return {
    ok: chain.ok && Object.values(plates).every((p) => p.ok),
    chain: { ok: chain.ok, entries: proof.ledger.length, brokenAtSeq: chain.brokenAtSeq },
    plates,
  };
}
