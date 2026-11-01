import { INVOICE_STATUS_LABELS, MEMBER_LINE_LABELS, type MemberLineState } from "@fairsplit/contracts";
import { getSnapshot } from "@fairsplit/seed";
import type { BrandView } from "../brand.js";
import { kgDTO, maskEmail, moneyDTO } from "../format.js";
import { mockHex } from "./ids.js";
import type { MockWorld } from "./world.js";

/** The same invoice-only boundary and masked projection as fs-api, from the current mock world. */
export function mockBrandView(world: MockWorld): BrandView {
  const snapshot = getSnapshot();
  const ready = ["POSTING", "POSTED", "SETTLING", "NEEDS_FOLLOW_UP", "SETTLED", "CLOSED", "DENIED"].includes(
    world.run.state,
  );
  const lines = ready ? world.lines() : [];
  const members = new Map(snapshot.members.map((m) => [m.memberNo, m]));
  const items = new Map(
    snapshot.run.items.map((i) => [
      i.memberNo,
      {
        ...i,
        status:
          world.stage === "settled"
            ? i.status
            : world.stage === "posted"
              ? ("PENDING" as const)
              : ("SUBMITTED" as const),
        payoutItemId:
          world.stage === "settled"
            ? i.payoutItemId
            : world.stage === "posted"
              ? `MOCK${mockHex(i.senderItemId, 5).toUpperCase()}`
              : null,
      },
    ]),
  );
  for (const event of world.events()) {
    if (event.type !== "item.updated" || !event.payload.memberNo) continue;
    const item = items.get(event.payload.memberNo);
    if (!item) continue;
    items.set(event.payload.memberNo, {
      ...item,
      senderItemId: event.payload.senderItemId,
      payoutItemId: event.payload.payoutItemId,
      status: event.payload.to,
    });
  }
  const paid = lines.filter((l) => items.get(l.memberNo)?.status === "SUCCESS");
  const cash = lines.filter(
    (l) => items.get(l.memberNo)?.status !== "SUCCESS" && ["OFF_RAIL_DUE", "OFF_RAIL_PAID"].includes(l.state),
  );
  const sum = (xs: typeof lines) => xs.reduce((total, l) => total + l.netCents, 0);
  const status = world.run.invoiceStatus;
  const head = snapshot.proof.ledger.at(-1);
  return {
    runSlug: world.runSlug,
    runState: world.run.state,
    provenance: "seeded",
    brand: snapshot.payer.name,
    invoice: {
      invoiceNumber: snapshot.run.invoice.invoiceNumber,
      status,
      statusWords: INVOICE_STATUS_LABELS[status].en,
      amount: moneyDTO(snapshot.run.invoice.amountCents),
      reference: snapshot.run.invoice.reference,
      payerViewUrl: null,
    },
    proofReady: ready,
    totals: {
      members: lines.length,
      net: moneyDTO(sum(lines)),
      paypalMembers: paid.length,
      paypal: moneyDTO(sum(paid)),
      cashMembers: cash.length,
      cash: moneyDTO(sum(cash)),
    },
    members: lines.map((line) => {
      const member = members.get(line.memberNo);
      const item = items.get(line.memberNo);
      return {
        memberNo: line.memberNo,
        name: member?.displayName ?? line.memberNo,
        lang: member?.lang ?? "en",
        rail: line.rail,
        verified: kgDTO(line.verifiedG),
        net: moneyDTO(line.netCents),
        state: line.state,
        stateWords: MEMBER_LINE_LABELS[line.state as MemberLineState]?.console ?? line.state,
        receiverMasked: item ? maskEmail(item.receiver) : null,
        senderItemId: item?.senderItemId ?? null,
        payoutItemId: item?.payoutItemId ?? null,
        itemStatus: item?.status ?? null,
        lineSha256: line.lineSha256,
      };
    }),
    hashes: {
      rateCardSha256: snapshot.rateCard.sha256,
      batchSha256: ready ? snapshot.run.batchSha256 : null,
      ledgerHead: ready && head ? { seq: head.seq, entryHash: head.entryHash } : null,
    },
    exportPath: `/v1/brand/${world.runSlug}/export.csv`,
  };
}
