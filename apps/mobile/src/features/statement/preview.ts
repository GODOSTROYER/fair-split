/**
 * Demo-only previews of the line states the demo's PayPal path never reaches (S1.9 lists them all): `?line=HELD`,
 * `PAYPAL_HELD`, `NEEDS_ACTION`, `REVERSED`, `RETURNED` or `EXCLUDED`, on top of `?demo=member&stage=…`. They only
 * ever apply to labelled demo data (the caller checks), so a reviewer can see every designed state; live fs-api
 * statements are never patched. Pure, tested in Node.
 */
import type { StatementDTO } from "../../_shims/api-client";
import type { ItemStatus, LineState } from "../../_shims/contracts";

const PREVIEWS = {
  HELD: { lineState: "HELD", item: null },
  PAYPAL_HELD: { lineState: "PAYPAL_HELD", item: "ONHOLD" },
  NEEDS_ACTION: { lineState: "NEEDS_ACTION", item: "FAILED" },
  REVERSED: { lineState: "REVERSED", item: "REVERSED" },
  RETURNED: { lineState: "RETURNED", item: null },
  EXCLUDED: { lineState: "EXCLUDED", item: null },
} as const satisfies Record<string, { lineState: LineState; item: ItemStatus | null }>;

export type PreviewLine = keyof typeof PREVIEWS;

export function isPreviewLine(v: string | null): v is PreviewLine {
  return v !== null && Object.hasOwn(PREVIEWS, v);
}

export function previewLine(dto: StatementDTO, line: string | null): StatementDTO {
  if (!isPreviewLine(line)) return dto;
  const p = PREVIEWS[line];
  return {
    ...dto,
    lineState: p.lineState,
    item: dto.item ? { ...dto.item, status: p.item, updatedAt: p.item ? dto.item.updatedAt : null } : null,
    expectedDate: line === "HELD" ? (dto.expectedDate ?? dto.cashDay) : dto.expectedDate,
  };
}
