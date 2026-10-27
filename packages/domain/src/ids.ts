// Identifiers from the register §8 field table. Pure (no node built-ins) so the browser verifier
// (Proof, W-PF-01) rebuilds and checks them exactly as the server writes them.

/** runSlug = `{seasonCode}-r{runSeq}`, e.g. "2026A-r37". */
export function runSlug(seasonCode: string, runSeq: number): string {
  return `${seasonCode}-r${runSeq}`;
}

/** The parts of a runSlug, or null when it is not one. */
export function parseRunSlug(slug: string): { seasonCode: string; runSeq: number } | null {
  const m = /^(\d{4}[A-Z])-r(\d+)$/.exec(slug);
  return m ? { seasonCode: m[1] as string, runSeq: Number(m[2]) } : null;
}

/** Season label used in copy and notes: "2026A" → "2026-A". */
export function seasonLabelOf(seasonCode: string): string {
  return `${seasonCode.slice(0, 4)}-${seasonCode.slice(4)}`;
}

/** `FS-{runSlug}`, at most 25 characters (PayPal invoice_number limit). */
export function invoiceNumber(slug: string): string {
  const n = `FS-${slug}`;
  if (n.length > 25) throw new RangeError(`invoice_number too long: ${n}`);
  return n;
}

/** `{season}-{rc8}-r{runSeq}`; a re-route adds `-x{n}` (≤ 256 characters). */
export function senderBatchId(
  seasonCode: string,
  rateCardSha256: string,
  runSeq: number,
  rerouteN?: number,
): string {
  const base = `${seasonCode}-${rateCardSha256.slice(0, 8)}-r${runSeq}`;
  const id = rerouteN ? `${base}-x${rerouteN}` : base;
  if (id.length > 256) throw new RangeError("sender_batch_id too long");
  return id;
}

/** `r{runSeq}-{memberNo}`; a re-route uses `r{runSeq}x{n}-{memberNo}` (≤ 63 characters). */
export function senderItemId(runSeq: number, memberNo: string, rerouteN?: number): string {
  const id = rerouteN ? `r${runSeq}x${rerouteN}-${memberNo}` : `r${runSeq}-${memberNo}`;
  if (id.length > 63) throw new RangeError("sender_item_id too long");
  return id;
}

/** The parts of a sender_item_id, or null when it is not one. */
export function parseSenderItemId(
  id: string,
): { runSeq: number; rerouteN: number | null; memberNo: string } | null {
  const m = /^r(\d+)(?:x(\d+))?-(M-\d{3})$/.exec(id);
  if (!m) return null;
  return {
    runSeq: Number(m[1]),
    rerouteN: m[2] === undefined ? null : Number(m[2]),
    memberNo: m[3] as string,
  };
}

/** "Fair Split 2026-A, batch {digest8}". */
export function batchNote(seasonLabel: string, batchSha256: string): string {
  return `Fair Split ${seasonLabel}, batch ${batchSha256.slice(0, 8)}`;
}
