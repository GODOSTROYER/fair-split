// Test-only batches for the co-sign: other valid batches the console may offer while the Chair holds the slab, and
// tampered answers a server must never get signed. Each "valid" one is internally consistent the way fs-api would
// build it (every line hash is its canonical's, `batchSha256` and `linesDigest` recomputed with WS-CORE's functions),
// so a test that refuses it proves the phone refused it for being another batch, not for being malformed.
import type { ApprovalPayloadDTO, CosignLine, CosignRequestDTO } from "../_shims/api-client";
import { batchDigest, jcsSha256, linesDigest } from "../_shims/domain";

/** One line with `delta` cents more premium (so more net), re-hashed as the engine would hash it. */
export function relined(line: CosignLine, delta: number): CosignLine {
  const canonical = {
    ...line.canonical,
    premiumCents: line.canonical.premiumCents + delta,
    netCents: line.canonical.netCents + delta,
  };
  return { ...line, netCents: line.netCents + delta, canonical, lineSha256: jcsSha256(canonical) };
}

/** The request with `lines` in place of its own, and the lines digest of those lines. */
export function withLines(dto: CosignRequestDTO, lines: readonly CosignLine[]): CosignRequestDTO {
  return { ...dto, lines, linesDigest: linesDigest(lines) };
}

/**
 * One cent moved between the first two payouts, in their items and their PayPal lines alike: a valid batch with its
 * own hash and lines digest, but not the one the Chair opened.
 */
export function movedCent(dto: CosignRequestDTO): CosignRequestDTO {
  const [from, to] = dto.items;
  if (!from || !to) throw new Error("the batch has two payouts");
  const items = dto.items.map((it) =>
    it === from
      ? { ...it, amountCents: it.amountCents - 1 }
      : it === to
        ? { ...it, amountCents: it.amountCents + 1 }
        : it,
  );
  const lines = dto.lines.map((l) =>
    l.memberNo === from.memberNo ? relined(l, -1) : l.memberNo === to.memberNo ? relined(l, 1) : l,
  );
  return { ...withLines(dto, lines), items, batchSha256: batchDigest(dto, items).batchSha256 };
}

/** The same payouts, but one cent moved between two cash lines: only the lines digest differs. */
export function movedCashCent(dto: CosignRequestDTO): CosignRequestDTO {
  const cash = dto.lines.filter((l) => l.rail === "CASH");
  const [from, to] = cash;
  if (!from || !to) throw new Error("the run has two cash lines");
  return withLines(
    dto,
    dto.lines.map((l) => (l === from ? relined(l, -1) : l === to ? relined(l, 1) : l)),
  );
}

/** A cash line whose net was changed under its old hash: the line is no longer what its hash covers. */
export function forgedCashLine(lines: readonly CosignLine[]): CosignLine[] {
  const i = lines.findIndex((l) => l.rail === "CASH");
  return lines.map((l, j) =>
    j === i ? { ...l, netCents: l.netCents + 1, canonical: { ...l.canonical, netCents: l.netCents + 1 } } : l,
  );
}

/** An approval-payload answer whose items or lines were swapped after the payload was made. */
export function tamperedApproval(
  approval: ApprovalPayloadDTO,
  part: "items" | "lines" | "jcs" | "senderBatchId",
): ApprovalPayloadDTO {
  switch (part) {
    case "items":
      return {
        ...approval,
        items: approval.items.map((it, i) =>
          i === 0 ? { ...it, receiver: "someone.else@example.invalid" } : it,
        ),
      };
    case "lines":
      return { ...approval, lines: forgedCashLine(approval.lines) };
    case "jcs":
      return { ...approval, jcs: approval.jcs.replace('"currency":"USD"', '"currency":"USD" ') };
    case "senderBatchId":
      return { ...approval, senderBatchId: `${approval.senderBatchId}-x1` };
  }
}
